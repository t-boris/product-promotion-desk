// Profiles (DEC-019): a person the owner makes up once, for a purpose. The AI proposes it, the owner edits and approves it, the picture is made by an
// engine or chosen by the owner. Accounts are the logins of a profile: one per platform, and an account belongs to one profile.

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

/** A world with one account and a new, empty profile that has that account as its login. */
type Scene = World & { profileId: string }

async function world(): Promise<Scene> {
  const w = await makeReadyWorld()
  w.t.engine.on('accounts.profile', () => proposal())
  const profile = await w.call('profiles.create', { label: 'Selena, Natal Mystic', productId: w.productId, accountIds: [w.account.id] })
  return Object.assign(w, { profileId: profile.id })
}
const propose = (w: Scene, purpose?: string) => w.call('profiles.propose', { id: w.profileId, purpose })
const get = (w: Scene) => w.call('profiles.get', { id: w.profileId })

const NORA = { firstName: 'Nora', lastName: 'Vale', displayName: 'Nora Vale', username: 'nora.vale', birthDate: '1991-01-05', gender: 'female' as const, place: 'Berlin', about: 'I build things.', website: '', pictureIdea: '' }

describe('a profile and its accounts', () => {
  it('is made empty, takes the accounts the person already has, and its platforms follow from them', async () => {
    const w = await world()
    const profile = await get(w)
    expect(profile).toMatchObject({ label: 'Selena, Natal Mystic', productId: w.productId, platforms: [w.fake.platform], status: 'proposed', displayName: '', strategy: '', hasPicture: false })
    const accounts = await w.call('accounts.list', undefined)
    expect(accounts.find((a) => a.id === w.account.id)?.profileId).toBe(w.profileId)
  })

  it('has one account per platform, and an account belongs to one profile only', async () => {
    const w = await world()
    const second = await w.addAccount('A second login on the same platform')
    expect(await w.refusal('profiles.create', { label: 'Taken', accountIds: [w.account.id] })).toBe('in_use')
    const other = await w.addAccount('Another')
    expect(await w.refusal('profiles.create', { label: 'Same platform twice', accountIds: [second.id, other.id] })).toBe('profile_has_account')
    expect((await w.call('accounts.list', undefined)).find((a) => a.id === second.id)?.profileId).toBeNull() // a refusal leaves nothing half made
  })

  it('refuses an empty name, a product or a platform that does not exist', async () => {
    const w = await world()
    expect(await w.refusal('profiles.create', { label: '  ' })).toBe('invalid_input')
    expect(await w.refusal('profiles.create', { label: 'x', productId: 'nope' })).toBe('not_found')
    expect(await w.refusal('profiles.create', { label: 'x', platforms: ['nowhere'] })).toBe('invalid_input')
  })
})

describe('the AI proposes the whole profile', () => {
  it('stores it as a proposal with the strategy and a reason per choice; nothing is typed anywhere', async () => {
    const w = await world()
    const saved = await propose(w, 'Answer beginners about natal charts')
    expect(saved).toMatchObject({ id: w.profileId, status: 'proposed', firstName: 'Selena', username: 'selena.builds', hasPicture: false })
    expect(saved.strategy).toContain('hobby astrologers')
    expect(saved.reasons.birthDate).toContain('Mid-thirties')
    expect(await get(w)).toEqual(saved)
    expect(w.t.browser.page(w.account.id).log).toEqual([])
    const task = w.t.engine.calls[0]
    expect(task.label).toBe('accounts.profile')
    expect(task.prompt).toContain('Answer beginners about natal charts')
    expect(task.prompt).toContain('Natal Mystic')
    expect(task.prompt).toContain(`Platforms the person is meant for: ${w.fake.platform}`)
  })

  it('tells the AI about the accounts the person already has: the new person must fit them', async () => {
    const w = await world()
    await propose(w, 'x')
    expect(w.t.engine.calls[0].prompt).toContain(`called "${w.account.label}" by the owner`)
  })

  it('keeps the purpose of the profile for the next proposal (the owner may have edited it), and a new proposal needs approval again', async () => {
    const w = await world()
    const first = await propose(w, 'Answer beginners about natal charts')
    await w.call('profiles.save', { id: w.profileId, profile: first, purpose: 'Only answer questions about birth time' })
    expect((await w.call('profiles.approve', { id: w.profileId })).status).toBe('approved')
    const again = await propose(w)
    expect(again.status).toBe('proposed')
    expect(w.t.engine.calls[1].prompt).toContain('Only answer questions about birth time')
  })

  it('tells the AI about the other profiles the owner has, so the new person is not a copy', async () => {
    const w = await world()
    const other = await w.call('profiles.create', { label: 'Nora' })
    await w.call('profiles.save', { id: other.id, profile: NORA })
    await propose(w, 'x')
    expect(w.t.engine.calls[0].prompt).toContain('Nora Vale')
    expect(w.t.engine.calls[0].prompt).not.toContain('nora.vale')
  })

  it('needs an engine that is ready, and says it in words', async () => {
    const w = await world()
    w.t.engine.installed = false
    expect(await w.refusal('profiles.propose', { id: w.profileId })).toBe('engine_unavailable')
    w.t.engine.installed = true
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('profiles.propose', { id: w.profileId })).toBe('no_engine')
  })

  it('turns an engine failure into an error the screen can show, and leaves the profile as it was', async () => {
    const w = await world()
    w.t.engine.on('accounts.profile', () => 'not json at all')
    w.t.engine.on('accounts.profile.repair', () => 'still not json')
    expect(await w.refusal('profiles.propose', { id: w.profileId })).toBe('profile_failed')
    expect(await get(w)).toMatchObject({ displayName: '', strategy: '' })
  })
})

