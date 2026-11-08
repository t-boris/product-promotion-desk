import type { Core } from '../core'
import { DraftingFlow } from './drafting'
import { registerFlowApi } from './flow-api'
import { SendGate } from './gate'
import { Ingestor } from './ingest'
import { LoginWatch } from './login-watch'
import { MonitorFlow } from './monitor'
import { PublicationsFlow } from './publications'
import { ReviewFlow } from './review'
import { SendingFlow } from './sending'
import { FlowStore } from './store'

/**
 * Registers the discussion → draft → approval → sending flow (I-4, I-5, I-6): the monitor, drafting, review,
 * gate and sending services (attached to `core.services`) and the opportunities.*, publications.*,
 * channels.discussions, channels.selectOlder, channels.activate, channels.checkNow and channels.setPaused handlers.
 */
export function registerFlow(core: Core): void {
  const store = new FlowStore(core)
  const review = new ReviewFlow(core, store)
  const ingestor = new Ingestor(core, store, review)
  const gate = new SendGate(core, store)
  const watch = new LoginWatch(core, store)
  const sending = new SendingFlow(core, store, gate, review, ingestor, watch)
  const monitor = new MonitorFlow(core, store, ingestor, watch)
  const drafting = new DraftingFlow(core, store, review, sending)
  const publications = new PublicationsFlow(core, store)

  core.services.pipeline = review
  core.services.monitor = monitor
  core.services.drafting = drafting
  core.services.sending = sending

  registerFlowApi({ core, store, review, monitor, drafting, sending, publications })
}
