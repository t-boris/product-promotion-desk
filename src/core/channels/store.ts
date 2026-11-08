// Persistence for accounts and channels. Rows are mapped by the shared mappers in ../repos.

import type { Account, Profile, AccountRole, Mailbox, ProfileFields, ProfileGender, ProfileStatus, AccountStatus, Capability, Channel, ChannelMode, ChannelPlan, ChannelSettings, ChannelStatus } from '../../shared/types'
import { newId, toJson, type Db } from '../db/database'
import type { Clock } from '../ports'
import { mapMailbox, type Repos } from '../repos'

export interface NewChannel {
  productId: string
  accountId: string
  platform: string
  connectorId: string
  target: string
  url: string
  settings: ChannelSettings
  capabilities: Capability[]
  statusDetail: string
}

export interface ChannelPatch {
  mode?: ChannelMode
  settings?: ChannelSettings
  capabilities?: Capability[]
  status?: ChannelStatus
  statusDetail?: string
  plan?: ChannelPlan | null
}

export class ChannelsStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly repos: Repos
  ) {}

  // ───────────── accounts ─────────────

  insertAccount(productId: string | null, platform: string, label: string, role: AccountRole | null = null, email: string | null = null, mailboxId: string | null = null, profileId: string | null = null): Account {
    const id = newId()
    // The prefix makes the browser session persistent: cookies survive restarts.
    const partition = `persist:ppd-account-${id}`
    this.db
      .prepare(
        "INSERT INTO accounts (id, product_id, platform, label, identity, partition, status, created_at, role_name, role_voice, email, mailbox_id, profile_id) VALUES (?, ?, ?, ?, NULL, ?, 'login_required', ?, ?, ?, ?, ?, ?)"
      )
      .run(id, productId, platform, label, partition, this.clock.now().toISOString(), role?.name ?? null, role?.voice ?? null, email, mailboxId, profileId)
    return this.repos.account(id)
  }

  /** Sets, changes or (null) removes the role of a login. */
  setRole(id: string, role: AccountRole | null): Account {
    this.db.prepare('UPDATE accounts SET role_name = ?, role_voice = ? WHERE id = ?').run(role?.name ?? null, role?.voice ?? null, id)
    return this.repos.account(id)
  }

  setEmail(id: string, email: string | null, mailboxId: string | null): Account {
    this.db.prepare('UPDATE accounts SET email = ?, mailbox_id = ? WHERE id = ?').run(email, mailboxId, id)
    return this.repos.account(id)
  }

  listMailboxes(): Mailbox[] {
    return (this.db.prepare('SELECT * FROM mailboxes ORDER BY created_at, rowid').all() as Record<string, unknown>[]).map(mapMailbox)
  }

  insertMailbox(address: string): Mailbox {
    const id = newId()
    this.db.prepare("INSERT INTO mailboxes (id, address, kind, created_at) VALUES (?, ?, 'existing', ?)").run(id, address, this.clock.now().toISOString())
    return this.listMailboxes().find((m) => m.id === id) as Mailbox
  }

  /** The addresses already given to accounts stay; only the link to the base mailbox is cut. */
  deleteMailbox(id: string): void {
    this.db.prepare('UPDATE accounts SET mailbox_id = NULL WHERE mailbox_id = ?').run(id)
    this.db.prepare('DELETE FROM mailboxes WHERE id = ?').run(id)
  }

  /** The name the account signs in with; not a secret (the password is only in the vault). */
  setLoginName(id: string, loginName: string | null): Account {
    this.db.prepare('UPDATE accounts SET login_name = ? WHERE id = ?').run(loginName, id)
    return this.repos.account(id)
  }

  /** When a sign-in with the saved password was last tried, or null. Limits automatic sign-ins to one per hour. */
  lastLoginAttempt(id: string): string | null {
    const row = this.db.prepare('SELECT last_login_attempt_at AS v FROM accounts WHERE id = ?').get(id) as { v: string | null } | undefined
    return row?.v ?? null
  }

  markLoginAttempt(id: string, at: string): void {
    this.db.prepare('UPDATE accounts SET last_login_attempt_at = ? WHERE id = ?').run(at, id)
  }

  // ───────────── profiles (DEC-019) ─────────────

  private readProfile(row: Record<string, unknown>): { profile: Profile; pictureFile: string | null } {
    const pictureFile = (row.picture_file as string | null) ?? null
    const json = <T>(text: unknown, fallback: T): T => {
      try {
        return JSON.parse(String(text || '')) as T
      } catch {
        return fallback
      }
    }
    return {
      pictureFile,
      profile: {
        id: String(row.id),
        label: String(row.label),
        productId: (row.product_id as string | null) ?? null,
        role: row.role_name ? { name: String(row.role_name), voice: String(row.role_voice ?? '') } : null,
        platforms: json<string[]>(row.platforms_json, []),
        purpose: String(row.purpose),
        strategy: String(row.strategy),
        firstName: String(row.first_name),
        lastName: String(row.last_name),
        displayName: String(row.display_name),
        username: String(row.username),
        birthDate: String(row.birth_date),
        gender: row.gender as ProfileGender,
        place: String(row.place),
        about: String(row.about),
        website: String(row.website),
        pictureIdea: String(row.picture_idea),
        reasons: json<Profile['reasons']>(row.reasons_json, {}),
        hasPicture: pictureFile !== null,
        status: row.status as ProfileStatus,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      }
    }
  }

  /** A profile and the name of its picture file, or null when there is none with this id. */
  profile(id: string): { profile: Profile; pictureFile: string | null } | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.readProfile(row) : null
  }

  listProfiles(): Profile[] {
    return (this.db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as Record<string, unknown>[]).map((row) => this.readProfile(row).profile)
  }

  /** A new, empty profile: the owner names it; the person is proposed afterwards. */
  insertProfile(data: { label: string; productId: string | null; platforms: string[]; purpose: string }): Profile {
    const id = newId()
    const now = this.clock.now().toISOString()
    this.db
      .prepare("INSERT INTO profiles (id, label, product_id, platforms_json, purpose, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)")
      .run(id, data.label, data.productId, JSON.stringify(data.platforms), data.purpose, now, now)
    return (this.profile(id) as { profile: Profile }).profile
  }

  saveProfile(
    id: string,
    data: { label: string; productId: string | null; role: AccountRole | null; platforms: string[]; purpose: string; strategy: string; fields: ProfileFields; reasons: Profile['reasons']; status: ProfileStatus; pictureFile: string | null }
  ): Profile {
    const f = data.fields
    this.db
      .prepare(
        `UPDATE profiles SET label = ?, product_id = ?, role_name = ?, role_voice = ?, platforms_json = ?, purpose = ?, strategy = ?, first_name = ?, last_name = ?, display_name = ?, username = ?,
           birth_date = ?, gender = ?, place = ?, about = ?, website = ?, picture_idea = ?, reasons_json = ?, picture_file = ?, status = ?, updated_at = ? WHERE id = ?`
      )
      .run(data.label, data.productId, data.role?.name ?? null, data.role?.voice ?? null, JSON.stringify(data.platforms), data.purpose, data.strategy, f.firstName, f.lastName, f.displayName, f.username, f.birthDate, f.gender, f.place, f.about, f.website, f.pictureIdea, JSON.stringify(data.reasons), data.pictureFile, data.status, this.clock.now().toISOString(), id)
    return (this.profile(id) as { profile: Profile }).profile
  }

  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  /** The logins that belong to a profile: at most one per platform. */
  accountsOfProfile(profileId: string): Account[] {
    return this.repos.listAccounts().filter((a) => a.profileId === profileId)
  }

  setAccountProfile(accountId: string, profileId: string | null): Account {
    this.db.prepare('UPDATE accounts SET profile_id = ? WHERE id = ?').run(profileId, accountId)
    return this.repos.account(accountId)
  }

  deleteAccount(id: string): void {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }

  /**
   * Records the outcome of a login check. A logout clears `identity` (nobody is signed in) but keeps `last_identity`:
   * the account that is expected to be signed in, so a later sign-in as somebody else is still noticed.
   */
  setLogin(id: string, status: AccountStatus, identity: string | null): Account {
    this.db.prepare('UPDATE accounts SET status = ?, identity = ?, last_identity = COALESCE(?, last_identity) WHERE id = ?').run(status, identity, identity, id)
    return this.repos.account(id)
  }

  /** The identity most recently seen signed in (kept across logouts), or null if none was ever confirmed. */
  lastIdentity(id: string): string | null {
    const row = this.db.prepare('SELECT last_identity AS v FROM accounts WHERE id = ?').get(id) as { v: string | null } | undefined
    return row?.v ?? null
  }

  channelsOfAccount(accountId: string): Channel[] {
    return this.repos.listChannels().filter((c) => c.accountId === accountId)
  }

  // ───────────── channels ─────────────

  findDuplicate(productId: string, accountId: string, target: string): Channel | null {
    return this.repos.listChannels().find((c) => c.productId === productId && c.accountId === accountId && c.target === target) ?? null
  }

  insertChannel(input: NewChannel): Channel {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json, capabilities_json, status, status_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'observe', ?, ?, 'setup', ?, ?)`
      )
      .run(id, input.productId, input.accountId, input.platform, input.connectorId, input.target, input.url, toJson(input.settings), toJson(input.capabilities), input.statusDetail, this.clock.now().toISOString())
    return this.repos.channel(id)
  }

  updateChannel(id: string, patch: ChannelPatch): Channel {
    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.mode !== undefined) add('mode', patch.mode)
    if (patch.settings !== undefined) add('settings_json', toJson(patch.settings))
    if (patch.capabilities !== undefined) add('capabilities_json', toJson(patch.capabilities))
    if (patch.status !== undefined) add('status', patch.status)
    if (patch.statusDetail !== undefined) add('status_detail', patch.statusDetail.slice(0, 500))
    if (patch.plan !== undefined) add('plan_json', patch.plan === null ? null : toJson(patch.plan))
    if (sets.length > 0) this.db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    return this.repos.channel(id)
  }

  deleteChannel(id: string): void {
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id)
  }

  /** Every send ever attempted for the channel, whatever its result: this record is what prevents sending the same thing twice. */
  sendCount(channelId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.channel_id = ?')
      .get(channelId) as { n: number }
    return row.n
  }

  /** Sends whose result is not known: removing the channel would erase the only record of a possibly published message. */
  unresolvedSends(channelId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id
         WHERE o.channel_id = ? AND a.state IN ('sending', 'unknown')`
      )
      .get(channelId) as { n: number }
    return row.n
  }
}
