// The profile of an account (DEC-019): the AI proposes it, the owner edits and approves it, the picture is made by an engine or chosen by the owner.

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AccountProfile } from '../../shared/types'
import type { AiTask } from '../ports'
import { makeReadyWorld, type World } from './test-helpers'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const proposal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    purpose: 'Be the approachable developer of Natal Mystic for hobby astrologers',
    strategy: 'The audience is hobby astrologers, mostly women 25 to 45; an open developer in her mid-thirties fits.',
    firstName: 'Selena',
    lastName: 'Marlowe',
    displayName: 'Selena Marlowe',
    username: 'selena.builds',
    birthDate: '1989-04-02',
    gender: 'female',
    place: 'Lisbon, Portugal',
    about: 'I build Natal Mystic, a natal chart calculator.',
    website: 'https://natal.example/',
    pictureIdea: 'A friendly portrait of a woman in her thirties at a desk with a laptop',
    reasons: { birthDate: 'Mid-thirties matches the audience.' },
    ...over
  })

async function world(): Promise<World> {
  const w = await makeReadyWorld()
  w.t.engine.on('accounts.profile', () => proposal())
  return w
}
const propose = (w: World, purpose?: string) => w.call('profile.propose', { accountId: w.account.id, purpose })

describe('the AI proposes the whole profile', () => {
  it('stores it as a proposal with the strategy and a reason per choice; nothing is typed anywhere', async () => {
    const w = await world()
    const saved = await propose(w, 'Answer beginners about natal charts')
    expect(saved).toMatchObject({ accountId: w.account.id, status: 'proposed', firstName: 'Selena', username: 'selena.builds', hasPicture: false })
    expect(saved.strategy).toContain('hobby astrologers')
    expect(saved.reasons.birthDate).toContain('Mid-thirties')
    expect(await w.call('profile.get', { accountId: w.account.id })).toEqual(saved)
    expect(w.t.browser.page(w.account.id).log).toEqual([])
    const task = w.t.engine.calls[0]
    expect(task.label).toBe('accounts.profile')
    expect(task.prompt).toContain('Answer beginners about natal charts')
    expect(task.prompt).toContain('Natal Mystic')
    expect(task.prompt).toContain('Platform: fake')
  })

  it('keeps the purpose of the profile for the next proposal (the owner may have edited it), and a new proposal needs approval again', async () => {
    const w = await world()
    const first = await propose(w, 'Answer beginners about natal charts')
    await w.call('profile.approve', { accountId: w.account.id })
    await w.call('profile.save', { accountId: w.account.id, profile: first, purpose: 'Only answer questions about birth time' })
    const again = await propose(w)
    expect(again.status).toBe('proposed')
    expect(w.t.engine.calls[1].prompt).toContain('Only answer questions about birth time')
  })

  it('tells the AI about the other profiles on the platform, so the new person is not a copy', async () => {
    const w = await world()
    const other = await w.addAccount('Other Reddit')
    await w.call('profile.save', { accountId: other.id, profile: { firstName: 'Nora', lastName: 'Vale', displayName: 'Nora Vale', username: 'nora.vale', birthDate: '1991-01-05', gender: 'female', place: 'Berlin', about: 'I build things.', website: '', pictureIdea: '' } })
    await propose(w, 'x')
    expect(w.t.engine.calls[0].prompt).toContain('Nora Vale')
    expect(w.t.engine.calls[0].prompt).not.toContain('nora.vale')
  })

  it('needs an engine that is ready, and says it in words', async () => {
    const w = await world()
    w.t.engine.installed = false
    expect(await w.refusal('profile.propose', { accountId: w.account.id })).toBe('engine_unavailable')
    w.t.engine.installed = true
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('profile.propose', { accountId: w.account.id })).toBe('no_engine')
  })

  it('turns an engine failure into an error the screen can show', async () => {
    const w = await world()
    w.t.engine.on('accounts.profile', () => 'not json at all')
    w.t.engine.on('accounts.profile.repair', () => 'still not json')
    expect(await w.refusal('profile.propose', { accountId: w.account.id })).toBe('profile_failed')
    expect(await w.call('profile.get', { accountId: w.account.id })).toBeNull()
  })
})

describe('the owner edits and approves', () => {
  it('approves a complete profile; an edit makes it a proposal again; the same values do not', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    const approved = await w.call('profile.approve', { accountId: w.account.id })
    expect(approved.status).toBe('approved')
    const same = await w.call('profile.save', { accountId: w.account.id, profile: proposed })
    expect(same.status).toBe('approved')
    const edited = await w.call('profile.save', { accountId: w.account.id, profile: { ...proposed, place: 'Porto, Portugal' } })
    expect(edited).toMatchObject({ status: 'proposed', place: 'Porto, Portugal' })
    // What the AI explained stays with the profile after an edit.
    expect(edited.strategy).toBe(proposed.strategy)
    expect(edited.reasons.birthDate).toBe(proposed.reasons.birthDate)
  })

  it('drops the reason of a value the owner changed: it would explain the old value', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    expect(proposed.reasons.birthDate).toBeTruthy()
    const edited = await w.call('profile.save', { accountId: w.account.id, profile: { ...proposed, birthDate: '1990-01-01' } })
    expect(edited.reasons.birthDate).toBeUndefined()
    expect(edited.reasons).toEqual({})
  })

  it('refuses to approve what is not there or not complete', async () => {
    const w = await world()
    expect(await w.refusal('profile.approve', { accountId: w.account.id })).toBe('no_profile')
    await w.call('profile.save', { accountId: w.account.id, profile: { firstName: 'Selena' } as never })
    expect(await w.refusal('profile.approve', { accountId: w.account.id })).toBe('profile_incomplete')
  })

  it('refuses a minor and an unusable user name, with the reason', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    expect(await w.refusal('profile.save', { accountId: w.account.id, profile: { ...proposed, birthDate: '2015-01-01' } })).toBe('invalid_profile')
    expect(await w.refusal('profile.save', { accountId: w.account.id, profile: { ...proposed, username: 'a b' } })).toBe('invalid_profile')
    expect((await w.call('profile.get', { accountId: w.account.id }))?.birthDate).toBe('1989-04-02')
  })

  it('refuses an account that does not exist', async () => {
    const w = await world()
    expect(await w.refusal('profile.get', { accountId: 'nope' })).toBe('not_found')
  })
})

