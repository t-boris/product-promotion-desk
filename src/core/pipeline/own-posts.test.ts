// A channel the app cannot read is a channel for the owner's own posts (DEC-034): it is activated without a first read, nothing observes it, no
// reply is prepared for it, and its posts go out through the same approval and gate as any other channel's.

import { afterEach, describe, expect, it } from 'vitest'
import { ChannelsStore } from '../channels/store'
import { reconcileChannels } from '../channels/reads'
import { toJson } from '../db/database'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { AI_BROWSER_BASIS } from './mission-publisher'
import { FakeMetricsService } from './scheduler-fakes'
import { contentHash } from './hash'
import { sendWays } from './send-ways'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const OWN_POSTS = 'Your own posts only.'

/** A mission service whose AI is a script: it gets the request the send flow built, and answers as the service would. */
class ScriptedMissions implements PostMissionService {
  readonly requests: PostMissionRequest[] = []
  constructor(private readonly script: (request: PostMissionRequest) => Promise<Partial<PostMissionOutcome> | void>) {}
  async run(request: PostMissionRequest): Promise<PostMissionOutcome> {
    this.requests.push(request)
    const said = (await this.script(request)) ?? {}
    return { ended: 'finished', committed: request.authority.committed, reported: null, humanCheck: null, warning: null, error: null, ...said }
  }
}

/** A world whose only channel is one the app does not read, still in setup, as a freshly connected Instagram channel is. */
function ownPostsWorld(options: { status?: 'setup' | 'active' | 'paused' } = {}): World {
  const w = makeWorld({ mode: 'observe', baselineDone: false })
  w.connector.canRead = false
  const channel = w.addChannel({ reads: false, baselineDone: false, mode: 'observe', status: options.status ?? 'setup', target: '@brand' })
  w.channel = channel
  return w
}

const fetches = (): number => world.connector.calls.filter((c) => c.startsWith('fetchActivity')).length

describe('activating a channel the app does not read', () => {
  it('needs no first read: it becomes active at once and says what it is for', async () => {
    world = ownPostsWorld()
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel.status).toBe('active')
    expect(channel.statusDetail).toBe(OWN_POSTS)
    expect(channel.baselineDoneAt).toBeNull()
    expect(fetches()).toBe(0)
    expect(world.core.runs.list({ channelId: world.channel.id }).filter((r) => r.kind === 'monitor')).toEqual([])
  })

  it('does not ask for the ability to read comments', async () => {
    world = ownPostsWorld()
    const caps = world.channel.capabilities.map((c) => (c.key === 'read_comments' ? { ...c, status: 'unavailable' as const } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    expect((await world.core.router.call('channels.activate', { channelId: world.channel.id })).status).toBe('active')
  })

  it('still needs a signed-in account, because its posts are made as that account', async () => {
    world = ownPostsWorld()
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'account_not_ready' })
    expect(world.refresh().status).toBe('setup')
  })

  it('is refused when posting itself is known to be impossible there', async () => {
    world = ownPostsWorld()
    const caps = world.channel.capabilities.map((c) => (c.key === 'publish_post' ? { ...c, status: 'unavailable' as const, detail: 'text only' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'publish_unavailable' })
    expect(world.refresh().status).toBe('setup')
  })

  it('is refused too when posting is restricted by the rules there', async () => {
    world = ownPostsWorld()
    const caps = world.channel.capabilities.map((c) => (c.key === 'publish_post' ? { ...c, status: 'restricted' as const, detail: 'no posts by new accounts' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'publish_unavailable' })
    expect(world.refresh().status).toBe('setup')
  })

  it('does not activate a paused channel', async () => {
    world = ownPostsWorld({ status: 'paused' })
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'channel_paused' })
  })

  it('asks the connector now, not what was stored: a channel stored as unread that the connector now reads is read first', async () => {
    world = ownPostsWorld()
    world.connector.canRead = true
    world.connector.addDiscussion({ externalId: 'd1' })
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel.reads).toBe(true)
    expect(channel.baselineDoneAt).not.toBeNull()
    expect(fetches()).toBe(1)
  })

  it('asks the connector now: a channel stored as read that the connector no longer reads is activated as own posts', async () => {
    world = makeWorld({ baselineDone: false })
    expect(world.channel.reads).toBe(true)
    world.connector.canRead = false
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel).toMatchObject({ status: 'active', reads: false, statusDetail: OWN_POSTS })
    expect(fetches()).toBe(0)
  })
})