describe('the owner edits and approves', () => {
  it('approves a complete profile; an edit makes it a proposal again; the same values do not', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    const approved = await w.call('profiles.approve', { id: w.profileId })
    expect(approved.status).toBe('approved')
    const same = await w.call('profiles.save', { id: w.profileId, profile: proposed })
    expect(same.status).toBe('approved')
    const edited = await w.call('profiles.save', { id: w.profileId, profile: { ...proposed, place: 'Porto, Portugal' } })
    expect(edited).toMatchObject({ status: 'proposed', place: 'Porto, Portugal' })
    // What the AI explained stays with the profile after an edit.
    expect(edited.strategy).toBe(proposed.strategy)
    expect(edited.reasons.birthDate).toBe(proposed.reasons.birthDate)
  })

  it('a new name for the owner\'s own list or another list of platforms is not a new person: the approval stays', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    await w.call('profiles.approve', { id: w.profileId })
    const renamed = await w.call('profiles.save', { id: w.profileId, profile: proposed, label: 'Selena (main)', platforms: [w.fake.platform] })
    expect(renamed).toMatchObject({ status: 'approved', label: 'Selena (main)' })
  })

  it('drops the reason of a value the owner changed: it would explain the old value', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    expect(proposed.reasons.birthDate).toBeTruthy()
    const edited = await w.call('profiles.save', { id: w.profileId, profile: { ...proposed, birthDate: '1990-01-01' } })
    expect(edited.reasons.birthDate).toBeUndefined()
    expect(edited.reasons).toEqual({})
  })

  it('refuses to approve what is not complete', async () => {
    const w = await world()
    expect(await w.refusal('profiles.approve', { id: w.profileId })).toBe('profile_incomplete') // nothing proposed yet
    await w.call('profiles.save', { id: w.profileId, profile: { firstName: 'Selena' } as never })
    expect(await w.refusal('profiles.approve', { id: w.profileId })).toBe('profile_incomplete')
  })

  it('refuses a minor and an unusable user name, with the reason', async () => {
    const w = await world()
    const proposed = await propose(w, 'x')
    expect(await w.refusal('profiles.save', { id: w.profileId, profile: { ...proposed, birthDate: '2015-01-01' } })).toBe('invalid_profile')
    expect(await w.refusal('profiles.save', { id: w.profileId, profile: { ...proposed, username: 'a b' } })).toBe('invalid_profile')
    expect((await get(w)).birthDate).toBe('1989-04-02')
  })

  it('refuses a profile that does not exist', async () => {
    const w = await world()
    expect(await w.refusal('profiles.get', { id: 'nope' })).toBe('not_found')
    expect(await w.refusal('profiles.propose', { id: 'nope' })).toBe('not_found')
    expect(await w.refusal('profiles.approve', { id: 'nope' })).toBe('not_found')
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
  const folder = (w: Scene) => join(w.core.dataDir, 'profiles', w.profileId)

  it('is made by the engine from the description in the profile, kept in the profile\'s folder, and shown as a data address', async () => {
    const w = await world()
    await propose(w, 'x')
    makesPicture(w)
    const saved = await w.call('profiles.makePicture', { id: w.profileId })
    expect(saved.hasPicture).toBe(true)
    const task = w.t.engine.calls.find((c) => c.label === 'accounts.picture') as AiTask
    expect(task.makeFiles?.dir.startsWith(folder(w))).toBe(true)
    expect(task.prompt).toContain('A friendly portrait of a woman in her thirties at a desk with a laptop')
    expect(task.prompt).toContain('picture.png')
    expect(task.prompt).toContain('real or famous person')
    expect(readdirSync(folder(w))).toEqual(['picture.png']) // the work folder is gone
    const shown = await w.call('profiles.picture', { id: w.profileId })
    expect(shown?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('does not change the approval by itself being made, but replaces the one before', async () => {
    const w = await world()
    await propose(w, 'x')
    await w.call('profiles.approve', { id: w.profileId })
    makesPicture(w, 'face.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]))
    const saved = await w.call('profiles.makePicture', { id: w.profileId })
    expect(saved.status).toBe('approved')
    expect(readdirSync(folder(w))).toEqual(['picture.jpg'])
    makesPicture(w)
    await w.call('profiles.makePicture', { id: w.profileId })
    expect(readdirSync(folder(w))).toEqual(['picture.png'])
  })

  it('needs a description, an engine with an image tool, and a real picture file', async () => {
    const w = await world()
    await propose(w, 'x')
    const current = await get(w)
    await w.call('profiles.save', { id: w.profileId, profile: { ...current, pictureIdea: '' } })
    expect(await w.refusal('profiles.makePicture', { id: w.profileId })).toBe('no_picture_idea')
    await w.call('profiles.save', { id: w.profileId, profile: { ...current, pictureIdea: 'A portrait' } })
    w.t.engine.makesImages = false
    expect(await w.refusal('profiles.makePicture', { id: w.profileId })).toBe('no_image_engine')
    w.t.engine.makesImages = true
    w.t.engine.on('accounts.picture', () => 'done') // says done, makes nothing
    expect(await w.refusal('profiles.makePicture', { id: w.profileId })).toBe('picture_failed')
    makesPicture(w, 'picture.png', Buffer.from('this is not a picture'))
    expect(await w.refusal('profiles.makePicture', { id: w.profileId })).toBe('invalid_picture')
    expect((await get(w)).hasPicture).toBe(false)
    expect(existsSync(folder(w)) ? readdirSync(folder(w)) : []).toEqual([])
  })

  it('can be the owner\'s own file instead', async () => {
    const w = await world()
    await propose(w, 'x')
    const mine = join(w.core.dataDir, 'mine.png')
    writeFileSync(mine, PNG)
    const saved = await w.call('profiles.setPicture', { id: w.profileId, path: mine })
    expect(saved.hasPicture).toBe(true)
    expect(w.t.engine.calls.some((c) => c.label === 'accounts.picture')).toBe(false)
    expect(readdirSync(folder(w))).toEqual(['picture.png'])
    expect(await w.refusal('profiles.setPicture', { id: w.profileId, path: join(w.core.dataDir, 'missing.png') })).toBe('invalid_picture')
    expect(await w.refusal('profiles.setPicture', { id: w.profileId, path: 'relative.png' })).toBe('invalid_picture')
  })

  it('goes with the profile when it is removed, and the profile is removed only when no account belongs to it', async () => {
    const w = await world()
    await propose(w, 'x')
    makesPicture(w)
    await w.call('profiles.makePicture', { id: w.profileId })
    expect(existsSync(folder(w))).toBe(true)
    expect(await w.refusal('profiles.remove', { id: w.profileId })).toBe('in_use')
    expect(existsSync(folder(w))).toBe(true)
    await w.call('accounts.setProfile', { accountId: w.account.id, profileId: null })
    await w.call('profiles.remove', { id: w.profileId })
    expect(existsSync(folder(w))).toBe(false)
    expect(await w.refusal('profiles.get', { id: w.profileId })).toBe('not_found')
  })

  it('has none until one is made', async () => {
    const w = await world()
    await propose(w, 'x')
    expect(await w.call('profiles.picture', { id: w.profileId })).toBeNull()
  })
})
