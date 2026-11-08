// Persistence for accounts and channels. Rows are mapped by the shared mappers in ../repos.

import type { Account, AccountRole, AccountStatus, Capability, Channel, ChannelMode, ChannelSettings, ChannelStatus } from '../../shared/types'
import { newId, toJson, type Db } from '../db/database'
import type { Clock } from '../ports'
import type { Repos } from '../repos'

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
}

export class ChannelsStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly repos: Repos
  ) {}

  // ───────────── accounts ─────────────

  insertAccount(productId: string, platform: string, label: string, role: AccountRole | null = null): Account {
    const id = newId()
    // The prefix makes the browser session persistent: cookies survive restarts.
    const partition = `persist:ppd-account-${id}`
    this.db
      .prepare(
        "INSERT INTO accounts (id, product_id, platform, label, identity, partition, status, created_at, role_name, role_voice) VALUES (?, ?, ?, ?, NULL, ?, 'login_required', ?, ?, ?)"
      )
      .run(id, productId, platform, label, partition, this.clock.now().toISOString(), role?.name ?? null, role?.voice ?? null)
    return this.repos.account(id)
  }

  /** Sets, changes or (null) removes the role of a login. */
  setRole(id: string, role: AccountRole | null): Account {
    this.db.prepare('UPDATE accounts SET role_name = ?, role_voice = ? WHERE id = ?').run(role?.name ?? null, role?.voice ?? null, id)
    return this.repos.account(id)
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

  /** Gives an unassigned (legacy) account to the product that starts using it. */
  assignAccount(id: string, productId: string): Account {
    this.db.prepare('UPDATE accounts SET product_id = ? WHERE id = ? AND product_id IS NULL').run(productId, id)
    return this.repos.account(id)
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
