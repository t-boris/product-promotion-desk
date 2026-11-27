import { requireText } from '../channels/errors'
import type { Core } from '../core'
import { BrowserWatchFlow } from './browser-watch'
import { DraftCheck } from './draft-check'
import { DraftHelp } from './draft-help'
import { FlairHelp } from './flair-help'
import { PostComposer } from './compose-flow'
import { SectionEditor } from './section-flow'
import { FindingPictures } from './finding-pictures'
import { accountHealth, setWarmUp } from './account-health'
import { AnswerCheck } from './answer-check'
import { translateDraft } from './draft-translate'
import { AudienceWords } from './audience-words'
import { Listening } from './listening'
import { GoalTargets } from './goal-targets'
import { People } from './people'
import { SeasonalCalendar } from './seasonal'
import { buildCard } from './cards'
import { ChannelTrials } from './channel-trials'
import { Positioning } from './positioning'
import { FeedAnalysis } from './feed-analysis'
import { WeeklyReview } from './weekly-review'
import { FindingAssistant } from './finding-assist'
import { FindingReply } from './finding-reply'
import { FindingSend } from './finding-send'
import { FindingTags } from './finding-tags'
import { FindingTranslate } from './finding-translate'
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
  // The tags of the posts: given by the AI to the noted posts that have none, again after a look.
  const tags = new FindingTags(core, findings)
  // The audience's own words (DEC-059), taken from the posts the Feed read; `words` is set below, once the publications flow exists.
  let words: AudienceWords | null = null
  const watcher = new BrowserWatchFlow(core, store, findings, ingestor, pictures, (productId) => {
    tags.refreshSoon(productId)
    feedAnalysis.refreshSoon(productId)
    words?.refreshSoon(productId)
  })
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
  // The Flair line of the post editor: what the community offers (read-only, kept ten minutes) and the AI's proposal from that list.
  const flairHelp = new FlairHelp(core)
  core.router.register({ 'channels.postForm': (args) => flairHelp.postForm(args), 'drafts.suggestFlair': (args) => flairHelp.suggest(args) })
  // A post made from the owner's own material: files or a folder, what the post should be like, how long. Nothing is saved or sent.
  const postComposer = new PostComposer(core, store)
  core.router.register({ 'material.preview': (args) => postComposer.preview(args), 'drafts.compose': (args) => postComposer.compose(args) })
  // "Change a part": the AI changes the section the owner selected and nothing else; the owner sees old and new and decides.
  const sectionEditor = new SectionEditor(core, store)
  core.router.register({ 'drafts.editSection': (args) => sectionEditor.edit(args) })
  // "Reply here" in the Feed: the AI writes the comment for one place of a thread it read. Nothing is stored or sent.
  const findingReply = new FindingReply(core, findings)
  core.router.register({ 'findings.writeReply': (args) => findingReply.write(args) })
  // Send in the same window: the owner's own text is put under the post or under the comment by the AI in the account's browser, on the owner's press.
  const findingSend = new FindingSend(core, store, findings, review)
  core.router.register({
    'findings.send': ({ id, place, text }) => findingSend.send({ id: requireText(id, 'The post'), place: place ?? null, text }),
    'findings.schedule': ({ id, place, text, at }) => findingSend.schedule({ id: requireText(id, 'The post'), place: place ?? null, text, at }),
    'findings.unschedule': ({ opportunityId }) => {
      findingSend.unschedule(requireText(opportunityId, 'The answer'))
      return { ok: true as const }
    },
    'findings.saveDraft': ({ id, place, text }) => findingSend.saveDraft({ id: requireText(id, 'The post'), place: place ?? null, text }),
    'findings.replies': ({ id }) => findingSend.replies(requireText(id, 'The post'))
  })
  // Reading a post in the language the owner reads: translating it and its comments, and the AI's explanation of it. No post is changed, nothing is posted or sent.
  const translate = new FindingTranslate(core, findings)
  const assistant = new FindingAssistant(core, findings, (finding) => watcher.readPost(finding))
  core.router.register({
    'findings.translation': (args) => translate.get(args),
    'findings.translate': (args) => translate.translate(args),
    'findings.assistance': (args) => assistant.get(args),
    'findings.assist': (args) => assistant.assist(args),
    'findings.tag': (args) => tags.tag(args),
    'tags.view': (args) => tags.view(args)
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
  // Positioning (DEC-059): five answers proposed from the approved passport and approved by the owner; the angle of the AI's proposed posts.
  const positioning = new Positioning(core)
  core.router.register({
    'positioning.get': (args) => positioning.get(args),
    'positioning.propose': (args) => positioning.propose(args),
    'positioning.approve': (args) => positioning.approve(args),
    'positioning.dismiss': (args) => positioning.dismiss(args)
  })
  const bank = new AudienceWords(core, findings, async (channelId, focus) => buildCard(core, store, await publications.suggest(channelId, { focus, origin: 'From the audience\'s words' })))
  words = bank
  core.router.register({
    'words.list': (args) => bank.view(args),
    'words.collect': (args) => bank.collect(args),
    'words.remove': (args) => bank.remove(args),
    'words.suggestPost': (args) => bank.suggestPost(args)
  })
  // The AI-answer check (DEC-061): buyer questions asked through the engine with web search; the scheduler asks again after a month.
  const answers = new AnswerCheck(core)
  core.services.answers = answers
  core.router.register({
    'answers.get': (args) => answers.view(args),
    'answers.setQuestions': (args) => answers.setQuestions(args),
    'answers.propose': (args) => answers.propose(args),
    'answers.ask': (args) => answers.ask(args)
  })
  // Wider listening (DEC-062): the product's name, phrases and competitors looked for on the open web; the scheduler looks again after a week.
  const listening = new Listening(core)
  core.services.listening = listening
  core.router.register({
    'listening.get': (args) => listening.view(args),
    'listening.setTerms': (args) => listening.setTerms(args),
    'listening.look': (args) => listening.look(args),
    'listening.dismiss': (args) => listening.dismiss(args)
  })
  // A goal's number and date (DEC-067): counted by the application; no AI.
  const goalTargets = new GoalTargets(core)
  core.router.register({
    'goals.progress': (args) => goalTargets.progress(args),
    'goals.setTarget': (args) => goalTargets.set(args)
  })
  // The people met (DEC-066): the owner's own notes; no AI, nothing posted.
  const people = new People(core)
  core.router.register({
    'people.list': (args) => people.list(args),
    'people.save': (args) => people.save(args),
    'people.remove': (args) => people.remove(args)
  })
  // Translate my post (DEC-065): a translation of the editor's title and text; nothing is stored.
  core.router.register({ 'drafts.translate': (args) => translateDraft(core, args) })
  // Account health (DEC-064): the share of what an account sent that carries the product's site, and its channels' reach, counted on demand.
  core.router.register({ 'accounts.health': (args) => accountHealth(core, args), 'accounts.warmUp': (args) => setWarmUp(core, args) })
  // The seasonal calendar (DEC-060): computed and listed dates, the owner's own, and a draft per date and channel on the owner's press.
  const seasonal = new SeasonalCalendar(core, async (channelId, focus, origin) => buildCard(core, store, await publications.suggest(channelId, { focus, origin })))
  core.router.register({
    'seasonal.get': (args) => seasonal.view(args),
    'seasonal.setKinds': (args) => seasonal.setKinds(args),
    'seasonal.addDate': (args) => seasonal.addDate(args),
    'seasonal.removeDate': (args) => seasonal.removeDate(args),
    'seasonal.skip': (args) => seasonal.skip(args),
    'seasonal.prepare': (args) => seasonal.prepare(args)
  })
  // Channel trials (DEC-058): the terms written before the weeks are spent, the numbers counted, the owner's verdict.
  const trials = new ChannelTrials(core, store)
  core.router.register({
    'trials.get': ({ channelId }) => trials.view(channelId),
    'trials.start': (args) => trials.start(args),
    'trials.decide': (args) => trials.decide(args),
    'trials.propose': ({ channelId }) => trials.propose(channelId)
  })
  // The weekly review (DEC-057): the numbers are counted, the AI writes the words and one change, the owner answers. The scheduler prepares it on Monday.
  const weekly = new WeeklyReview(core)
  core.services.weekly = weekly
  core.router.register({
    'weekly.get': (args) => weekly.get(args),
    'weekly.prepare': (args) => weekly.prepare(args),
    'weekly.decide': (args) => weekly.decide(args)
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