describe('what is never done to a channel the app does not read', () => {
  it('the monitor skips it without a failure, a read or a change of status', async () => {
    world = ownPostsWorld({ status: 'active' })
    const outcome = await world.monitor.runChannel(world.channel.id)
    expect(outcome).toMatchObject({ status: 'skipped', newOpportunities: 0 })
    expect(outcome.summary).toMatch(/does not read this channel/)
    expect(fetches()).toBe(0)
    expect(world.refresh()).toMatchObject({ status: 'active', lastRunAt: null, nextCheckAt: null })
  })

  it('"Check now" says there is nothing to check and starts no run', async () => {
    world = ownPostsWorld({ status: 'active' })
    await expect(world.core.router.call('channels.checkNow', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'not_read' })
    expect(world.core.runs.list({ channelId: world.channel.id })).toEqual([])
  })

  it('resuming a paused one puts it back to work, not back to setup', async () => {
    world = ownPostsWorld({ status: 'active' })
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    expect(world.refresh().status).toBe('paused')
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed).toMatchObject({ status: 'active', statusDetail: OWN_POSTS })
  })

  it('a channel that was never started cannot be paused, and "resume" does not start it: that is what Activate is for', async () => {
    world = ownPostsWorld() // in setup, with a login that is not ready: Activate would refuse it
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    await expect(world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })).rejects.toMatchObject({ code: 'invalid_state' })
    expect(world.refresh().status).toBe('setup')
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed).toMatchObject({ status: 'setup', statusDetail: '' })
  })

  it('no metrics are read for it, by the owner or by the sweep: no service call, no run, so no failed run', async () => {
    world = ownPostsWorld({ status: 'active' })
    const service = new FakeMetricsService()
    world.core.services.metrics = service
    await expect(world.core.router.call('results.refresh', { channelId: world.channel.id })).resolves.toEqual([])
    expect(service.calls).toEqual([])
    expect(world.core.runs.list({ channelId: world.channel.id })).toEqual([])
  })

  it('metrics of a channel the app reads are refreshed as before', async () => {
    world = makeWorld()
    const service = new FakeMetricsService()
    world.core.services.metrics = service
    await world.core.router.call('results.refresh', { channelId: world.channel.id })
    expect(service.calls).toEqual([world.channel.id])
    expect(world.core.runs.list({ channelId: world.channel.id }).filter((r) => r.kind === 'metrics')).toHaveLength(1)
  })

  it('resuming a channel the app reads, with no first read yet, still goes back to setup', async () => {
    world = makeWorld({ baselineDone: false })
    world.core.db.prepare("UPDATE channels SET status = 'active' WHERE id = ?").run(world.channel.id) // started, as one is when it was not read before
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed).toMatchObject({ status: 'setup', statusDetail: '' })
  })
})

