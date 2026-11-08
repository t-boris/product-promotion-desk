// Persistence for accounts and channels. Rows are mapped by the shared mappers in ../repos.

import type { Account, AccountStatus, Capability, Channel, ChannelMode, ChannelSettings, ChannelStatus } from '../../shared/types'
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

  insertAccount(platform: string, label: string): Account {
    const id = newId()
    // The prefix makes the browser session persistent: cookies survive restarts.
    const partition = `persist:ppd-account-${id}`
    this.db
      .prepare("INSERT INTO accounts (id, platform, label, identity, partition, status, created_at) VALUES (?, ?, ?, NULL, ?, 'login_required', ?)")
      .run(id, platform, label, partition, this.clock.now().toISOString())
    return this.repos.account(id)
  }

  deleteAccount(id: string): void {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }

  setLogin(id: string, status: AccountStatus, identity: string | null): Account {
    this.db.prepare('UPDATE accounts SET status = ?, identity = ? WHERE id = ?').run(status, identity, id)
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