describe('the picture', () => {
  /** What Codex does: it makes a file in the folder it was given. */
  const makesPicture = (w: World, name = 'picture.png', bytes: Buffer = PNG): void => {
    w.t.engine.on('accounts.picture', (task: AiTask) => {
      writeFileSync(join(task.makeFiles?.dir ?? '/nowhere', name), bytes)
      return 'done'
    })
  }
  const folder = (w: World) => join(w.core.dataDir, 'profiles', w.account.id)

  it('is made by the engine from the description in the profile, kept in the account\'s folder, and shown as a data address', async () => {
    const w = await world()
    await propose(w, 'x')
    makesPicture(w)
    const saved = await w.call('profile.makePicture', { accountId: w.account.id })
    expect(saved.hasPicture).toBe(true)
    const task = w.t.engine.calls.find((c) => c.label === 'accounts.picture') as AiTask
    expect(task.makeFiles?.dir.startsWith(folder(w))).toBe(true)
    expect(task.prompt).toContain('A friendly portrait of a woman in her thirties at a desk with a laptop')
    expect(task.prompt).toContain('picture.png')
    expect(task.prompt).toContain('real or famous person')
    expect(readdirSync(folder(w))).toEqual(['picture.png']) // the work folder is gone
    const shown = await w.call('profile.picture', { accountId: w.account.id })
    expect(shown?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('does not change the approval by itself being made, but replaces the one before', async () => {
    const w = await world()
    await propose(w, 'x')
    await w.call('profile.approve', { accountId: w.account.id })
    makesPicture(w, 'face.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]))
    const saved = await w.call('profile.makePicture', { accountId: w.account.id })
    expect(saved.status).toBe('approved')
    expect(readdirSync(folder(w))).toEqual(['picture.jpg'])
    makesPicture(w)
    await w.call('profile.makePicture', { accountId: w.account.id })
    expect(readdirSync(folder(w))).toEqual(['picture.png'])
  })

  it('needs a description, an engine with an image tool, and a real picture file', async () => {
    const w = await world()
    await propose(w, 'x')
    const current = (await w.call('profile.get', { accountId: w.account.id })) as AccountProfile
    await w.call('profile.save', { accountId: w.account.id, profile: { ...current, pictureIdea: '' } })
    expect(await w.refusal('profile.makePicture', { accountId: w.account.id })).toBe('no_picture_idea')
    await w.call('profile.save', { accountId: w.account.id, profile: { ...current, pictureIdea: 'A portrait' } })
    w.t.engine.makesImages = false
    expect(await w.refusal('profile.makePicture', { accountId: w.account.id })).toBe('no_image_engine')
    w.t.engine.makesImages = true
    w.t.engine.on('accounts.picture', () => 'done') // says done, makes nothing
    expect(await w.refusal('profile.makePicture', { accountId: w.account.id })).toBe('picture_failed')
    makesPicture(w, 'picture.png', Buffer.from('this is not a picture'))
    expect(await w.refusal('profile.makePicture', { accountId: w.account.id })).toBe('invalid_picture')
    expect((await w.call('profile.get', { accountId: w.account.id }))?.hasPicture).toBe(false)
    expect(existsSync(folder(w)) ? readdirSync(folder(w)) : []).toEqual([])
  })

  it('can be the owner\'s own file instead', async () => {
    const w = await world()
    await propose(w, 'x')
    const mine = join(w.core.dataDir, 'mine.png')
    writeFileSync(mine, PNG)
    const saved = await w.call('profile.setPicture', { accountId: w.account.id, path: mine })
    expect(saved.hasPicture).toBe(true)
    expect(w.t.engine.calls.some((c) => c.label === 'accounts.picture')).toBe(false)
    expect(readdirSync(folder(w))).toEqual(['picture.png'])
    expect(await w.refusal('profile.setPicture', { accountId: w.account.id, path: join(w.core.dataDir, 'missing.png') })).toBe('invalid_picture')
    expect(await w.refusal('profile.setPicture', { accountId: w.account.id, path: 'relative.png' })).toBe('invalid_picture')
  })

  it('goes with the account when it is removed', async () => {
    const w = await world()
    await propose(w, 'x')
    makesPicture(w)
    await w.call('profile.makePicture', { accountId: w.account.id })
    expect(existsSync(folder(w))).toBe(true)
    await w.call('accounts.remove', { id: w.account.id })
    expect(existsSync(folder(w))).toBe(false)
  })

  it('has none until one is made', async () => {
    const w = await world()
    await propose(w, 'x')
    expect(await w.call('profile.picture', { accountId: w.account.id })).toBeNull()
  })
})
