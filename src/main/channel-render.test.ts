// The Channel page's cards for the three ways the app can look at a channel, rendered to markup (the renderer has no test runner of its own; this file is
// compiled with the renderer, like feed-render.test.ts): a channel a connector reads, a channel the AI watches in the browser like a person (DEC-042), and a
// channel that takes the owner's own posts and nothing else (DEC-034). What the page shows must follow the way: the schedule for both that are watched, the
// automatic replies, the mode and the metrics only for the one a connector reads, and the words never claim more than the way allows.
// The components import the application's transport, which wants a window with the bridge of the preload script: it is stubbed before they are loaded.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHANNEL_SETTINGS, type Channel } from '../shared/types'
import type { ChannelPage as ChannelPageComponent } from '../renderer/src/pages/channels/ChannelPage'
import type { ChannelStatusCard as ChannelStatusCardComponent } from '../renderer/src/pages/channels/ChannelStatusCard'
import type { ModeSelector as ModeSelectorComponent } from '../renderer/src/pages/channels/ModeSelector'
import type { SettingsForm as SettingsFormComponent } from '../renderer/src/pages/channels/SettingsForm'
import { BROWSER_WATCH_QUERIES_HINT, BROWSER_WATCH_READING, BROWSER_WATCH_WHAT_IT_DOES, OWN_POSTS_READING, OWN_POSTS_WHAT_IT_DOES } from '../renderer/src/pages/channels/own-posts'

type Way = 'connector' | 'browser' | 'unread'

const channel = (way: Way, over: Partial<Channel> = {}): Channel =>
  ({
    id: 'c1',
    productId: 'p1',
    accountId: 'a1',
    platform: way === 'connector' ? 'reddit' : 'instagram',
    target: way === 'connector' ? 'r/astrology' : '@brand',
    url: 'https://example.com/brand',
    mode: 'observe',
    settings: { ...DEFAULT_CHANNEL_SETTINGS },
    capabilities: [],
    status: 'active',
    statusDetail: '',
    baselineDoneAt: null,
    lookedBackAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    nextCheckAt: null,
    plan: null,
    reads: way === 'connector',
    watchedInBrowser: way === 'browser',
    createdAt: '2026-11-15T08:00:00.000Z',
    ...over
  }) as Channel

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

let ModeSelector: typeof ModeSelectorComponent
let SettingsForm: typeof SettingsFormComponent
let ChannelStatusCard: typeof ChannelStatusCardComponent
let ChannelPage: typeof ChannelPageComponent

beforeAll(async () => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
  ;({ ModeSelector } = await import('../renderer/src/pages/channels/ModeSelector'))
  ;({ SettingsForm } = await import('../renderer/src/pages/channels/SettingsForm'))
  ;({ ChannelStatusCard } = await import('../renderer/src/pages/channels/ChannelStatusCard'))
  ;({ ChannelPage } = await import('../renderer/src/pages/channels/ChannelPage'))
})

describe('the mode card', () => {
  it('offers the modes only for a channel a connector reads', () => {
    const out = html(createElement(ModeSelector, { channel: channel('connector') }))
    expect(out).toContain('data-testid="mode-observe"')
    expect(out).not.toContain('own-posts-line')
  })

  it('says for a channel watched in the browser that it is watched and still never replied to; for an unread one, what it was', () => {
    const watched = html(createElement(ModeSelector, { channel: channel('browser') }))
    expect(watched).not.toContain('data-testid="mode-')
    expect(watched).toContain(`data-testid="own-posts-line">${BROWSER_WATCH_WHAT_IT_DOES}<`)
    const unread = html(createElement(ModeSelector, { channel: channel('unread') }))
    expect(unread).toContain(`data-testid="own-posts-line">${OWN_POSTS_WHAT_IT_DOES}<`)
  })
})

