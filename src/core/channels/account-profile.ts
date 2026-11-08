// The profile of an account (DEC-019): who the login is on the platform. The AI proposes it as a strategy for a purpose; the owner edits and
// approves it once; every mission after that takes the personal values from here and invents nothing. The picture is made by an engine's
// image tool or chosen by the owner, and lives in the data folder.

import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { ApiError } from '../../shared/api'
import type { Account, AccountProfile, ProfileFields } from '../../shared/types'
import { validateAttachments } from '../pipeline/attachments'
import type { Core } from '../core'
import { AiError, type AiEngine } from '../ports'
import type { AccountsService } from './accounts'
import type { proposeProfile } from './ai-help'
import { missingIdentity, readProfileFields } from './profile-fields'
import { presetFor } from './presets'
import type { ChannelsStore } from './store'

const PICTURE_TIMEOUT_MS = 6 * 60 * 1000
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

export interface ProfileHelp {
  proposeProfile: typeof proposeProfile
}

export class AccountProfileService {
  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly store: ChannelsStore,
    private readonly ai: ProfileHelp
  ) {}

  private folder(accountId: string): string {
    return join(this.core.dataDir, 'profiles', accountId)
  }

  get(accountId: unknown): AccountProfile | null {
    const account = this.accounts.account(accountId)
    return this.store.profile(account.id)?.profile ?? null
  }

  /** The approved profile a mission works from; the reason in words when there is none. */
  approved(account: Account): AccountProfile {
    const profile = this.store.profile(account.id)?.profile
    if (!profile) throw new ApiError('no_profile', `${account.label} has no profile yet. Ask the AI to propose one, then approve it.`)
    if (profile.status !== 'approved') throw new ApiError('profile_not_approved', `The profile of ${account.label} is not approved yet. Read it, change what you want and approve it.`)
    return profile
  }

  /** The whole profile as the AI's strategy for a purpose. A proposal only: it replaces an earlier one, and the owner has to approve it again. */
  async propose(args: { accountId: string; purpose?: string }): Promise<AccountProfile> {
    const account = this.accounts.account(args.accountId)
    const engine = this.core.engines.selected()
    if (!engine) throw new ApiError('no_engine', 'No AI engine is selected. Choose Claude Code or Codex in Settings.')
    const status = await engine.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${engine.label} is not available.`)

    const existing = this.store.profile(account.id)?.profile ?? null
    const purpose = typeof args.purpose === 'string' && args.purpose.trim() ? args.purpose.trim().slice(0, 400) : (existing?.purpose ?? '')
    const product = account.productId ? this.productContext(account.productId) : null
    const others = this.store.profilesOnPlatform(account.platform, account.id).map((p) => ({ displayName: p.displayName, gender: p.gender, birthYear: p.birthDate.slice(0, 4), place: p.place, about: p.about }))
    try {
      const proposal = await this.ai.proposeProfile(engine, {
        purpose,
        product: product?.product ?? null,
        claims: product?.claims ?? [],
        platform: { platform: account.platform, label: presetFor(account.platform)?.label ?? account.platform },
        role: account.role,
        others,
        today: this.core.clock.now().toISOString().slice(0, 10)
      })
      const saved = this.store.saveProfile(account.id, {
        purpose: proposal.purpose,
        strategy: proposal.strategy,
        fields: proposal.fields,
        reasons: proposal.reasons,
        status: 'proposed',
        pictureFile: this.store.profile(account.id)?.pictureFile ?? null
      })
      this.core.log.info('accounts', `The AI proposed a profile for ${account.label}: ${saved.displayName}. It waits for your approval.`)
      this.core.events.changed('accounts')
      return saved
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('profile_failed', error.message)
      throw error
    }
  }

  /** The approved statements of the product the account was made for, when it has a product with an approved passport; the profile is proposed without them otherwise. */
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
  save(args: { accountId: string; profile: unknown; purpose?: string }): AccountProfile {
    const account = this.accounts.account(args.accountId)
    const read = readProfileFields(args.profile, this.core.clock.now())
    if (!read.ok) throw new ApiError('invalid_profile', read.error)
    const existing = this.store.profile(account.id)
    const purpose = typeof args.purpose === 'string' ? args.purpose.trim().slice(0, 400) : (existing?.profile.purpose ?? '')
    const changed = !existing || purpose !== existing.profile.purpose || fieldsOf(existing.profile) !== fieldsOf(read.value)
    const saved = this.store.saveProfile(account.id, {
      purpose,
      strategy: existing?.profile.strategy ?? '',
      fields: read.value,
      reasons: existing?.profile.reasons ?? {},
      status: existing && !changed ? existing.profile.status : 'proposed',
      pictureFile: existing?.pictureFile ?? null
    })
    if (changed) this.core.events.changed('accounts')
    return saved
  }

  approve(args: { accountId: string }): AccountProfile {
    const account = this.accounts.account(args.accountId)
    const existing = this.store.profile(account.id)
    if (!existing) throw new ApiError('no_profile', `${account.label} has no profile yet. Ask the AI to propose one first.`)
    const missing = missingIdentity(existing.profile)
    if (missing.length > 0) throw new ApiError('profile_incomplete', `Fill in the ${missing.join(', ')} before approving.`)
    const saved = this.store.saveProfile(account.id, { purpose: existing.profile.purpose, strategy: existing.profile.strategy, fields: existing.profile, reasons: existing.profile.reasons, status: 'approved', pictureFile: existing.pictureFile })
    this.core.log.info('accounts', `The profile of ${account.label} was approved (${saved.displayName}).`)
    this.core.events.changed('accounts')
    return saved
  }

  /** The owner's own picture replaces the one that was made. */
  async setPicture(args: { accountId: string; path: string }): Promise<AccountProfile> {
    const account = this.accounts.account(args.accountId)
    const existing = this.requireProfile(account)
    const [image] = await this.checkedImage(args.path)
    const file = await this.keep(account.id, image.path)
    return this.afterPicture(account, existing.profile, file, 'You chose a picture')
  }

  /** The AI makes the picture from the description in the profile, with its image tool; the owner sees it and keeps it or asks again. */
  async makePicture(args: { accountId: string }): Promise<AccountProfile> {
    const account = this.accounts.account(args.accountId)
    const existing = this.requireProfile(account)
    if (!existing.profile.pictureIdea) throw new ApiError('no_picture_idea', 'Describe the picture first: what it shows and how it looks.')
    const engine = await this.imageEngine()
    const draft = join(this.folder(account.id), `draft-${Date.now()}`)
    await mkdir(draft, { recursive: true })
    try {
      await engine.run({ label: 'accounts.picture', prompt: picturePrompt(existing.profile), makeFiles: { dir: draft }, timeoutMs: PICTURE_TIMEOUT_MS })
      const made = (await readdir(draft)).filter((name) => IMAGE_EXTENSIONS.includes(extname(name).toLowerCase())).sort()
      if (made.length === 0) throw new ApiError('picture_failed', `${engine.label} did not make a picture file. Try again, or choose your own picture.`)
      const [image] = await this.checkedImage(join(draft, made[0]))
      const file = await this.keep(account.id, image.path)
      return this.afterPicture(account, existing.profile, file, `${engine.label} made a picture`)
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('picture_failed', error.message)
      throw error
    } finally {
      await rm(draft, { recursive: true, force: true })
    }
  }

  /** The picture for the screen, as a data address, or null when there is none. */
  async picture(args: { accountId: string }): Promise<{ dataUrl: string } | null> {
    const account = this.accounts.account(args.accountId)
    const file = this.pictureFile(account.id)
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
  pictureFile(accountId: string): string | null {
    const name = this.store.profile(accountId)?.pictureFile
    return name ? join(this.folder(accountId), name) : null
  }

  /** An account was removed: its pictures go with it. */
  async forget(account: Account): Promise<void> {
    await rm(this.folder(account.id), { recursive: true, force: true })
  }

  // ───────────── helpers ─────────────

  private requireProfile(account: Account): NonNullable<ReturnType<ChannelsStore['profile']>> {
    const existing = this.store.profile(account.id)
    if (!existing) throw new ApiError('no_profile', `${account.label} has no profile yet. Ask the AI to propose one first.`)
    return existing
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

  /** Copies the picture into the account's folder as its one picture. */
  private async keep(accountId: string, source: string): Promise<string> {
    const folder = this.folder(accountId)
    await mkdir(folder, { recursive: true })
    const name = `picture${extname(source).toLowerCase() === '.jpeg' ? '.jpg' : extname(source).toLowerCase()}`
    for (const old of await readdir(folder)) if (old.startsWith('picture.')) await rm(join(folder, old), { force: true })
    await cp(source, join(folder, name))
    await stat(join(folder, name))
    return name
  }

  private afterPicture(account: Account, profile: AccountProfile, file: string, what: string): AccountProfile {
    const saved = this.store.saveProfile(account.id, { purpose: profile.purpose, strategy: profile.strategy, fields: profile, reasons: profile.reasons, status: profile.status, pictureFile: file })
    this.core.log.info('accounts', `${what} for ${account.label}.`)
    this.core.events.changed('accounts')
    return saved
  }
}

const fieldsOf = (fields: ProfileFields): string =>
  JSON.stringify([fields.firstName, fields.lastName, fields.displayName, fields.username, fields.birthDate, fields.gender, fields.place, fields.about, fields.website, fields.pictureIdea])

/** What the engine is told to make: the owner-approved description and the rules that keep the picture clean. */
export function picturePrompt(profile: ProfileFields): string {
  return [
    'Use your image generation tool to create ONE square profile picture (about 1024 x 1024 pixels).',
    `What it shows: ${profile.pictureIdea}`,
    'Rules: no text, no logos, no watermarks, no brand marks; it must not be the likeness of a real or famous person; one clear subject, natural and not over-edited.',
    'Save the finished image as picture.png in the current directory (PNG). Do not do anything else. Then reply with one word: done.'
  ].join('\n')
}
