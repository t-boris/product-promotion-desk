import { describe, expect, it } from 'vitest'
import { CLOSE_LABEL, initialToolbar, parseToolbarCommand, reduceToolbar, toolbarHtml, toolbarView, TOOLBAR_COMMAND_ORIGIN } from './toolbar-state'

const account = { label: 'Natal Mystic Reddit', identity: 'natal_bot' }

describe('toolbar state', () => {
  it('shows the account and the confirmed identity', () => {
    const view = toolbarView(initialToolbar(account, 'https://www.reddit.com/login/'))
    expect(view).toMatchObject({ account: 'Natal Mystic Reddit', identity: 'signed in as natal_bot', canGoBack: false })
  })

  it('says so when the identity is not confirmed yet', () => {
    expect(toolbarView(initialToolbar({ label: 'New', identity: null }, 'https://x.test/')).identity).toBe('identity not confirmed yet')
  })

  it('tracks navigation and loading', () => {
    let state = initialToolbar(account, 'https://a.test/')
    state = reduceToolbar(state, { type: 'navigated', url: 'https://a.test/next', canGoBack: true })
    state = reduceToolbar(state, { type: 'loading', loading: false })
    expect(state).toMatchObject({ url: 'https://a.test/next', canGoBack: true, loading: false })
  })

  it('has no state in which the window hands anything back: it takes nothing (DEC-038)', () => {
    const state = initialToolbar(account, 'https://a.test/')
    expect(Object.keys(state).sort()).toEqual(['accountLabel', 'activeTabId', 'canGoBack', 'identity', 'loading', 'tabs', 'url'])
  })

  it('tracks multiple tabs, titles, and active tab switching (DEC-099)', () => {
    let state = initialToolbar(account, 'https://a.test/home', 't1')
    expect(toolbarView(state).tabs).toEqual([{ id: 't1', title: 'a.test', active: true, loading: true }])
    state = reduceToolbar(state, { type: 'title', tabId: 't1', title: 'Home Feed' })
    expect(toolbarView(state).tabs[0]?.title).toBe('Home Feed')
    state = reduceToolbar(state, {
      type: 'tabs',
      tabs: [
        { id: 't1', title: 'Home Feed', url: 'https://a.test/home', loading: false },
        { id: 't2', title: 'Settings', url: 'https://a.test/settings', loading: true }
      ],
      activeTabId: 't2',
      url: 'https://a.test/settings',
      canGoBack: false,
      loading: true
    })
    expect(toolbarView(state).tabs).toEqual([
      { id: 't1', title: 'Home Feed', active: false, loading: false },
      { id: 't2', title: 'Settings', active: true, loading: true }
    ])
  })
})

describe('toolbar commands and markup', () => {
  it('maps only the reserved command links', () => {
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/back`)).toBe('back')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/reload?x=1`)).toBe('reload')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/close`)).toBe('close')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/new-tab`)).toBe('new-tab')
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/tab/t2`)).toEqual({ type: 'select-tab', id: 't2' })
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/close-tab/t2`)).toEqual({ type: 'close-tab', id: 't2' })
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/tab/../../etc`)).toBeNull()
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/tab/BAD_ID`)).toBeNull()
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/release`)).toBeNull() // the old hand-back is gone
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}/format-disk`)).toBeNull()
    expect(parseToolbarCommand('https://evil.example/close')).toBeNull()
    expect(parseToolbarCommand(`${TOOLBAR_COMMAND_ORIGIN}.evil.example/close`)).toBeNull()
  })

  it('is static markup with a close button, tab strip, no hand-back wording and no interpolated account data', () => {
    const html = toolbarHtml()
    expect(html).toContain(CLOSE_LABEL)
    expect(html).toContain(`${TOOLBAR_COMMAND_ORIGIN}/new-tab`)
    expect(html).not.toContain('Done, close this window')
    expect(html).not.toContain(account.label)
    expect(html).toContain("default-src 'none'")
  })
})