describe('its own posts', () => {
  it('go through the same approval and gate, and the AI browser carries them: no switch in the settings, and the app cannot read the page back (DEC-035)', async () => {
    world = ownPostsWorld()
    expect(world.core.settings.app().publishWith).toBe('connector') // never chosen: this channel has no other way
    const missions = new ScriptedMissions(async (request) => {
      await request.authority.lease(async (lease) => {
        lease.commit()
        return lease.ticket
      })
    })
    world.core.services.postMissions = missions
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Our first post. I work on this product.' } })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    const action = await world.sending.send(opportunity.id)
    expect(missions.requests).toHaveLength(1)
    expect(missions.requests[0]!.authority.content.destination).toBe(world.channel.url)
    expect(world.connector.published).toHaveLength(0) // the connector cannot post here
    // The app does not read this platform, so the post is not confirmed by the app: the owner looks and tells it.
    expect(action.state).toBe('unknown')
    expect(action.error).toMatch(/does not read this channel/)
    expect(action.authorizationBasis).toContain(AI_BROWSER_BASIS)
  })

  it('are approved when the engine cannot be held to the browser tools alone (Codex): any selected engine that can work the browser may publish', async () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    ;(world.engine as { confinesAgent: boolean }).confinesAgent = false
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.', markup: 'markdown' } })
    await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).resolves.toBeDefined()
  })

  it('are refused when the engine is not selected at all', async () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    world.core.settings.updateApp({ engineId: null })
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.', markup: 'markdown' } })
    await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/No AI engine is selected/) })
  })

  it('say why at the approval for an older (legacy) draft too, not as the connector\'s "no site profile" after the press', async () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    ;(world.engine as { supportsAgent: boolean }).supportsAgent = false
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.', markup: 'legacy' } })
    await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/choose Claude Code or Codex in Settings.*Copy post/) })
    // and with an engine that can work the browser, the same draft is approved
    ;(world.engine as { supportsAgent: boolean }).supportsAgent = true
    await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).resolves.toBeDefined()
  })

  it('are refused at the approval when the engine cannot run an agent at all', async () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    const engine = world.engine as { supportsAgent: boolean; confinesAgent: boolean }
    engine.supportsAgent = false
    engine.confinesAgent = true
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.', markup: 'markdown' } })
    await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/cannot work the browser/) })
  })

  it('tell the screen whether the app reads the channel, so a card knows its post goes by the AI browser (DEC-035)', async () => {
    world = ownPostsWorld({ status: 'active' })
    const created = (await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: 'A post.', markup: 'markdown' } })) as { opportunity: { id: string } }
    const cards = (await world.core.router.call('opportunities.list', {})) as unknown as { opportunity: { id: string }; channelReads: boolean }[]
    expect(cards.find((c) => c.opportunity.id === created.opportunity.id)?.channelReads).toBe(false)
  })

  it('approve a picture for Instagram with the setting never touched: the screenshot case (DEC-035)', async () => {
    world = ownPostsWorld({ status: 'active' })
    world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('instagram', world.channel.id)
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    expect(world.core.settings.app().publishWith).toBe('connector')
    const header = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    const media = (await (world.core.router.call as (m: string, a: unknown) => Promise<{ id: string; name: string; path: string }>)('media.add', { productId: world.product.id, name: 'p.png', base64: Buffer.concat([header, Buffer.from('p')]).toString('base64'), origin: 'pasted' }))
    const { opportunity } = await world.core.router.call('publications.create', {
      channelId: world.channel.id,
      draft: { text: 'A caption. I work on it.', markup: 'markdown', attachments: [{ name: media.name, path: media.path, mime: '', sha256: '', mediaId: media.id }] }
    })
    await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).resolves.toBeDefined()
  })

  describe('with a link in the draft (DEC-036): the form of the platform has no field for it, and the AI is not asked to fill one', () => {
    const LINK = 'https://natalmystic.com'
    const sendWithLink = async (platform: string, markup: 'markdown' | 'legacy') => {
      world = ownPostsWorld({ status: 'active' })
      world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, world.channel.id)
      const missions = new ScriptedMissions(async (request) => {
        await request.authority.lease(async (lease) => {
          lease.commit()
          return lease.ticket
        })
      })
      world.core.services.postMissions = missions
      const header = Buffer.alloc(24)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
      const media = (await (world.core.router.call as (m: string, a: unknown) => Promise<{ id: string; name: string; path: string }>)('media.add', { productId: world.product.id, name: 'p.png', base64: Buffer.concat([header, Buffer.from('p')]).toString('base64'), origin: 'picked' }))
      const { opportunity } = await world.core.router.call('publications.create', {
        channelId: world.channel.id,
        draft: { title: 'A title', text: 'A caption. I work on it.', link: LINK, markup, attachments: [{ name: media.name, path: media.path, mime: '', sha256: '', mediaId: media.id }] }
      })
      // Approve says nothing against it (the preview of the platform says what became of the link: see post-format.test.ts).
      await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).resolves.toBeDefined()
      await world.sending.send(opportunity.id)
      return missions.requests[0]!.authority.content
    }

    it.each(['markdown', 'legacy'] as const)('Instagram, a %s draft: the mission is given the caption ending with "Link in bio" and no link, so it has no field to look for (the screenshot case, DEC-044)', async (markup) => {
      const content = await sendWithLink('instagram', markup)
      expect(content.link).toBeNull()
      expect(content.text).toBe('A caption. I work on it.\n\nLink in bio')
      expect(content.attachments).toHaveLength(1)
    })

    it('does not send what was approved before the rule: an approval of a draft with a link given under the old hash is approved again (DEC-036)', async () => {
      world = ownPostsWorld({ status: 'active' })
      world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('instagram', world.channel.id)
      const missions = new ScriptedMissions(async () => undefined)
      world.core.services.postMissions = missions
      const header = Buffer.alloc(24)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
      const media = (await (world.core.router.call as (m: string, a: unknown) => Promise<{ id: string; name: string; path: string }>)('media.add', { productId: world.product.id, name: 'p.png', base64: Buffer.concat([header, Buffer.from('p')]).toString('base64'), origin: 'picked' }))
      const { opportunity } = await world.core.router.call('publications.create', {
        channelId: world.channel.id,
        draft: { text: 'A caption. I work on it.', link: LINK, markup: 'legacy', attachments: [{ name: media.name, path: media.path, mime: '', sha256: '', mediaId: media.id }] }
      })
      await world.core.router.call('opportunities.approve', { id: opportunity.id })
      // what the approval was before the rule existed: the hash of the draft without where its link goes
      const draft = world.core.repos.latestDraft(opportunity.id)!
      const account = world.core.repos.account(world.channel.accountId)
      const approval = world.core.repos.activeApproval(draft.id)!
      const before = contentHash(draft, account, approval.destination, 'reddit')
      expect(before).not.toBe(approval.contentHash)
      world.core.db.prepare('UPDATE approvals SET content_hash = ? WHERE id = ?').run(before, approval.id)
      await expect(world.sending.send(opportunity.id)).rejects.toMatchObject({ block: { code: 'approval_stale', effect: 'review' } })
      expect(missions.requests).toHaveLength(0)
      // approved again, it goes
      await world.core.router.call('opportunities.approve', { id: opportunity.id })
      await world.sending.send(opportunity.id)
      expect(missions.requests).toHaveLength(1)
    })

    it('still says that the signed-in identity changed, and not that the content did, for a draft whose link is placed in the text', async () => {
      world = ownPostsWorld({ status: 'active' })
      world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('facebook', world.channel.id)
      world.core.db.prepare('UPDATE accounts SET identity = ? WHERE id = ?').run('brand_account', world.account.id)
      world.core.services.postMissions = new ScriptedMissions(async () => undefined)
      const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: 'A caption. I work on it.', link: LINK, markup: 'legacy' } })
      await world.core.router.call('opportunities.approve', { id: opportunity.id })
      world.core.db.prepare('UPDATE accounts SET identity = ? WHERE id = ?').run('someone_else', world.account.id)
      await expect(world.sending.send(opportunity.id)).rejects.toMatchObject({ block: { code: 'identity_changed', effect: 'review' } })
    })

    it('refuses an older draft that the link added to the end of the text took over the limit, at the approval and at the send (it did not count while the link was a part of its own)', async () => {
      world = ownPostsWorld({ status: 'active' })
      world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('threads', world.channel.id)
      const missions = new ScriptedMissions(async () => undefined)
      world.core.services.postMissions = missions
      const text = `I work on it. ${'x'.repeat(466)}`
      const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text, link: LINK, markup: 'legacy' } })
      await expect(world.core.router.call('opportunities.approve', { id: opportunity.id })).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/505 characters; Threads allows 500/) })
      // the owner shortens the link away; approved, then the text grows by an edit that bypasses the approval (the gate asks again at the send)
      await world.core.router.call('opportunities.saveDraft', { id: opportunity.id, draft: { text, link: null, markup: 'legacy' } })
      await world.core.router.call('opportunities.approve', { id: opportunity.id })
      const draft = world.core.repos.latestDraft(opportunity.id)!
      world.core.db.prepare('UPDATE drafts SET link = ? WHERE id = ?').run(LINK, draft.id)
      const account = world.core.repos.account(world.channel.accountId)
      const approval = world.core.repos.activeApproval(draft.id)!
      world.core.db.prepare('UPDATE approvals SET content_hash = ? WHERE id = ?').run(contentHash(world.core.repos.draft(draft.id), account, approval.destination, 'threads'), approval.id)
      await expect(world.sending.send(opportunity.id)).rejects.toMatchObject({ block: { code: 'post_does_not_fit' } })
      expect(missions.requests).toHaveLength(0)
    })

    it('reads the disclosure as before the link moved: "it" in "I work on it" is the product the link names, wherever the link stands in the post', async () => {
      // the link is the last paragraph of a Facebook post, after the statement; a post approved for Facebook with this text must not be refused for it
      const content = await sendWithLink('facebook', 'markdown')
      expect(content.text).toMatch(/I work on it\.\n\nhttps:\/\/natalmystic\.com$/)
    })

    it('judges a post by what it will show: Instagram leaves the link out, so a caption that does not name the product needs no disclosure, and Facebook shows the link, so it does', async () => {
      const draft = async (platform: string) => {
        world = ownPostsWorld({ status: 'active' })
        world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, world.channel.id)
        world.core.services.postMissions = new ScriptedMissions(async () => undefined)
        const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: 'A caption without a name.', link: LINK, markup: 'markdown' } })
        return world.core.router.call('opportunities.approve', { id: opportunity.id })
      }
      await expect(draft('facebook')).rejects.toMatchObject({ code: 'disclosure_missing' })
      // (no picture: Instagram would also say that it needs one, which is not what is asked here)
      await expect(draft('instagram')).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/needs a picture/) })
    })

    it.each(['markdown', 'legacy'] as const)('Facebook, a %s draft: the link is the last paragraph of the text the mission types', async (markup) => {
      const content = await sendWithLink('facebook', markup)
      expect(content.link).toBeNull()
      expect(content.text).toBe(`A caption. I work on it.\n\n${LINK}`)
    })
  })

  it('are never sent by a scheduled or an automatic send: the AI browser carries only a press of the owner, and nothing else can carry them', () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    const channel = world.channel
    expect(sendWays(world.core, undefined, channel)).toEqual({ aiBrowser: true, noConnector: true })
    expect(sendWays(world.core, { automatic: true, approvedBy: 'user' }, channel)).toEqual({ aiBrowser: false, unattended: true, noConnector: true })
    expect(sendWays(world.core, { automatic: false, approvedBy: 'auto_rule' }, channel)).toEqual({ aiBrowser: false, unattended: true, noConnector: true })
    expect(sendWays(world.core, { automatic: false, approvedBy: 'user' }, channel)).toEqual({ aiBrowser: true, noConnector: true })
    // A channel the app reads is as before: the switch decides.
    expect(sendWays(world.core, undefined, { reads: true })).toEqual({ aiBrowser: false })
    world.core.settings.updateApp({ publishWith: 'ai_browser' })
    expect(sendWays(world.core, undefined, { reads: true })).toEqual({ aiBrowser: true })
  })

  it('are stopped at the press, for an older (legacy) draft too, when the engine was changed after the approval: nothing is sent and the connector is never asked', async () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.', markup: 'legacy' } })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    ;(world.engine as { supportsAgent: boolean }).supportsAgent = false
    await expect(world.sending.send(opportunity.id)).rejects.toMatchObject({ message: expect.stringMatching(/choose Claude Code or Codex in Settings/) })
    expect(world.connector.published).toHaveLength(0)
  })

  it.each(['markdown', 'legacy'] as const)('are never sent by an automatic send or a due schedule, whatever the form of the %s draft: no mission is started, nothing is published, and the words say what to do', async (markup) => {
    world = ownPostsWorld()
    const missions = new ScriptedMissions(async () => undefined)
    world.core.services.postMissions = missions
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.', markup } })
    const approve = (): Promise<unknown> => world.core.router.call('opportunities.approve', { id: opportunity.id })
    const sending = world.sending as unknown as { send(id: string, options: { automatic: boolean }): Promise<unknown> }

    await approve()
    await expect(sending.send(opportunity.id, { automatic: true })).rejects.toMatchObject({ message: expect.stringMatching(/scheduled or automatic send.*press Send/s) })
    expect(missions.requests).toHaveLength(0)
    expect(world.connector.published).toHaveLength(0)

    // the scheduler: an approved publication whose time has come (set in the database: the API refuses to schedule this channel)
    await approve()
    world.core.db.prepare('UPDATE opportunities SET scheduled_at = ? WHERE id = ?').run(world.core.clock.now().toISOString(), opportunity.id)
    await world.sending.sendDuePublications()
    expect(missions.requests).toHaveLength(0)
    expect(world.connector.published).toHaveLength(0)

    // the owner's own press on a fresh approval is carried
    world.core.db.prepare('UPDATE opportunities SET scheduled_at = NULL WHERE id = ?').run(opportunity.id)
    await approve()
    await expect(world.sending.send(opportunity.id)).resolves.toBeDefined()
    expect(missions.requests).toHaveLength(1)
  })

  it('cannot be scheduled: the AI browser carries only a send the owner presses, so the time would pass and nothing would go; clearing a time is still allowed', async () => {
    world = ownPostsWorld()
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Words.' } })
    await expect(world.core.router.call('publications.schedule', { id: opportunity.id, at: '2030-01-01T10:00:00.000Z' })).rejects.toMatchObject({ code: 'invalid_state', message: expect.stringMatching(/cannot be scheduled.*Press Send/s) })
    expect(world.core.repos.opportunity(opportunity.id)?.scheduledAt ?? null).toBeNull()
    await expect(world.core.router.call('publications.schedule', { id: opportunity.id, at: null })).resolves.toBeDefined()
  })

  it('go by the connector in a build with no AI browser, and say what is missing for a picture', () => {
    world = ownPostsWorld()
    world.core.services.postMissions = undefined
    expect(sendWays(world.core, undefined, world.channel)).toEqual({ aiBrowser: false, noConnector: true })
  })

  it('are still refused while the channel has not been activated: that is what activating is for', async () => {
    world = ownPostsWorld()
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'A post' } })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    await expect(world.sending.send(opportunity.id)).rejects.toThrow(/not been activated/)
    expect(world.connector.published).toHaveLength(0)
  })
})

