import { describe, expect, it } from 'vitest'
import type { Capability, CapabilityKey, Channel } from '../../shared/types'
import type { ConnectorContext } from '../ports'
import { FakeConnector } from '../testing/fake-connector'
import { makeReadyWorld, type World } from './test-helpers'

async function setup(fake = new FakeConnector()): Promise<{ w: World; channel: Channel }> {
  const w = await makeReadyWorld({ fake })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
  return { w, channel }
}

const cap = (channel: Channel, key: CapabilityKey): Capability => {
  const found = channel.capabilities.find((c) => c.key === key)
  if (!found) throw new Error(`missing ${key}`)
  return found
}

describe('channels.assess: what the channel can do, without publishing anything (REQ-002)', () => {
  it('stores the observed capabilities with the time of the check, as one recorded run', async () => {
    const { w, channel } = await setup()
    w.fake.setCapability('rules', 'verified', 'Read 6 rules; none about automation.')
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(assessed.capabilities).toHaveLength(8)
    expect(assessed.capabilities.every((c) => c.checkedAt === w.t.clock.now().toISOString())).toBe(true)
    expect(cap(assessed, 'read_posts').status).toBe('verified')
    expect(cap(assessed, 'rules')).toMatchObject({ status: 'verified', detail: 'Read 6 rules; none about automation.' })
    expect(assessed.status).toBe('setup')
    expect(assessed.statusDetail).toMatch(/Assessed/)

    const [run] = w.core.runs.list({ channelId: channel.id })
    expect(run).toMatchObject({ kind: 'assess', channelId: channel.id, status: 'ok' })
    expect(run.summary).toMatch(/Assessed r\/astrology: 5 verified, 3 need checking/)
  })

  it('never publishes: no publish call, no page write, and the sending abilities stay unverified', async () => {
    const { w, channel } = await setup()
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(w.fake.calls).toEqual(['assess'])
    expect(w.fake.published).toEqual([])
    const log = w.t.browser.page(w.account.id).log
    expect(log.filter((entry) => /^(fill|click|upload)/.test(entry))).toEqual([])
    // The fake connector claims everything is verified; the core refuses to repeat the claim for sending.
    for (const key of ['publish_post', 'publish_reply', 'verify_send'] as const) {
      expect(cap(assessed, key).status).toBe('needs_check')
      expect(cap(assessed, key).detail).toMatch(/first authorized send/)
    }
  })

  it('cannot write even if a connector tried: assessment holds no ticket', async () => {
    class Overreaching extends FakeConnector {
      override async assess(ctx: ConnectorContext): Promise<Capability[]> {
        return ctx.session.withAgentControl('overreach', async (page) => {
          await page.fill('#reply-box', 'test message', undefined as never)
          return this.capabilities
        })
      }
    }
    const { w, channel } = await setup(new Overreaching())
    expect(await w.refusal('channels.assess', { channelId: channel.id })).toBe('assess_failed')
    expect(w.t.browser.page(w.account.id).log.filter((entry) => entry.startsWith('fill'))).toEqual([])
    expect(w.core.repos.channel(channel.id).capabilities.every((c) => c.checkedAt === null)).toBe(true)
  })

  it('reports only what the platform allows: restricted and unavailable stay as assessed', async () => {
    const { w, channel } = await setup()
    w.fake.setCapability('publish_post', 'restricted', 'Only approved users can post here.')
    w.fake.setCapability('publish_reply', 'unavailable', 'The thread is archived.')
    w.fake.setCapability('metrics', 'needs_check', 'Scores are hidden.')
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(cap(assessed, 'publish_post')).toMatchObject({ status: 'restricted', detail: 'Only approved users can post here.' })
    expect(cap(assessed, 'publish_reply')).toMatchObject({ status: 'unavailable', detail: 'The thread is archived.' })
    expect(cap(assessed, 'metrics').status).toBe('needs_check')
  })

  it('fills in anything the connector did not report as needing a check', async () => {
    const { w, channel } = await setup()
    w.fake.capabilities = [{ key: 'read_posts', status: 'verified', detail: 'Read 10 posts.', checkedAt: null }]
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(assessed.capabilities).toHaveLength(8)
    expect(cap(assessed, 'read_comments').status).toBe('needs_check')
  })
})

