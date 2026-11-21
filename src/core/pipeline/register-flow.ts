import { requireText } from '../channels/errors'
import type { Core } from '../core'
import { BrowserWatchFlow } from './browser-watch'
import { DraftCheck } from './draft-check'
import { DraftHelp } from './draft-help'
import { FindingPictures } from './finding-pictures'
import { FeedAnalysis } from './feed-analysis'
import { FindingReply } from './finding-reply'
import { FindingSend } from './finding-send'
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
  const pictures = new FindingPictures(core, findings)
  // The analysis of the whole Feed: made on the owner's press, and again after a look when the posts changed.
  const feedAnalysis = new FeedAnalysis(core, findings)
  const watcher = new BrowserWatchFlow(core, store, findings, ingestor, pictures, (productId) => feedAnalysis.refreshSoon(productId))
  const monitor = new MonitorFlow(core, store, ingestor, watch, triage, watcher)
  const drafting = new DraftingFlow(core, store, review, sending)
  const publications = new PublicationsFlow(core, store)

  core.services.pipeline = review
  core.services.monitor = monitor
  core.services.drafting = drafting
  core.services.sending = sending

  registerFlowApi({ core, store, review, monitor, drafting, sending, publications, findings, watcher, pictures })
  const draftHelp = new DraftHelp(core, store)
  core.router.register({ 'drafts.refine': (args) => draftHelp.refine(args) })
  // "Reply here" in the Feed: the AI writes the comment for one place of a thread it read. Nothing is stored or sent.
  const findingReply = new FindingReply(core, findings)
  core.router.register({ 'findings.writeReply': (args) => findingReply.write(args) })
  // Send in the same window: the owner's own text is put under the post or under the comment by the AI in the account's browser, on the owner's press.
  const findingSend = new FindingSend(core, store, findings, review)
  core.router.register({
    'findings.send': ({ id, place, text, anyway }) => findingSend.send({ id: requireText(id, 'The post'), place: place ?? null, text, anyway: anyway === true }),
    'findings.schedule': ({ id, place, text, at, anyway }) => findingSend.schedule({ id: requireText(id, 'The post'), place: place ?? null, text, at, anyway: anyway === true }),
    'findings.unschedule': ({ opportunityId }) => {
      findingSend.unschedule(requireText(opportunityId, 'The answer'))
      return { ok: true as const }
    },
    'findings.saveDraft': ({ id, place, text }) => findingSend.saveDraft({ id: requireText(id, 'The post'), place: place ?? null, text }),
    'findings.replies': ({ id }) => findingSend.replies(requireText(id, 'The post'))
  })
  core.router.register({
    'feed.analysis': ({ productId, channelId, days }) => feedAnalysis.get({ productId, channelId: channelId ?? null, days }),
    'feed.analyze': ({ productId, channelId, days }) => feedAnalysis.run({ productId, channelId: channelId ?? null, days })
  })
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
