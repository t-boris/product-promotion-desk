// "Check before you approve" (drafts.check): the rules an AI draft passes, read against a text the owner wrote, before it is approved.
//
// The owner's own text is not checked on save and the approval refuses only what the gate already refuses (an empty reply, an image that
// cannot be read, another login speaking, and the connection to the product). This reads the text against the product knowledge and says,
// in the owner's words, which rule it breaks and which words it is about: a prohibited statement, a link that is not the product's own
// address (however it is written), a price, a discount or "free" no approved fact backs, something that looks like a password or a key,
// and the connection to the product. Only the connection can stop an approval (it is decided in code at the approval and at the send), so
// only its finding is marked as blocking; the others are advice the owner may set aside with "Approve anyway".
//
// Local and quick: no engine, nothing stored, and the text is never logged. An AI draft is not read again here (it passed these checks
// when it was written); the screen asks only for a text the owner wrote or changed.

import { ApiError } from '../../shared/api'
import type { DraftCheckResult, DraftFinding, Id } from '../../shared/types'
import { holdsCredential, isRecord } from '../assist/kit'
import { requireText } from '../channels/errors'
import type { Core } from '../core'
import { loadKnowledge } from './context'
import { disclosureVerdict } from './disclosure'
import { MAX_TITLE_CHARS } from './draft-prompt'
import { forChecks } from './draft-help'
import { allowedHostsFor, checkDraftSafety, type FindingRule } from './safety'
import type { FlowStore } from './store'

// The same limit as the text the AI is shown: a text longer than this is refused, never cut and never half read.
const MAX_TEXT = 20_000
const MAX_LINK = 2_000

export interface DraftCheckArgs {
  opportunityId: Id
  /** The editor as it stands (the owner changed something and has not saved); without it the saved draft is read. */
  form?: { title: string; text: string; link: string }
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
    const content = this.contentOf(opp.id, args.form)
    const channel = this.store.requireChannel(opp.channelId)
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)

    const findings: DraftFinding[] = []

    // The connection to the product: the rule the approval itself enforces, read the same way, on the text as it is.
    const verdict = disclosureVerdict(content, { name: product.name, websiteUrl: product.websiteUrl })
    if (verdict) {
      findings.push({
        rule: verdict.kind === 'denies' ? 'connection_denied' : 'connection_unsaid',
        title: verdict.kind === 'denies' ? 'The text denies a connection with the product' : 'The connection to the product is not said',
        quote: null,
        why: verdict.message,
        blocks: true
      })
    }

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
      findings.push({ rule: finding.rule as DraftFinding['rule'], title: finding.title, quote: finding.quote, why: finding.why, blocks: false })
    }

    if (holdsCredential([content.title, content.text].join('\n'))) {
      findings.push({
        rule: 'credential',
        title: 'Something that looks like a password or a key',
        quote: null,
        why: 'A reply or a post is public. Take it out before you approve.',
        blocks: false
      })
    }
    return { findings }
  }

  /** The text the owner is about to approve: the editor's, when it was sent, else the draft saved for this item. */
  private contentOf(opportunityId: Id, form: DraftCheckArgs['form']): { title: string; text: string; link: string } {
    if (form !== undefined) {
      const raw = form as unknown
      if (!isRecord(raw) || typeof raw.title !== 'string' || typeof raw.text !== 'string' || typeof raw.link !== 'string') {
        throw new ApiError('invalid_input', 'The draft is missing its title, text or link.')
      }
      if (raw.text.length > MAX_TEXT || raw.title.length > MAX_TITLE_CHARS || raw.link.length > MAX_LINK) {
        throw new ApiError('invalid_input', `The draft is too long to be checked whole (the text up to ${MAX_TEXT} characters, the title up to ${MAX_TITLE_CHARS}).`)
      }
      return { title: raw.title, text: raw.text, link: raw.link }
    }
    const draft = this.core.repos.latestDraft(opportunityId)
    if (!draft) throw new ApiError('no_draft', 'There is no draft to check. Write one first.')
    return { title: draft.title ?? '', text: draft.text, link: draft.link ?? '' }
  }
}
