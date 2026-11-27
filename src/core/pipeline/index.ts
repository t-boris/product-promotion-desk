import type { Core } from '../core'
import { getAutomation } from './lifecycle'
import { attentionOf, buildOverview } from './overview'
import { buildResultsHistory, buildResultsView } from './results'
import { listHistory } from './history'
import { MetricsServiceImpl, refreshTracked } from './metrics'
import { registerFlow } from './register-flow'
import { ApiError } from '../../shared/api'

export { getAutomation, startAutomation, type Automation, type AutomationOptions } from './lifecycle'
export type { NotificationSink, AppNotification } from './attention-notify'

/**
 * Registers the pipeline module: the discussion-to-sending flow (I-4..I-6, in register-flow) and the
 * lifecycle/results work (I-7, I-8): automation state and pause, attention items, run log, action history,
 * results and platform metrics.
 */
/** The sending service, which the flow module registers: asked when a call arrives, not when the handlers are set. */
function sendingOf(core: Core): NonNullable<Core['services']['sending']> {
  const sending = core.services.sending
  if (!sending) throw new ApiError('not_implemented', 'Sending is not available.')
  return sending
}

export function register(core: Core): void {
  registerFlow(core)
  core.services.metrics = new MetricsServiceImpl(core)
  const automation = getAutomation(core)

  core.router.register({
    'automation.get': () => automation.state(),
    'automation.setPaused': ({ paused }) => automation.setPaused(paused),
    // With a product: only what is about that product (the number beside Inbox); without one, everything.
    'attention.list': (args) => (args?.productId ? attentionOf(core, args.productId) : automation.attention.list()),
    'runs.list': (args) => core.runs.list({ limit: args?.limit, channelId: args?.channelId }),
    'history.list': (args) => listHistory(core, args?.limit),
    'results.get': (args) => buildResultsView(core, args?.productId),
    'results.history': (args) => buildResultsHistory(core, args),
    'results.posts': ({ channelId }) => sendingOf(core).postResults(channelId),
    'results.readPosts': ({ channelId }) => sendingOf(core).readPostResultsNow(channelId),
    'overview.get': (args) => buildOverview(core, args),
    'results.refresh': async ({ channelId }) => {
      try {
        core.repos.channel(channelId)
      } catch {
        throw new ApiError('not_found', `Channel not found: ${channelId}`)
      }
      return (await refreshTracked(core, channelId, { rethrow: true })) ?? []
    }
  })
}