describe('assessment keeps proof from real sends (honest, current capabilities)', () => {
  it('a later assessment does not erase a send-verified ability, unless the platform now forbids it', async () => {
    const { w, channel } = await setup()
    await w.call('channels.assess', { channelId: channel.id })
    w.core.services.channels?.markCapabilityVerified(channel.id, 'publish_reply', 'Reply confirmed on r/astrology')
    w.t.clock.advance(60_000)

    const again = await w.call('channels.assess', { channelId: channel.id })
    expect(cap(again, 'publish_reply')).toMatchObject({ status: 'verified', detail: 'Reply confirmed on r/astrology' })
    expect(cap(again, 'publish_post').status).toBe('needs_check')

    w.fake.setCapability('publish_reply', 'restricted', 'New rule: no bots.')
    const restricted = await w.call('channels.assess', { channelId: channel.id })
    expect(cap(restricted, 'publish_reply')).toMatchObject({ status: 'restricted', detail: 'New rule: no bots.' })
  })

  it('switches a sending mode back to drafting when replying turns out to be forbidden', async () => {
    const { w, channel } = await setup()
    await w.call('channels.assess', { channelId: channel.id })
    await w.call('channels.setMode', { channelId: channel.id, mode: 'approval' })
    w.fake.setCapability('publish_reply', 'restricted', 'New rule: no bots.')
    const after = await w.call('channels.assess', { channelId: channel.id })
    expect(after.mode).toBe('draft')
    const [run] = w.core.runs.list({ channelId: channel.id })
    expect(run.summary).toMatch(/Switched to drafting only/)
    expect(w.core.log.list(10).some((e) => e.level === 'warn' && /drafting only/.test(e.message))).toBe(true)
  })
})

describe('assessment when the person is needed (login, CAPTCHA)', () => {
  const loggedOut = (w: World): void => {
    for (const key of ['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics', 'rules'] as const) {
      w.fake.setCapability(key, 'needs_user', 'The account is not signed in. Open the browser and sign in on the site.')
    }
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
  }

  it('stores needs_user capabilities, marks the channel and the account, and puts both on the attention list', async () => {
    const { w, channel } = await setup()
    loggedOut(w)
    w.changes.length = 0
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(assessed.capabilities.every((c) => c.status === 'needs_user')).toBe(true)
    expect(assessed.status).toBe('needs_user')
    expect(assessed.statusDetail).toMatch(/not signed in/)
    expect(w.core.repos.account(w.account.id)).toMatchObject({ status: 'login_required', identity: null })
    expect(w.changes).toEqual(expect.arrayContaining(['channels', 'accounts', 'attention']))
    const [run] = w.core.runs.list({ channelId: channel.id })
    expect(run).toMatchObject({ kind: 'assess', status: 'suspended' })
    expect(run.summary).toMatch(/Needs you: .*not signed in/)
    expect(w.fake.published).toEqual([])
  })

  it('tells a CAPTCHA from a missing sign-in', async () => {
    const { w, channel } = await setup()
    loggedOut(w)
    w.fake.login = { loggedIn: false, identity: null, captcha: true }
    await w.call('channels.assess', { channelId: channel.id })
    expect(w.core.repos.account(w.account.id).status).toBe('captcha')
  })

  it('recovers after the person signs in: the channel returns to setup, or to monitoring if it had started', async () => {
    const { w, channel } = await setup()
    loggedOut(w)
    await w.call('channels.assess', { channelId: channel.id })

    w.fake.capabilities = new FakeConnector().capabilities
    w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
    const recovered = await w.call('channels.assess', { channelId: channel.id })
    expect(recovered.status).toBe('setup')
    expect(cap(recovered, 'read_posts').status).toBe('verified')

    // A channel that was already monitoring resumes monitoring.
    w.core.db.prepare("UPDATE channels SET status = 'needs_user', baseline_done_at = ? WHERE id = ?").run(w.t.clock.now().toISOString(), channel.id)
    expect((await w.call('channels.assess', { channelId: channel.id })).status).toBe('active')
  })

  it('keeps abilities proven by earlier sends while signed out, and leaves a paused channel paused', async () => {
    const { w, channel } = await setup()
    await w.call('channels.assess', { channelId: channel.id })
    w.core.services.channels?.markCapabilityVerified(channel.id, 'publish_reply', 'Reply confirmed')
    w.core.db.prepare("UPDATE channels SET status = 'paused', status_detail = 'Paused by you' WHERE id = ?").run(channel.id)
    loggedOut(w)
    const after = await w.call('channels.assess', { channelId: channel.id })
    expect(cap(after, 'publish_reply').status).toBe('verified')
    expect(cap(after, 'read_posts').status).toBe('needs_user')
    expect(after.status).toBe('paused')
    expect(after.statusDetail).toBe('Paused by you')
  })

  it('still reports the account problem when the follow-up login check itself fails', async () => {
    class FlakyLogin extends FakeConnector {
      override async checkLogin(): Promise<never> {
        throw new Error('page did not load')
      }
    }
    const { w, channel } = await setup(new FlakyLogin())
    loggedOut(w)
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(assessed.status).toBe('needs_user')
    expect(w.core.log.list(10).some((e) => /Could not tell why .* needs you: page did not load/.test(e.message))).toBe(true)
  })
})

