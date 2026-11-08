// Channels module (I-3): accounts, channels, capability assessment (REQ-002).
//
// Registers the accounts.* and channels.* API handlers it owns and exposes `core.services.channels` to the sending
// service. channels.activate, setPaused, discussions, selectOlder and checkNow belong to the pipeline module.

import type { Core } from '../core'
import type { Clock, Connector } from '../ports'
import type { Db } from '../db/database'
import { AccountsService } from './accounts'
import { draftSiteProfile, planChannel, suggestChannels, suggestRoles } from './ai-help'
import { ChannelService } from './channel-service'
import { ChannelPlanService } from './plan'
import { listPlatforms } from './platforms'
import { ProfileService } from './profiles'
import { RoleSuggestionService } from './roles'
import { ChannelsStore } from './store'
import { SuggestionService } from './suggestions'

/** Connectors that keep data in the application database (the universal connector's site profiles) opt in with this. */
interface StorageUser {
  bindStorage(storage: { db: Db; clock: Clock }): void
}

const usesStorage = (connector: Connector): connector is Connector & StorageUser => typeof (connector as Partial<StorageUser>).bindStorage === 'function'

export function register(core: Core): void {
  for (const connector of core.connectors.list()) {
    if (usesStorage(connector)) connector.bindStorage({ db: core.db, clock: core.clock })
  }

  const store = new ChannelsStore(core.db, core.clock, core.repos)
  const accounts = new AccountsService(core, store)
  const channels = new ChannelService(core, store, accounts)
  const profiles = new ProfileService(core, accounts, { draftSiteProfile })
  const suggestions = new SuggestionService(core, { suggestChannels })
  const roles = new RoleSuggestionService(core, { suggestRoles })
  const plans = new ChannelPlanService(core, { planChannel }, store)

  core.services.channels = {
    markCapabilityVerified: (channelId, key, detail) => channels.markCapabilityVerified(channelId, key, detail)
  }

  core.router.register({
    'accounts.list': (args) => accounts.list(args),
    'accounts.create': (args) => accounts.create(args),
    'accounts.remove': (args) => accounts.remove(args.id),
    'accounts.setRole': (args) => accounts.setRole(args),
    'accounts.suggestRoles': (args) => roles.suggest(args),
    'platforms.list': () => listPlatforms(core.connectors),
    'accounts.openBrowser': (args) => accounts.openBrowser(args),
    'accounts.takeControl': (args) => accounts.takeControl(args.accountId),
    'accounts.releaseControl': (args) => accounts.releaseControl(args.accountId),
    'accounts.checkLogin': (args) => accounts.checkLogin(args.accountId),
    'channels.list': (args) => channels.list(args),
    'channels.connect': (args) => channels.connect(args),
    'channels.assess': (args) => channels.assess(args.channelId),
    'channels.updateSettings': (args) => channels.updateSettings(args),
    'channels.setMode': (args) => channels.setMode(args),
    'channels.remove': (args) => channels.remove(args.id),
    'channels.suggest': (args) => suggestions.suggest(args),
    'channels.preparePlan': (args) => plans.prepare(args),
    'channels.draftProfile': (args) => profiles.draftProfile(args),
    'channels.saveProfile': (args) => profiles.saveProfile(args)
  })
}
