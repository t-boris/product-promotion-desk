// The post's own text: kept from a page of the post (never from what the AI says), for the post whose own address the page has, and shown on the Feed.

import { afterEach, describe, expect, it } from 'vitest'
import type { WatchItem } from '../browser-agent/watch'
import { FindingStore } from './findings'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const URL_ = 'https://www.reddit.com/r/x/comments/1'
const item = (over: Partial<WatchItem> = {}): WatchItem => ({
  url: URL_,
  title: 'Which app draws a chart with houses?',
  author: 'poster',
  label: 'notice',
  relation: 'Relates to the goal.',
  about: '',
  thread: '',
  replyTo: '',
  comment: '',
  comments: [],
  analysis: '',
  topics: [],
  images: [],
  own: false,
  replies: null,
  score: null,
  ...over
})
const row = (id: string): { body: string; at: string | null } => world.core.db.prepare('SELECT body, body_at AS at FROM findings WHERE id = ?').get(id) as { body: string; at: string | null }
const idOf = (url: string): string => (world.core.db.prepare('SELECT id FROM findings WHERE external_id = ?').get(url) as { id: string }).id

describe('the text of a post', () => {
  it('is empty and undated for a post no page of it was seen for', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    expect(row(idOf(URL_))).toEqual({ body: '', at: null })
    expect(store.list({ productId: world.product.id })[0]?.finding).toMatchObject({ body: '', bodyAt: null })
  })

  it('is kept with the post when the AI records a post whose page was seen, and shown in the list', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item({ body: 'I want a chart with houses.' }), false)
    expect(row(idOf(URL_)).body).toBe('I want a chart with houses.')
    const listed = store.list({ productId: world.product.id })[0]?.finding
    expect(listed?.body).toBe('I want a chart with houses.')
    expect(listed?.bodyAt).toBe(world.clock.now().toISOString())
  })

  it('is given to a post that is known, by the page of that very post, and to no other post', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    store.addWatched(world.product.id, world.channel.id, item({ url: 'https://www.reddit.com/r/x/comments/2', title: 'Another' }), false)
    expect(store.applyBody(world.channel.id, URL_, 'The text of the first post.')).toBe(1)
    expect(row(idOf(URL_)).body).toBe('The text of the first post.')
    expect(row(idOf('https://www.reddit.com/r/x/comments/2'))).toEqual({ body: '', at: null })
    // a page of a post this channel does not know changes nothing
    expect(store.applyBody(world.channel.id, 'https://www.reddit.com/r/x/comments/99', 'Unknown.')).toBe(0)
  })

  it('is not given to the post of another channel that has the same address', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    expect(store.applyBody('another-channel', URL_, 'Not yours.')).toBe(0)
    expect(row(idOf(URL_)).body).toBe('')
  })

  it('keeps the date of a text that did not change, and takes a changed text with a new date', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    store.applyBody(world.channel.id, URL_, 'First.')
    const first = row(idOf(URL_)).at
    world.clock.advance(60_000)
    expect(store.applyBody(world.channel.id, URL_, 'First.')).toBe(0)
    expect(row(idOf(URL_)).at).toBe(first)
    expect(store.applyBody(world.channel.id, URL_, 'Edited.')).toBe(1)
    expect(row(idOf(URL_))).toEqual({ body: 'Edited.', at: world.clock.now().toISOString() })
    expect(row(idOf(URL_)).at).not.toBe(first)
  })

  it('says a post has none of its own (empty and dated), and never wipes a text that was read', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    expect(store.applyBody(world.channel.id, URL_, '')).toBe(1)
    expect(row(idOf(URL_))).toEqual({ body: '', at: world.clock.now().toISOString() })
    store.applyBody(world.channel.id, URL_, 'It has text after all.')
    expect(store.applyBody(world.channel.id, URL_, '')).toBe(0)
    expect(row(idOf(URL_)).body).toBe('It has text after all.')
  })

  it('is matched by the address the post is stored under too, so a post whose stored address differs by a slash is not missed', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    world.core.db.prepare('UPDATE findings SET url = ? WHERE external_id = ?').run(`${URL_}/`, URL_)
    expect(store.applyBody(world.channel.id, `${URL_}/`, 'Found by its stored address.')).toBe(1)
  })

  it('is kept with what the AI read when it reads a post that was found before', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    store.addWatched(world.product.id, world.channel.id, item(), false)
    const read = item({ about: 'The author asks which app draws a chart.', thread: 'Nobody answered.', analysis: 'Open question.', body: 'Which app draws a chart with houses?\n\nThanks.' })
    expect(store.applyRead(idOf(URL_), read)).toBe(true)
    expect(row(idOf(URL_)).body).toBe('Which app draws a chart with houses?\n\nThanks.')
  })
})