describe('assessment failures and exclusivity', () => {
  it('records a failed run and leaves the channel as it was', async () => {
    class Failing extends FakeConnector {
      override async assess(): Promise<never> {
        throw new Error('net::ERR_CONNECTION_RESET')
      }
    }
    const { w, channel } = await setup(new Failing())
    try {
      await w.call('channels.assess', { channelId: channel.id })
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'assess_failed' })
      expect((error as Error).message).toMatch(/r\/astrology.*ERR_CONNECTION_RESET/)
    }
    const [run] = w.core.runs.list({ channelId: channel.id })
    expect(run).toMatchObject({ kind: 'assess', status: 'failed' })
    expect(w.core.repos.channel(channel.id)).toMatchObject({ status: 'setup' })
    expect(w.core.repos.channel(channel.id).capabilities.every((c) => c.checkedAt === null)).toBe(true)
  })

  it('does not run while the person holds the account browser', async () => {
    const { w, channel } = await setup()
    await w.call('accounts.takeControl', { accountId: w.account.id })
    expect(await w.refusal('channels.assess', { channelId: channel.id })).toBe('browser_busy')
    expect(w.core.runs.list({ channelId: channel.id })[0].status).toBe('failed')
    await w.call('accounts.releaseControl', { accountId: w.account.id })
    expect((await w.call('channels.assess', { channelId: channel.id })).capabilities[0].checkedAt).not.toBeNull()
  })

  it('refuses a second assessment of the same channel while one is running', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    class Slow extends FakeConnector {
      override async assess(ctx: ConnectorContext): Promise<Capability[]> {
        await gate
        return super.assess(ctx)
      }
    }
    const { w, channel } = await setup(new Slow())
    const first = w.call('channels.assess', { channelId: channel.id })
    expect(await w.refusal('channels.assess', { channelId: channel.id })).toBe('busy')
    expect(await w.refusal('channels.remove', { id: channel.id })).toBe('busy')
    release()
    await first
    await w.call('channels.assess', { channelId: channel.id })
  })

  it('refuses an unknown channel', async () => {
    const { w } = await setup()
    expect(await w.refusal('channels.assess', { channelId: 'nope' })).toBe('not_found')
  })
})