describe('the settings form', () => {
  const settings = (way: Way): string => html(createElement(SettingsForm, { channel: channel(way) }))
  const schedule = ['settings-interval-choice', 'settings-look-back', 'settings-topics', 'settings-queries']
  const autoReplies = ['settings-auto-thanks', 'settings-auto-faq']

  it('has the schedule, the first look and the topics and queries for a channel a connector reads, with the automatic replies', () => {
    const out = settings('connector')
    for (const id of [...schedule, ...autoReplies]) expect(out, id).toContain(`data-testid="${id}"`)
    expect(out).toContain('Style of replies')
    expect(out).not.toContain(BROWSER_WATCH_QUERIES_HINT)
  })

  it('has the schedule, the first look and the topics and queries for a channel watched in the browser, but no automatic replies', () => {
    const out = settings('browser')
    for (const id of schedule) expect(out, id).toContain(`data-testid="${id}"`)
    for (const id of autoReplies) expect(out, id).not.toContain(`data-testid="${id}"`)
    expect(out).toContain(BROWSER_WATCH_QUERIES_HINT)
    expect(out).toContain('Check every')
    expect(out).toContain('First look')
    // What it posts is still the owner's own posts.
    expect(out).toContain('Style of posts')
    expect(out).not.toContain('Style of replies')
  })

  it('has none of them for a channel the app neither reads nor watches', () => {
    const out = settings('unread')
    for (const id of [...schedule, ...autoReplies]) expect(out, id).not.toContain(`data-testid="${id}"`)
    expect(out).not.toContain(BROWSER_WATCH_QUERIES_HINT)
    expect(out).toContain('Style of posts')
    // What every channel has.
    expect(out).toContain('data-testid="settings-per-hour"')
    expect(out).toContain('data-testid="settings-languages"')
  })

  it('shows a custom interval field for a channel the AI watches in the browser, as for a connector', () => {
    const custom = { settings: { ...DEFAULT_CHANNEL_SETTINGS, checkIntervalMin: 45 } }
    expect(html(createElement(SettingsForm, { channel: channel('browser', custom) }))).toContain('data-testid="settings-interval"')
    expect(html(createElement(SettingsForm, { channel: channel('unread', custom) }))).not.toContain('data-testid="settings-interval"')
  })
})

describe('the status card', () => {
  const status = (way: Way, over: Partial<Channel> = {}): string =>
    html(createElement(ChannelStatusCard, { channel: channel(way, over), product: undefined, account: undefined, accountLabel: 'brand account', filled: false, onRemoved: () => undefined }))

  it('has the schedule rows for a channel a connector reads, and no reading row', () => {
    const out = status('connector')
    for (const id of ['channel-last-run', 'channel-next-check']) expect(out, id).toContain(`data-testid="${id}"`)
    expect(out).not.toContain('data-testid="channel-reading"')
  })

  it('has the schedule rows for a channel watched in the browser, under a row that says how it is read', () => {
    const out = status('browser', { nextCheckAt: null })
    expect(out).toContain(`data-testid="channel-reading">${BROWSER_WATCH_READING}<`)
    for (const id of ['channel-last-run', 'channel-next-check']) expect(out, id).toContain(`data-testid="${id}"`)
    expect(out).toContain('Last success')
    expect(out.indexOf('channel-reading')).toBeLessThan(out.indexOf('channel-last-run'))
  })

  it('has no reading row for a channel a connector reads, whatever its browser flag says', () => {
    expect(status('connector', { watchedInBrowser: true })).not.toContain('data-testid="channel-reading"')
  })

  it('says only why there is no schedule for a channel the app neither reads nor watches', () => {
    const out = status('unread')
    expect(out).toContain(`data-testid="channel-reading">${OWN_POSTS_READING}<`)
    for (const id of ['channel-last-run', 'channel-next-check']) expect(out, id).not.toContain(`data-testid="${id}"`)
  })

  it('tells what Activate does in the words of the way the channel is looked at', () => {
    const title = (way: Way): string => status(way, { status: 'setup', capabilities: [{ key: 'read_posts', status: 'verified', detail: '', checkedAt: '2026-11-15T08:00:00.000Z' }] }).match(/data-testid="channel-activate"[^>]*/)?.[0] ?? ''
    expect(title('connector')).toContain('baseline')
    expect(title('browser')).toContain('watching it in the browser')
    expect(title('browser')).not.toContain('baseline, then')
    expect(title('unread')).toContain('Nothing is read')
  })
})

describe('the channel page', () => {
  const page = (way: Way): string =>
    html(createElement(ChannelPage, { channel: channel(way), tab: 'status', products: [], accounts: [], platforms: [], planBlockedReason: null, stage: null, onRemoved: () => undefined }))

  it('has "Check now" for a channel the app looks at, through a connector or in the browser, and not for one it does not', () => {
    expect(page('connector')).toContain('data-testid="check-now"')
    expect(page('browser')).toContain('data-testid="check-now"')
    expect(page('unread')).not.toContain('data-testid="check-now"')
  })
})
