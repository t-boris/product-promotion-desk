// "Check before you approve" (drafts.check): the rules an AI draft passes, read against a text the owner wrote, before it is approved.
//
// The owner's own text is not checked on save and the approval refuses only what the gate already refuses (an empty reply, an image that
// cannot be read, another login speaking). This reads the text against the product knowledge and says, in the owner's words, which rule it
// breaks and which words it is about: a prohibited statement, a link that is not the product's own address (however it is written), a price,
// a discount or "free" no approved fact backs, something that looks like a password or a key. Nothing here stops an approval: every
// finding is advice the owner may set aside with "Approve anyway".
//
// Local and quick: no engine, nothing stored, and the text is never logged. An AI draft is not read again here (it passed these checks
// when it was written); the screen asks only for a text the owner wrote or changed.

import { ApiError } from '../../shared/api'
import { renderForPlatform } from '../../shared/post-format'
import { cardHeadline } from '../../shared/quick-post'
import type { DraftCheckResult, DraftFinding, Id, PostMarkup } from '../../shared/types'
import { holdsCredential, isRecord } from '../assist/kit'
import { requireText } from '../channels/errors'
import type { Core } from '../core'
import { loadKnowledge } from './context'
import { MAX_TEXT_LENGTH, MAX_TITLE_LENGTH } from './draft-input'
import { forChecks } from './draft-help'
import { allowedHostsFor, checkDraftSafety, type FindingRule } from './safety'
import type { FlowStore } from './store'

// The limits of the save (draft-input.ts), so everything that can be saved can be read: a field longer than its limit is refused, never cut and never half read.
// The save has no limit for a link; it is read as text, so it gets the text's.
const MAX_TEXT = MAX_TEXT_LENGTH
const MAX_TITLE = MAX_TITLE_LENGTH
const MAX_LINK = MAX_TEXT_LENGTH

export interface DraftCheckArgs {
  opportunityId: Id
  /** The editor as it stands (the owner changed something and has not saved); without it the saved draft is read. */
  form?: { title: string; text: string; link: string; markup?: PostMarkup; cardHeadline?: string }
}

/** The safety rules that can be broken by a text that cites nothing; the two that are about citing never are, in the owner's mode. */
const SHOWN = new Set<FindingRule>(['prohibited', 'price', 'discount', 'free', 'link', 'unsafe_link'])

export class DraftCheck {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  check(args: DraftCheckArgs): DraftCheckResult {
    const opp = this.store.requireOpportunity(requireText(args.opportunityId, 'The item'))
    const channel = this.store.requireChannel(opp.channelId)
    // What is read is what the platform will show, as at the approval: the marks of a post written in the post editor are not words, and a title
    // a platform has no place for is not read at all (DEC-030). A text that is not markdown is read as it is.
    const written = this.contentOf(opp.id, args.form)
    const shown = renderForPlatform({ title: written.title || null, text: written.text, link: written.link || null, attachments: [], markup: written.markup }, channel.platform)
    // Q-008 / DEC-095: a quick post's card headline is drawn on the picture, so it is checked under the same rules as the caption even where the platform has no title field.
    const titleToCheck = [shown.title ?? '', written.cardHeadline].filter((part) => part.trim() !== '').join('\n')
    const content = { title: titleToCheck, text: shown.text, link: shown.shownLink ?? '' }
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)

    const findings: DraftFinding[] = []

    // The rules of an AI draft, on the text as the checks read it (invisible characters out, look-alike forms folded).
    const report = checkDraftSafety({
      mode: 'owner',
      title: forChecks(content.title),
      text: forChecks(content.text),
      link: forChecks(content.link),
      usedClaimIds: [],
      approved: knowledge.approved,
      prohibited: knowledge.prohibited,
      allowedHosts: allowedHostsFor(product.websiteUrl, knowledge.approved)
    })
    for (const finding of report.findings) {
      if (!SHOWN.has(finding.rule)) continue
      findings.push({ rule: finding.rule as DraftFinding['rule'], title: finding.title, quote: finding.quote, why: finding.why })
    }

    if (holdsCredential(forChecks([content.title, content.text].join('\n')))) {
      findings.push({
        rule: 'credential',
        title: 'Something that looks like a password or a key',
        quote: null,
        why: 'A reply or a post is public. Take it out before you approve.'
      })
    }
    return { findings }
  }

  /** The text the owner is about to approve: the editor's, when it was sent, else the draft saved for this item. */
  private contentOf(opportunityId: Id, form: DraftCheckArgs['form']): { title: string; text: string; link: string; markup: PostMarkup; cardHeadline: string } {
    if (form !== undefined) {
      const raw = form as unknown
      if (!isRecord(raw) || typeof raw.title !== 'string' || typeof raw.text !== 'string' || typeof raw.link !== 'string') {
        throw new ApiError('invalid_input', 'The draft is missing its title, text or link.')
      }
      if (raw.cardHeadline !== undefined && typeof raw.cardHeadline !== 'string') {
        throw new ApiError('invalid_input', 'The card headline must be text.')
      }
      if (raw.text.length > MAX_TEXT) throw new ApiError('invalid_input', `The text is longer than ${MAX_TEXT} characters and cannot be checked whole.`)
      if (raw.title.length > MAX_TITLE) throw new ApiError('invalid_input', `The title is longer than ${MAX_TITLE} characters and cannot be checked whole.`)
      if (raw.link.length > MAX_LINK) throw new ApiError('invalid_input', `The link is longer than ${MAX_LINK} characters and cannot be checked whole.`)
      const headline = typeof raw.cardHeadline === 'string' ? raw.cardHeadline : ''
      if (headline.length > MAX_TITLE) throw new ApiError('invalid_input', `The card headline is longer than ${MAX_TITLE} characters and cannot be checked whole.`)
      return { title: raw.title, text: raw.text, link: raw.link, markup: raw.markup === 'markdown' ? 'markdown' : 'legacy', cardHeadline: headline }
    }
    const draft = this.core.repos.latestDraft(opportunityId)
    if (!draft) throw new ApiError('no_draft', 'There is no draft to check. Write one first.')
    const headline = draft.postType === 'quick' && draft.card ? cardHeadline(draft.card, draft.text) : ''
    return { title: draft.title ?? '', text: draft.text, link: draft.link ?? '', markup: draft.markup, cardHeadline: headline }
  }
}
