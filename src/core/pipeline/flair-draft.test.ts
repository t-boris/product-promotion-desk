// The flair of a post is part of what the owner approves: it is kept when the words are rewritten, taken off only when the owner says so,
// withdraws the approval when it changes, and never changes a hash that was given before flairs existed.

import { afterEach, describe, expect, it } from 'vitest'
import { contentHash } from './hash'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)
const latest = (id: string) => world.core.repos.latestDraft(id)!

function newPost() {
  world = makeWorld()
  return world.store.createStandalone(world.channel, 'draft', 'A post of the owner')
}

describe('the flair of a draft', () => {
  it('is stored by name, trimmed and in one line, and is none when it was not given', async () => {
    const opp = newPost()
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body' } })
    expect(latest(opp.id).flair).toBeNull()
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body', flair: '  Question -   Transits ' } })
    expect(latest(opp.id).flair).toBe('Question - Transits')
  })

  it('stays when the words are rewritten by a caller that does not know it, and goes only when the owner takes it off', async () => {
    const opp = newPost()
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body', flair: 'Discussion' } })
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body, rewritten' } })
    expect(latest(opp.id).text).toBe('body, rewritten')
    expect(latest(opp.id).flair).toBe('Discussion')
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body, rewritten', flair: null } })
    expect(latest(opp.id).flair).toBeNull()
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'again', flair: 'Discussion' } })
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'again', flair: '   ' } })
    expect(latest(opp.id).flair).toBeNull()
  })

  it('refuses a flair that is not a short label', async () => {
    const opp = newPost()
    await expect(call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body', flair: 'x'.repeat(101) } })).rejects.toThrow(/flair is longer/)
  })

  it('withdraws the approval when it changes, like any other part of the post', async () => {
    const opp = newPost()
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body', flair: 'Discussion' } })
    await call('opportunities.approve', { id: opp.id })
    expect(world.opportunity(opp.id).state).toBe('ready')
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body', flair: 'Question - Career' } })
    expect(world.opportunity(opp.id).state).not.toBe('ready')
  })

  it('is part of the hash only when set: a draft without one hashes exactly as it did before flairs existed', () => {
    const base = { title: 'T', text: 'body', link: null, attachments: [] }
    const account = { id: 'acc', identity: 'brand' }
    const plain = contentHash(base, account, 'https://x/y', 'reddit')
    expect(contentHash({ ...base, flair: null }, account, 'https://x/y', 'reddit')).toBe(plain)
    expect(contentHash({ ...base, flair: '' }, account, 'https://x/y', 'reddit')).toBe(plain)
    expect(contentHash({ ...base, flair: undefined }, account, 'https://x/y', 'reddit')).toBe(plain)
    const withFlair = contentHash({ ...base, flair: 'Discussion' }, account, 'https://x/y', 'reddit')
    expect(withFlair).not.toBe(plain)
    expect(contentHash({ ...base, flair: 'Question - Career' }, account, 'https://x/y', 'reddit')).not.toBe(withFlair)
  })

  it('reaches the request a connector or a mission is given', async () => {
    const opp = newPost()
    await call('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'body', flair: 'Discussion' } })
    const { buildPublishRequest } = await import('./request')
    const request = buildPublishRequest(world.opportunity(opp.id), latest(opp.id), null, world.channel.url, world.channel.platform)
    expect(request.flair).toBe('Discussion')
  })
})