describe('the start of the application', () => {
  it('tells each channel again whether the app reads it, both ways', () => {
    world = makeWorld()
    const unread = world.addChannel({ target: 'r/unread' })
    expect(unread.reads).toBe(true)
    world.connector.canRead = false
    reconcileChannels(world.core, new ChannelsStore(world.core.db, world.core.clock, world.core.repos))
    expect(world.refresh(unread).reads).toBe(false)
    world.connector.canRead = true
    reconcileChannels(world.core, new ChannelsStore(world.core.db, world.core.clock, world.core.repos))
    expect(world.refresh(unread).reads).toBe(true)
  })

  it('calls a channel that was named by its address by its handle, once, and leaves every other name alone', () => {
    world = makeWorld()
    const store = new ChannelsStore(world.core.db, world.core.clock, world.core.repos)
    const set = (id: string, platform: string, target: string, url: string): void => {
      world.core.db.prepare('UPDATE channels SET platform = ?, target = ?, url = ? WHERE id = ?').run(platform, target, url, id)
    }
    const legacy = world.addChannel({ target: 'x' })
    set(legacy.id, 'instagram', 'www.instagram.com/boris_chart_notebook', 'https://www.instagram.com/boris_chart_notebook')
    const chosen = world.addChannel({ target: 'x' })
    set(chosen.id, 'instagram', 'My brand page', 'https://www.instagram.com/brandpage/')
    const group = world.addChannel({ target: 'x' })
    set(group.id, 'facebook', 'www.facebook.com/groups/astrologyclub', 'https://www.facebook.com/groups/astrologyclub')
    const reddit = world.addChannel({ target: 'r/test' })

    reconcileChannels(world.core, store)
    reconcileChannels(world.core, store) // safe to repeat

    expect(world.refresh(legacy).target).toBe('@boris_chart_notebook')
    expect(world.refresh(legacy).url).toBe('https://www.instagram.com/boris_chart_notebook') // the destination of a post is never touched
    expect(world.refresh(chosen).target).toBe('My brand page')
    expect(world.refresh(group).target).toBe('www.facebook.com/groups/astrologyclub')
    expect(world.refresh(reddit).target).toBe('r/test')
  })

  it('does not rename a channel into a name another channel of the same account already has', () => {
    world = makeWorld()
    const store = new ChannelsStore(world.core.db, world.core.clock, world.core.repos)
    const taken = world.addChannel({ target: '@brand' })
    world.core.db.prepare("UPDATE channels SET platform = 'instagram', url = 'https://www.instagram.com/brand/' WHERE id = ?").run(taken.id)
    const legacy = world.addChannel({ target: 'x' })
    world.core.db.prepare("UPDATE channels SET platform = 'instagram', target = 'www.instagram.com/brand', url = 'https://www.instagram.com/brand' WHERE id = ?").run(legacy.id)
    reconcileChannels(world.core, store)
    expect(world.refresh(legacy).target).toBe('www.instagram.com/brand')
    // The database would refuse the same name twice anyway; the point is that nothing is attempted and nothing is logged at every start.
    expect(world.core.log.list(100, 'warn').filter((e) => /Could not bring/.test(e.message))).toEqual([])
  })
})
