// The Feed screen as a whole, rendered to markup with the application's queries answered from here (the renderer has no test runner of its own; this
// file is compiled with the renderer, like feed-render.test.ts): what the screen offers for each way the app can look at a channel (DEC-042). The
// pieces (the lists of channels, the words) are tested on their own; this shows the screen uses them: "Check now" is for every channel the app looks
// at, the channel pop-up says how a channel is looked at, and an empty list does not claim replies for a product the AI only watches in the browser.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHANNEL_SETTINGS, type Channel, type Product } from '../shared/types'
import { BROWSER_WATCH_NOTE } from '../renderer/src/pages/channels/own-posts'
import { NOTHING_FOUND, NOTHING_FOUND_BROWSER_ONLY } from '../renderer/src/pages/feed/feed-filter'
import type * as Hooks from '../renderer/src/hooks'
import type { FeedPage as FeedPageComponent } from '../renderer/src/pages/Feed'
import type * as ProductContext from '../renderer/src/product-context'

const product = { id: 'p1', name: 'Astro', createdAt: '2026-11-01T08:00:00.000Z' } as unknown as Product

const channel = (id: string, target: string, reads: boolean, watchedInBrowser: boolean): Channel =>
  ({ id, productId: 'p1', accountId: 'a1', platform: reads ? 'reddit' : 'instagram', target, url: `https://example.com/${id}`, mode: 'observe', settings: { ...DEFAULT_CHANNEL_SETTINGS }, capabilities: [], status: 'active', statusDetail: '', baselineDoneAt: null, lookedBackAt: null, lastRunAt: null, lastSuccessAt: null, nextCheckAt: null, plan: null, reads, watchedInBrowser, createdAt: '2026-11-15T08:00:00.000Z' }) as unknown as Channel

// What the screen asks for, by method: the products and the channels; every other list is empty (nothing found yet).
let answers: Record<string, unknown> = {}

vi.mock('../renderer/src/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  useQuery: (method: string) => ({ data: answers[method], error: null, loading: false, reload: () => undefined }),
  useAutomation: () => ({ state: { paused: false }, setPaused: () => Promise.resolve() })
}))

// The product choice is kept in an external store the server renderer cannot read; the screen is for the one product given here.
vi.mock('../renderer/src/product-context', async (importOriginal) => ({
  ...(await importOriginal<typeof ProductContext>()),
  useCurrentProduct: () => ({ products: [product], current: product, setCurrent: () => undefined, setCreated: () => undefined, loading: false, error: null })
}))

let FeedPage: typeof FeedPageComponent

beforeAll(async () => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
  ;({ FeedPage } = await import('../renderer/src/pages/Feed'))
})

const feed = (channels: Channel[]): string => {
  answers = { 'products.list': [product], 'channels.list': channels }
  return renderToStaticMarkup(createElement(FeedPage))
}

const CONNECTOR = channel('c1', 'r/astrology', true, false)
const INSTAGRAM = channel('c2', '@brand', false, true)
const OWN = channel('c3', '@own', false, false)

describe('the Feed for a product whose channels the AI watches in the browser (DEC-042)', () => {
  it('offers "Check now" for a channel watched in the browser, and for a channel a connector reads, but not for one that is neither', () => {
    expect(feed([INSTAGRAM])).toContain('data-testid="check-now"')
    expect(feed([CONNECTOR])).toContain('data-testid="check-now"')
    expect(feed([OWN])).not.toContain('data-testid="check-now"')
  })

  it('does not offer the older discussions for a channel only watched in the browser: a connector reads them', () => {
    expect(feed([INSTAGRAM])).not.toContain('data-testid="feed-older"')
    expect(feed([CONNECTOR, INSTAGRAM])).toContain('data-testid="feed-older"')
  })

  it('says in the channel pop-up how each channel is looked at', () => {
    const out = feed([CONNECTOR, INSTAGRAM, OWN])
    expect(out).toContain('>r/astrology</option>')
    expect(out).toContain('>@brand (in the browser)</option>')
    expect(out).toContain('>@own (not read)</option>')
  })

  it('is not the "nothing to read here" screen for a product that only has channels the AI watches in the browser', () => {
    const out = feed([INSTAGRAM])
    expect(out).not.toContain('Nothing to read here')
    expect(out).toContain('Nothing found yet')
    expect(out).toContain(NOTHING_FOUND_BROWSER_ONLY)
    expect(out).toContain(BROWSER_WATCH_NOTE)
  })

  it('keeps the other empty screens as they were', () => {
    expect(feed([OWN])).toContain('Nothing to read here')
    expect(feed([OWN])).not.toContain(BROWSER_WATCH_NOTE)
    const read = feed([CONNECTOR, INSTAGRAM])
    expect(read).toContain(NOTHING_FOUND)
    expect(read).not.toContain(NOTHING_FOUND_BROWSER_ONLY)
  })
})
