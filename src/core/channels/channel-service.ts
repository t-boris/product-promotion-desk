// Channels: connecting an address, assessing what the account can do there, settings and modes (REQ-002, REQ-003).

import { ApiError } from '../../shared/api'
import type { CapabilityKey, Channel, ChannelMode, ChannelSettings } from '../../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../../shared/types'
import type { Core } from '../core'
import type { Connector, ConnectorContext, NormalizedTarget } from '../ports'
import type { RunResult } from '../runs'
import type { AccountsService } from './accounts'
import { blankCapabilities, blockedCapabilities, find, normalizeAssessment, summarize, withVerified } from './capabilities'
import { browserError, found, requireText } from './errors'
import { assertModeAllowed, modeAfterAssessment } from './mode-rules'
import { applySettingsPatch } from './settings'
import type { ChannelPatch, ChannelsStore } from './store'

const NEEDS_YOU_DEFAULT = 'The account needs you: sign in or complete the check in the account browser.'

interface AssessRun extends RunResult {
  channelId: string
}

export class ChannelService {
  private readonly assessing = new Set<string>()

  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore,
    private readonly accounts: AccountsService
  ) {}

  list(): Channel[] {
    return this.core.repos.listChannels()
  }

  channel(id: unknown): Channel {
    return found(() => this.core.repos.channel(requireText(id, 'The channel')), 'The channel')
  }

  // ───────────── connect ─────────────

  connect(args: { productId: string; accountId: string; target: string }): Channel {
    const raw = requireText(args.target, 'The channel address')
    const productId = requireText(args.productId, 'The product')
    found(() => this.core.repos.product(productId), 'The product')
    const account = this.accounts.account(args.accountId)

    const connector = this.core.connectors.resolve(raw)
    if (!connector) throw new ApiError('no_connector', 'No connector can handle this address.')
    if (connector.platform !== account.platform) {
      throw new ApiError(
        'platform_mismatch',
        `This address belongs to "${connector.platform}", but ${account.label} is a "${account.platform}" account. Create or choose an account for "${connector.platform}".`
      )
    }
    let normalized: NormalizedTarget
    try {
      normalized = connector.normalizeTarget(raw)
    } catch (error) {
      throw new ApiError('invalid_target', error instanceof Error ? error.message : 'This address cannot be used.')
    }
    if (!normalized.target || !normalized.url) throw new ApiError('invalid_target', 'This address cannot be used.')

    if (this.store.findDuplicate(productId, account.id, normalized.target)) {
      throw new ApiError('duplicate', `${normalized.target} is already connected for this product with ${account.label}.`)
    }
    const channel = this.store.insertChannel({
      productId,
      accountId: account.id,
      platform: account.platform,
      connectorId: connector.id,
      target: normalized.target,
      url: normalized.url,
      settings: structuredClone(DEFAULT_CHANNEL_SETTINGS),
      capabilities: blankCapabilities(),
      statusDetail: 'Not assessed yet. Assess the channel to see what this account can do here.'
    })
    this.core.log.info('channels', `Channel connected: ${channel.target} with ${account.label}. Nothing was posted.`, channel.id)
    this.core.events.changed('channels', 'attention')
    return channel
  }

  // ───────────── assess ─────────────

  /**
   * Looks at the channel through the account's own browser session and records what is possible. It reads only:
   * no test message is ever published (REQ-002), so sending abilities cannot come out 'verified' here.
   */
  async assess(channelId: unknown): Promise<Channel> {
    const channel = this.channel(channelId)
    if (this.assessing.has(channel.id)) throw new ApiError('busy', `${channel.target} is already being assessed.`)
    this.assessing.add(channel.id)
    try {
      const { connector, ctx } = this.core.connectorContext(channel.id)
      await this.core.runs.track<AssessRun>('assess', { channelId: channel.id, productId: channel.productId }, () => this.runAssessment(connector, ctx), { rethrow: true })
    } catch (error) {
      throw browserError(error, { code: 'assess_failed', message: (reason) => `The assessment of ${channel.target} failed: ${reason}` })
    } finally {
      this.assessing.delete(channel.id)
    }
    return this.core.repos.channel(channel.id)
  }

  private async runAssessment(connector: Connector, ctx: ConnectorContext): Promise<AssessRun> {
    const { channel } = ctx
    const at = this.core.clock.now().toISOString()
    const assessed = await connector.assess(ctx)
    const capabilities = normalizeAssessment(channel.capabilities, assessed, at)
    const reading = find(capabilities, 'read_posts')

    // Without the ability to even read, the cause is the account (not signed in, a check to solve).
    if (reading?.status === 'needs_user') {
      const detail = reading.detail || NEEDS_YOU_DEFAULT
      await this.classifyLogin(connector, ctx)
      const blocked = blockedCapabilities(channel.capabilities, detail, at)
      this.save(channel, { capabilities: blocked, ...(channel.status === 'paused' ? {} : { status: 'needs_user', statusDetail: detail }) })
      this.core.log.warn('channels', `Assessment of ${channel.target} needs you: ${detail}`, channel.id)
      return { channelId: channel.id, status: 'suspended', summary: `Needs you: ${detail}` }
    }

    const patch: ChannelPatch = { capabilities }
    if (channel.status === 'needs_user') {
      // The reason it needed the person is gone; monitoring resumes if it had started, else it awaits activation.
      patch.status = channel.baselineDoneAt ? 'active' : 'setup'
      patch.statusDetail = ''
    }
    if ((patch.status ?? channel.status) === 'setup') patch.statusDetail = 'Assessed. Review the settings, then activate the channel when ready.'
    const fallback = modeAfterAssessment({ mode: channel.mode, capabilities })
    if (fallback.reason) {
      patch.mode = fallback.mode
      this.core.log.warn('channels', `${channel.target} was switched to drafting only. ${fallback.reason}`, channel.id)
    }
    this.save(channel, patch)
    const summary = `Assessed ${channel.target}: ${summarize(capabilities)}.${fallback.reason ? ` Switched to drafting only: ${fallback.reason}` : ''}`
    this.core.log.info('channels', summary, channel.id)
    return { channelId: channel.id, status: 'ok', summary }
  }

  /** Best effort: tells a missing sign-in from a CAPTCHA and updates the account, which feeds the attention list. */
  private async classifyLogin(connector: Connector, ctx: ConnectorContext): Promise<void> {
    try {
      const state = await connector.checkLogin(ctx)
      this.accounts.applyLogin(ctx.account, state)
    } catch (error) {
      this.core.log.warn('channels', `Could not tell why ${ctx.channel.target} needs you: ${error instanceof Error ? error.message : String(error)}`, ctx.channel.id)
    }
  }

  private save(channel: Channel, patch: ChannelPatch): Channel {
    const updated = this.store.updateChannel(channel.id, patch)
    this.core.events.changed('channels', 'attention')
    return updated
  }

  /** Called by the sending service after a confirmed publication: the only way a sending ability becomes 'verified'. */
  markCapabilityVerified(channelId: string, key: CapabilityKey, detail: string): void {
    let channel: Channel
    try {
      channel = this.core.repos.channel(channelId)
    } catch {
      this.core.log.warn('channels', `Could not record a verified capability: the channel ${channelId} no longer exists.`)
      return
    }
    const capabilities = withVerified(channel.capabilities, key, detail.trim() || 'Confirmed by an authorized send.', this.core.clock.now().toISOString())
    this.save(channel, { capabilities })
    this.core.log.info('channels', `${channel.target}: ${key.replace('_', ' ')} is now verified by a real, confirmed send.`, channel.id)
  }

  // ───────────── settings and mode ─────────────

  updateSettings(args: { channelId: string; settings: Partial<ChannelSettings> }): Channel {
    const channel = this.channel(args.channelId)
    const settings = applySettingsPatch(channel.settings, args.settings)
    if (channel.mode === 'auto' && settings.autoCategories.length === 0) {
      throw new ApiError('mode_not_allowed', 'Automatic mode needs at least one automatic category. Switch to another mode first, or keep a category.')
    }
    const updated = this.save(channel, { settings })
    this.core.log.info('channels', `Settings of ${channel.target} updated.`, channel.id)
    return updated
  }

  setMode(args: { channelId: string; mode: ChannelMode }): Channel {
    const channel = this.channel(args.channelId)
    assertModeAllowed(channel, args.mode)
    if (channel.mode === args.mode) return channel
    const updated = this.save(channel, { mode: args.mode })
    this.core.log.info('channels', `${channel.target} mode: ${channel.mode} -> ${args.mode}.`, channel.id)
    return updated
  }

  // ───────────── remove ─────────────

  remove(id: unknown): void {
    const channel = this.channel(id)
    if (this.assessing.has(channel.id)) throw new ApiError('busy', `${channel.target} is being assessed. Try again in a moment.`)
    const open = this.store.unresolvedSends(channel.id)
    if (open > 0) {
      throw new ApiError(
        'unresolved_sends',
        `${channel.target} has ${open} send${open === 1 ? '' : 's'} whose result is not known yet. Check them with the platform first: removing the channel would erase the only record of a message that may be published.`
      )
    }
    this.store.deleteChannel(channel.id)
    this.core.log.info('channels', `Channel removed: ${channel.target}. Its discussions, drafts and history were deleted with it.`)
    this.core.events.changed('channels', 'attention', 'opportunities', 'results')
  }
}
