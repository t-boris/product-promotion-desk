// Profiles (DEC-019): a person the owner makes up once, for a purpose. The AI proposes the whole person as a strategy; the owner edits and
// approves it once; every mission after that takes the personal values from here and invents nothing. A profile has many accounts (its
// logins on platforms, at most one per platform); a platform can have many profiles. The picture is made by an engine's image tool or
// chosen by the owner, and lives in the data folder.

import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { ApiError } from '../../shared/api'
import type { Account, AccountRole, Profile, ProfileFields } from '../../shared/types'
import { sameFields } from '../../shared/profile'
import { validateAttachments } from '../pipeline/attachments'
import type { Core } from '../core'
import { AiError, type AiEngine } from '../ports'
import type { proposeProfile } from './ai-help'
import { found, requireText } from './errors'
import { missingIdentity, readProfileFields } from './profile-fields'
import { listPlatforms } from './platforms'
import { presetFor } from './presets'
import { parseRole } from './roles'
import type { ChannelsStore } from './store'

const PICTURE_TIMEOUT_MS = 6 * 60 * 1000
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const MAX_LABEL = 80
const MAX_PURPOSE = 400

export interface ProfileHelp {
  proposeProfile: typeof proposeProfile
}

export class PersonProfileService {
  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore,
    private readonly ai: ProfileHelp
  ) {}

  private folder(profileId: string): string {
    return join(this.core.dataDir, 'profiles', profileId)
  }

  list(): Profile[] {
    return this.store.listProfiles()
  }

  get(id: unknown): Profile {
    return this.existing(id).profile
  }

  private existing(id: unknown): NonNullable<ReturnType<ChannelsStore['profile']>> {
    return found(() => {
      const row = this.store.profile(requireText(id, 'The profile'))
      if (!row) throw new Error('not found')
      return row
    }, 'The profile')
  }

  /** The approved profile a mission works from; the reason in words when the account has none. */
  approved(account: Account): Profile {
    if (!account.profileId) throw new ApiError('no_profile', `${account.label} does not belong to a profile yet. Choose or make the profile of this account first.`)
    const profile = this.store.profile(account.profileId)?.profile
    if (!profile) throw new ApiError('no_profile', `The profile of ${account.label} was not found.`)
    if (profile.status !== 'approved') throw new ApiError('profile_not_approved', `The profile "${profile.label}" is not approved yet. Read it, change what you want and approve it.`)
    return profile
  }

  /** A new, empty profile. The AI proposes the person afterwards, from the purpose. */
  create(args: { label: string; productId?: string | null; platforms?: string[]; purpose?: string; accountIds?: string[] }): Profile {
    const label = requireText(args.label, 'The profile name').replace(/\s+/g, ' ')
    if (label.length > MAX_LABEL) throw new ApiError('invalid_input', `The profile name is too long (limit ${MAX_LABEL} characters).`)
    const productId = this.knownProduct(args.productId)
    // Accounts the person already has become its accounts: they are checked first, so a refusal leaves nothing half made.
    const existing = this.freeAccounts(args.accountIds)
    const platforms = [...new Set([...this.knownPlatforms(args.platforms), ...existing.map((a) => a.platform)])]
    const created = this.store.insertProfile({ label, productId, platforms, purpose: cleanPurpose(args.purpose) })
    for (const account of existing) this.store.setAccountProfile(account.id, created.id)
    this.core.log.info('accounts', `Profile created: ${label}${existing.length > 0 ? `, with ${existing.length} account${existing.length === 1 ? '' : 's'} it already had` : ''}.`)
    this.core.events.changed('accounts')
    return created
  }

  /** The accounts named for a new profile: each exists, belongs to no profile yet, and no two are on the same platform. */
  private freeAccounts(ids: unknown): Account[] {
    if (ids === undefined || ids === null) return []
    if (!Array.isArray(ids)) throw new ApiError('invalid_input', 'The accounts must be a list.')
    const accounts: Account[] = []
    for (const id of new Set(ids.map((item) => String(item)))) {
      const account = found(() => this.core.repos.account(requireText(id, 'The account')), 'The account')
      if (account.profileId) throw new ApiError('in_use', `${account.label} already belongs to a profile. Take it out of that profile first.`)
      const same = accounts.find((a) => a.platform === account.platform)
      if (same) throw new ApiError('profile_has_account', `${same.label} and ${account.label} are both on ${account.platform}: a profile has one account per platform. Choose one of them.`)
      accounts.push(account)
    }
    return accounts
  }

  private knownProduct(id: unknown): string | null {
    if (id === undefined || id === null || id === '') return null
    return found(() => this.core.repos.product(requireText(id, 'The product')), 'The product').id
  }

  private knownPlatforms(platforms: unknown): string[] {
    if (platforms === undefined || platforms === null) return []
    if (!Array.isArray(platforms)) throw new ApiError('invalid_input', 'The platforms must be a list.')
    const known = listPlatforms(this.core.connectors).map((p) => p.platform)
    const result: string[] = []
    for (const item of platforms) {
      const key = String(item).trim().toLowerCase()
      if (!known.includes(key)) throw new ApiError('invalid_input', `Unknown platform "${key}". Available: ${known.join(', ') || 'none'}.`)
      if (!result.includes(key)) result.push(key)
    }
    return result
  }

  /** The whole person as the AI's strategy for a purpose. A proposal only: it replaces an earlier one, and the owner has to approve it again. */
  async propose(args: { id: string; purpose?: string }): Promise<Profile> {
    const { profile: current, pictureFile } = this.existing(args.id)
    const engine = this.core.engines.selected()
    if (!engine) throw new ApiError('no_engine', 'No AI engine is selected. Choose Claude Code or Codex in Settings.')
    const status = await engine.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)

    const purpose = typeof args.purpose === 'string' && args.purpose.trim() ? cleanPurpose(args.purpose) : current.purpose
    const product = current.productId ? this.productContext(current.productId) : null
    const platforms = current.platforms.map((platform) => ({ platform, label: presetFor(platform)?.label ?? platform }))
    const others = this.store
      .listProfiles()
      .filter((p) => p.id !== current.id && p.displayName !== '')
      .map((p) => ({ displayName: p.displayName, gender: p.gender, birthYear: p.birthDate.slice(0, 4), place: p.place, about: p.about }))
    try {
      const proposal = await this.ai.proposeProfile(engine, {
        purpose,
        product: product?.product ?? null,
        claims: product?.claims ?? [],
        platforms,
        role: current.role,
        others,
        accounts: this.store.accountsOfProfile(current.id).map((a) => ({
          platform: presetFor(a.platform)?.label ?? a.platform,
          label: a.label,
          identity: a.identity ?? a.loginName,
          email: a.email
        })),
        today: this.core.clock.now().toISOString().slice(0, 10),
        subject: current.id
      })
      const saved = this.store.saveProfile(current.id, {
        label: current.label,
        productId: current.productId,
        role: current.role,
        platforms: current.platforms,
        purpose: proposal.purpose,
        strategy: proposal.strategy,
        fields: proposal.fields,
        reasons: proposal.reasons,
        status: 'proposed',
        pictureFile
      })
      this.core.log.info('accounts', `The AI proposed the profile "${saved.label}": ${saved.displayName}. It waits for your approval.`)
      this.core.events.changed('accounts')
      return saved
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('profile_failed', error.message)
      throw error
    }
  }

  /** The approved statements of the product the profile speaks for, when it has a product with an approved passport; the profile is proposed without them otherwise. */
  private productContext(productId: string): { product: { name: string; websiteUrl: string | null; description: string | null }; claims: { section: never; text: string }[] } | null {
    try {
      const product = this.core.repos.product(productId)
      const knowledge = this.core.services.knowledge
      const claims = knowledge && knowledge.activeVersionId(product.id) !== null ? knowledge.approvedClaims(product.id).map((c) => ({ section: c.section as never, text: c.text })) : []
      return { product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description }, claims }
    } catch {
      return null
    }
  }

  /** The owner's own edits. A change to an approved profile makes it a proposal again: it is approved again on purpose. */
  save(args: { id: string; profile: unknown; label?: string; purpose?: string; role?: AccountRole | null; platforms?: string[]; productId?: string | null }): Profile {
    const { profile: current, pictureFile } = this.existing(args.id)
    const read = readProfileFields(args.profile, this.core.clock.now())
    if (!read.ok) throw new ApiError('invalid_profile', read.error)
    const label = args.label === undefined ? current.label : requireText(args.label, 'The profile name').replace(/\s+/g, ' ').slice(0, MAX_LABEL)
    const purpose = args.purpose === undefined ? current.purpose : cleanPurpose(args.purpose)
    const role = args.role === undefined ? current.role : parseRole(args.role)
    const platforms = args.platforms === undefined ? current.platforms : this.knownPlatforms(args.platforms)
    const productId = args.productId === undefined ? current.productId : this.knownProduct(args.productId)
    // What the person is: a change here needs a new approval. A new name for the owner's own list, or the list of platforms, does not.
    const changed = purpose !== current.purpose || !sameFields(current, read.value) || role?.name !== current.role?.name || role?.voice !== current.role?.voice
    const saved = this.store.saveProfile(current.id, {
      label,
      productId,
      role,
      platforms,
      purpose,
      strategy: current.strategy,
      fields: read.value,
      reasons: keptReasons(current, read.value),
      status: changed ? 'proposed' : current.status,
      pictureFile
    })
    this.core.events.changed('accounts')
    return saved
  }

  approve(args: { id: string }): Profile {
    const { profile: current, pictureFile } = this.existing(args.id)
    const missing = missingIdentity(current)
    if (missing.length > 0) throw new ApiError('profile_incomplete', `Fill in the ${missing.join(', ')} before approving.`)
    const saved = this.store.saveProfile(current.id, { ...this.carry(current), fields: current, status: 'approved', pictureFile })
    this.core.log.info('accounts', `The profile "${saved.label}" was approved (${saved.displayName}).`)
    this.core.events.changed('accounts')
    return saved
  }

  /** The profile is removed only when no account belongs to it; its picture goes with it. */
  async remove(args: { id: string }): Promise<void> {
    const { profile } = this.existing(args.id)
    const accounts = this.store.accountsOfProfile(profile.id)
    if (accounts.length > 0) {
      throw new ApiError('in_use', `"${profile.label}" has ${accounts.length} account${accounts.length === 1 ? '' : 's'} (${accounts.map((a) => a.label).join(', ')}). Take them out of the profile or remove them first.`)
    }
    this.store.deleteProfile(profile.id)
    await rm(this.folder(profile.id), { recursive: true, force: true })
    this.core.log.info('accounts', `Profile removed: ${profile.label}.`)
    this.core.events.changed('accounts')
  }

  /** The owner's own picture replaces the one that was made. */
  async setPicture(args: { id: string; path: string }): Promise<Profile> {
    const { profile } = this.existing(args.id)
    const [image] = await this.checkedImage(args.path)
    const file = await this.keep(profile.id, image.path)
    return this.afterPicture(profile, file, 'You chose a picture')
  }

  /** The AI makes the picture from the description in the profile, with its image tool; the owner sees it and keeps it or asks again. */
  async makePicture(args: { id: string }): Promise<Profile> {
    const { profile } = this.existing(args.id)
    if (!profile.pictureIdea) throw new ApiError('no_picture_idea', 'Describe the picture first: what it shows and how it looks.')
    const engine = await this.imageEngine()
    const draft = join(this.folder(profile.id), `draft-${Date.now()}`)
    await mkdir(draft, { recursive: true })
    try {
      await engine.run({ label: 'accounts.picture', subject: profile.id, prompt: picturePrompt(profile), makeFiles: { dir: draft }, timeoutMs: PICTURE_TIMEOUT_MS })
      const made = (await readdir(draft)).filter((name) => IMAGE_EXTENSIONS.includes(extname(name).toLowerCase())).sort()
      if (made.length === 0) throw new ApiError('picture_failed', `${engine.label} did not make a picture file. Try again, or choose your own picture.`)
      const [image] = await this.checkedImage(join(draft, made[0]))
      const file = await this.keep(profile.id, image.path)
      return this.afterPicture(profile, file, `${engine.label} made a picture`)
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('picture_failed', error.message)
      throw error
    } finally {
      await rm(draft, { recursive: true, force: true })
    }
  }

  /** The picture for the screen, as a data address, or null when there is none. */
  async picture(args: { id: string }): Promise<{ dataUrl: string } | null> {
    const file = this.pictureFile(requireText(args.id, 'The profile'))
    if (!file) return null
    try {
      const bytes = await readFile(file)
      const type = extname(file).toLowerCase() === '.png' ? 'image/png' : extname(file).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg'
      return { dataUrl: `data:${type};base64,${bytes.toString('base64')}` }
    } catch {
      return null
    }
  }

  /** Where the picture is on disk, for a mission that uploads it; null when there is none. */
  pictureFile(profileId: string): string | null {
    const name = this.store.profile(profileId)?.pictureFile
    return name ? join(this.folder(profileId), name) : null
  }

  // ───────────── helpers ─────────────

  /** The parts of a profile that stay as they are when only its status or picture changes. */
  private carry(profile: Profile): { label: string; productId: string | null; role: AccountRole | null; platforms: string[]; purpose: string; strategy: string; reasons: Profile['reasons'] } {
    return { label: profile.label, productId: profile.productId, role: profile.role, platforms: profile.platforms, purpose: profile.purpose, strategy: profile.strategy, reasons: profile.reasons }
  }

  private async imageEngine(): Promise<AiEngine> {
    const selected = this.core.engines.selected()
    const candidates = [...(selected ? [selected] : []), ...this.core.engines.all()].filter((engine) => engine.makesImages)
    for (const engine of candidates) {
      const status = await engine.check()
      if (status.installed && status.ready) return engine
    }
    throw new ApiError('no_image_engine', 'Making a picture needs an engine with an image tool (Codex). Install Codex, or choose your own picture.')
  }

  private async checkedImage(path: string) {
    try {
      return await validateAttachments([{ name: 'picture', path, mime: '', sha256: '' }])
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError('invalid_picture', error.message.replace(/^Attachment "picture": /, 'The picture: '))
      throw error
    }
  }

  /** Copies the picture into the profile's folder as its one picture. */
  private async keep(profileId: string, source: string): Promise<string> {
    const folder = this.folder(profileId)
    await mkdir(folder, { recursive: true })
    const name = `picture${extname(source).toLowerCase() === '.jpeg' ? '.jpg' : extname(source).toLowerCase()}`
    for (const old of await readdir(folder)) if (old.startsWith('picture.')) await rm(join(folder, old), { force: true })
    await cp(source, join(folder, name))
    await stat(join(folder, name))
    return name
  }

  private afterPicture(profile: Profile, file: string, what: string): Profile {
    const saved = this.store.saveProfile(profile.id, { ...this.carry(profile), fields: profile, status: profile.status, pictureFile: file })
    this.core.log.info('accounts', `${what} for the profile "${profile.label}".`)
    this.core.events.changed('accounts')
    return saved
  }
}

const cleanPurpose = (purpose: unknown): string => (typeof purpose === 'string' ? purpose.trim().slice(0, MAX_PURPOSE) : '')

/** The reasons the AI gave stay only for the values it proposed: a value the owner changed has no reason any more (it would explain the old value). */
function keptReasons(before: Profile, after: ProfileFields): Profile['reasons'] {
  const kept: Profile['reasons'] = {}
  for (const key of Object.keys(before.reasons) as (keyof ProfileFields)[]) {
    if (before[key] === after[key] && before.reasons[key]) kept[key] = before.reasons[key]
  }
  return kept
}

/** What the engine is told to make: the owner-approved description and the rules that keep the picture clean. */
export function picturePrompt(profile: ProfileFields): string {
  return [
    'Use your image generation tool to create ONE square profile picture (about 1024 x 1024 pixels).',
    `What it shows: ${profile.pictureIdea}`,
    'Rules: no text, no logos, no watermarks, no brand marks; it must not be the likeness of a real or famous person; one clear subject, natural and not over-edited.',
    'Save the finished image as picture.png in the current directory (PNG). Do not do anything else. Then reply with one word: done.'
  ].join('\n')
}
