import type { Core } from '../core'
import { BrowserWatchFlow } from './browser-watch'
import { DraftCheck } from './draft-check'
import { DraftHelp } from './draft-help'
import { FindingReply } from './finding-reply'
import { DraftingFlow } from './drafting'
import { FindingStore } from './findings'
import { registerFlowApi } from './flow-api'
import { SendGate } from './gate'
import { Ingestor } from './ingest'
import { LoginWatch } from './login-watch'
import { MixFlow } from './mix'
import { MonitorFlow } from './monitor'
import { PostGroupsFlow } from './post-groups'
import { PublicationsFlow } from './publications'
import { QuickHelp } from './quick-help'
import { ReviewFlow } from './review'
import { SendingFlow } from './sending'
import { FlowStore } from './store'
import { TriageFlow } from './triage'

/**
 * Registers the discussion → draft → approval → sending flow (I-4, I-5, I-6): the monitor, drafting, review,
 * gate and sending services (attached to `core.services`) and the opportunities.*, publications.*,
 * channels.discussions, channels.selectOlder, channels.activate, channels.checkNow and channels.setPaused handlers,
 * and drafts.refine (the AI writes or improves the text of a draft; nothing is saved), and quick.* (the AI in the quick-post composer).
 */
export function registerFlow(core: Core): void {
  const store = new FlowStore(core)
  const review = new ReviewFlow(core, store)
  const ingestor = new Ingestor(core, store, review)
  const gate = new SendGate(core, store)
  const watch = new LoginWatch(core, store)
  const sending = new SendingFlow(core, store, gate, review, ingestor, watch)
  const findings = new FindingStore(core)
  const triage = new TriageFlow(core, store, findings, ingestor)
  const monitor = new MonitorFlow(core, store, ingestor, watch, triage, new BrowserWatchFlow(core, store, findings, ingestor))
  const drafting = new DraftingFlow(core, store, review, sending)
  const publications = new PublicationsFlow(core, store)

  core.services.pipeline = review
  core.services.monitor = monitor
  core.services.drafting = drafting
  core.services.sending = sending

  registerFlowApi({ core, store, review, monitor, drafting, sending, publications, findings })
  const draftHelp = new DraftHelp(core, store)
  core.router.register({ 'drafts.refine': (args) => draftHelp.refine(args) })
  // "Reply here" in the Feed: the AI writes the comment for one place of a thread it read. Nothing is stored or sent.
  const findingReply = new FindingReply(core, findings)
  core.router.register({ 'findings.writeReply': (args) => findingReply.write(args) })
  // The AI in the quick-post composer (REQ-004): the caption, the picture, the search for trends and the marketer. Nothing is stored.
  const quickHelp = new QuickHelp(core)
  core.router.register({
    'quick.caption': (args) => quickHelp.caption(args),
    'quick.picture': (args) => quickHelp.picture(args),
    'quick.assess': (args) => quickHelp.assess(args),
    'quick.trends': (args) => quickHelp.trends(args)
  })
  const groups = new PostGroupsFlow(core, store, review, sending, draftHelp)
  core.router.register({
    'postGroups.create': ({ productId, channelIds, draft }) => groups.create(productId, channelIds, draft),
    'postGroups.extend': ({ opportunityId, channelIds }) => groups.extend(opportunityId, channelIds),
    'postGroups.get': ({ id }) => groups.get(id),
    'postGroups.list': ({ productId }) => groups.list(productId),
    'postGroups.channels': ({ productId, draft, chosen }) => groups.channels(productId, draft, chosen),
    'postGroups.adapt': ({ id, opportunityIds, force }) => groups.adapt(id, opportunityIds, force ?? false),
    'postGroups.approve': ({ id, seen }) => groups.approve(id, seen),
    'postGroups.sendAll': ({ id }) => groups.sendAll(id),
    'postGroups.remove': ({ id }) => groups.remove(id)
  })
  // The content mix (DEC-033): drafts only; the scheduler's mix job calls `runDue`.
  const mix = new MixFlow(core, store, publications)
  core.services.mix = mix
  core.router.register({
    'mix.get': ({ channelId }) => mix.card(channelId),
    'mix.propose': ({ channelId }) => mix.propose(channelId),
    'updates.add': ({ productId, text }) => mix.addNote(productId, text),
    'updates.list': ({ productId }) => mix.listNotes(productId),
    'updates.remove': ({ id }) => mix.removeNote(id)
  })
  const draftCheck = new DraftCheck(core, store)
  core.router.register({ 'drafts.check': (args) => draftCheck.check(args) })
}
