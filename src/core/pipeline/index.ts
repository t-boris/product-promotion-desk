import type { Core } from '../core'
import { getAutomation } from './lifecycle'
import { buildResultsView } from './results'
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
export function register(core: Core): void {
  registerFlow(core)
  core.services.metrics = new MetricsServiceImpl(core)
  const automation = getAutomation(core)

  core.router.register({
    'automation.get': () => automation.state(),
    'automation.setPaused': ({ paused }) => automation.setPaused(paused),
    'attention.list': () => automation.attention.list(),
    'runs.list': (args) => core.runs.list({ limit: args?.limit, channelId: args?.channelId }),
    'history.list': (args) => listHistory(core, args?.limit),
    'results.get': (args) => buildResultsView(core, args?.productId),
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
