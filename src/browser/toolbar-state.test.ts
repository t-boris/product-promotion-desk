import { describe, expect, it } from 'vitest'
import { ControlledSession } from '../core/browser-session'
import { TakeoverError } from '../core/ports'
import { FakeClock, FakePage } from '../core/testing/fakes'
import { TicketAuthority } from '../core/tickets'
import { initialToolbar, parseToolbarCommand, reduceToolbar, RELEASE_LABEL, toolbarHtml, toolbarView, TOOLBAR_COMMAND_ORIGIN, UserControl } from './toolbar-state'

const account = { label: 'Natal Mystic Reddit', identity: 'natal_bot' }

describe('toolbar state machine', () => {
  it('starts in user control and shows the account and the confirmed identity', () => {
    const view = toolbarView(initialToolbar(account, 'https://www.reddit.com/login/'))
    expect(view).toMatchObject({ account: 'Natal Mystic Reddit', identity: 'signed in as natal_bot', releaseEnabled: true, canGoBack: false })
  })

  it('says so when the identity is not confirmed yet', () => {
    expect(toolbarView(initialToolbar({ label: 'New', identity: null }, 'https://x.test/')).identity).toBe('identity not confirmed yet')
  })

  it('tracks navigation and loading', () => {
    let state = initialToolbar(account, 'https://a.test/')
    state = reduceToolbar(state, { type: 'navigated', url: 'https://a.test/next', canGoBack: true })
    state = reduceToolbar(state, { type: 'loading', loading: false })
    expect(state).toMatchObject({ url: 'https://a.test/next', canGoBack: true, loading: false, phase: 'user_control' })
  })

  it('freezes after release: no later event can re-enable user control', () => {
    let state = initialToolbar(account, 'https://a.test/')
    state = reduceToolbar(state, { type: 'release' })
    expect(toolbarView(state).releaseEnabled).toBe(false)
    const after = reduceToolbar(state, { type: 'navigated', url: 'https://b.test/', canGoBack: true })
    expect(after).toBe(state)
  })
})

describe('toolbar commands and markup', () => {
  it('maps only the reserved command links', () => {
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/back`)).toBe('back')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/reload?x=1`)).toBe('reload')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/release`)).toBe('release')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/format-disk`)).toBeNull()
    expect(parseToolbarCommand('https://evil.example/release')).toBeNull()
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}.evil.example/release`)).toBeNull()
  })

  it('is static markup with the release button and no interpolated account data', () => {
    const html = toolbarHtml()
    expect(html).toContain(RELEASE_LABEL)
    expect(html).toContain('Done, close this window')
    expect(html).not.toContain(account.label)
    expect(html).toContain("default-src 'none'")
  })
})

describe('user control hand-over', () => {
  function setup() {
    const tickets = new TicketAuthority(new FakeClock())
    const page = new FakePage()
    const session = new ControlledSession('acc', async () => page, tickets)
    return { session, page, control: new UserControl(session) }
  }

  it('stops the agent as soon as the user takes control and lets it resume after release', async () => {
    const { session, control } = setup()
    control.begin()
    expect(session.control().holder).toBe('user')
    await expect(session.withAgentControl('monitor', async () => 1)).rejects.toBeInstanceOf(TakeoverError)
    expect(control.release()).toBe(true)
    await expect(session.withAgentControl('monitor', async () => 1)).resolves.toBe(1)
  })

  it('stops an agent run that is already in flight', async () => {
    const { session, page, control } = setup()
    const run = session.withAgentControl('assess', async (p) => {
      await p.goto('https://a.test/')
      control.begin()
      await p.goto('https://b.test/')
    })
    await expect(run).rejects.toBeInstanceOf(TakeoverError)
    expect(page.log).toEqual(['goto https://a.test/'])
  })

  it('releases exactly once, whether by the button or by closing the window', () => {
    const { control } = setup()
    control.begin()
    expect(control.release()).toBe(true) // button
    expect(control.release()).toBe(false) // window-closed event afterwards
  })

  it('a late close of an old window cannot release a newer window\'s control', () => {
    const { session } = setup()
    const first = new UserControl(session)
    first.begin()
    first.release()
    const second = new UserControl(session)
    second.begin()
    first.release() // stale event of the first window
    expect(session.control().holder).toBe('user')
    expect(second.holdsControl).toBe(true)
  })
})
