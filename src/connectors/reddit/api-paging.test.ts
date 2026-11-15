// The size of a page of a community listing (DEC-040): Reddit gives at most 100 posts a page, so the address never asks for more, whatever a caller passes.
// The listing is scripted; nothing here contacts Reddit.

import { describe, expect, it } from 'vitest'
import type { BrowserPage } from '../../core/ports'
import { RedditFakePage, postThing, T0 } from '../test-helpers'
import { RedditApi } from './api'

const listingOf = (...ids: string[]): unknown => ({ kind: 'Listing', data: { after: null, children: ids.map((id) => postThing({ id, created: T0 })) } })

describe('the address of a page of a listing', () => {
  it('never asks for more than 100 posts a page, and never for fewer than one', async () => {
    const page = new RedditFakePage()
    page.route('/r/test/new.json', listingOf('a1'))
    const api = new RedditApi(page as unknown as BrowserPage)

    await api.listingPage('test', 100_000, null)
    await api.listingPage('test', 1000, null)
    await api.listingPage('test', 100, null)
    await api.listingPage('test', 50, null)
    await api.listingPage('test', 0, null)
    await api.listingPage('test', -5, null)
    await api.listing('test', 500)

    expect(page.fetched).toEqual([
      '/r/test/new.json?limit=100&raw_json=1',
      '/r/test/new.json?limit=100&raw_json=1',
      '/r/test/new.json?limit=100&raw_json=1',
      '/r/test/new.json?limit=50&raw_json=1',
      '/r/test/new.json?limit=1&raw_json=1',
      '/r/test/new.json?limit=1&raw_json=1',
      '/r/test/new.json?limit=100&raw_json=1'
    ])
  })

  it('continues a listing after the post whose token was given, with the same page size', async () => {
    const page = new RedditFakePage()
    page.route('/r/test/new.json', listingOf('a1'))
    await new RedditApi(page as unknown as BrowserPage).listingPage('test', 5000, 't3_abc123')
    expect(page.fetched).toEqual(['/r/test/new.json?limit=100&raw_json=1&after=t3_abc123'])
  })
})
