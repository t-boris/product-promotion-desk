// "Change a part" (drafts.editSection): the service that takes the post as it is, the characters the owner selected and what they want changed, asks the engine for the new
// section only and hands it back with where it goes. The prompt and the checks are in section-edit.ts; nothing is stored here: the owner sees the old and the new side by side,
// uses the new or keeps their own, and the post is saved like any other. The log says that a part was changed, never what it says.

import { ApiError } from '../../shared/api'
import { SECTION_QUICKS, type DraftSource, type Id, type SectionEditResult, type SectionQuick } from '../../shared/types'
import { readyEngine } from '../assist/gate'
import { askWithRepair } from '../assist/kit'
import type { Core } from '../core'
import { AiError, type AiEngine, type AiRunOptions } from '../ports'
import { loadKnowledge, postChannelView, roleView } from './context'
import { MAX_CURRENT, knowledgeKey, ownerLine } from './draft-help'
import { postTarget } from './compose-flow'
import { MAX_SECTION, MAX_SECTION_WISH, readSectionAnswer, sectionPrompt, sectionWish, splitSection, type SectionAnswer, type SectionInput } from './section-edit'
import type { FlowStore } from './store'

export interface SectionArgs {
  channelId?: Id
  opportunityId?: Id
  form: { title: string; text: string }
  start: number
  end: number
  quick?: SectionQuick
  instruction?: string
}

/** The part of the engine call the service owns, injectable so the tests script it. */
export interface SectionEditorAi {
  editSection(engine: AiEngine, input: SectionInput, options?: AiRunOptions): Promise<SectionAnswer>
}

export async function editSection(engine: AiEngine, input: SectionInput, options: AiRunOptions = {}): Promise<SectionAnswer> {
  return askWithRepair(engine, sectionPrompt(input), (raw) => readSectionAnswer(raw, input), options)
}

export class SectionEditor {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly ai: SectionEditorAi = { editSection }
  ) {}

  async edit(args: SectionArgs): Promise<SectionEditResult> {
    const form = args.form as unknown
    if (typeof form !== 'object' || form === null || typeof (form as { title?: unknown }).title !== 'string' || typeof (form as { text?: unknown }).text !== 'string') {
      throw new ApiError('invalid_input', 'The draft is missing its title and text.')
    }
    const { title, text } = form as { title: string; text: string }
    if (text.length > MAX_CURRENT) throw new ApiError('invalid_input', 'The draft is too long for the AI to read whole.')
    // The selection is characters of the text as the owner sees it now: whole numbers inside the text, at least one character.
    if (!Number.isInteger(args.start) || !Number.isInteger(args.end) || args.start < 0 || args.end > text.length || args.start >= args.end) {
      throw new ApiError('invalid_input', 'Select the part of the text that should change.')
    }
    if (args.end - args.start > MAX_SECTION) throw new ApiError('invalid_input', `The selection is longer than ${MAX_SECTION} characters. Select a smaller part.`)
    const split = splitSection(text, args.start, args.end)
    if (split.core.trim() === '') throw new ApiError('invalid_input', 'Select words, not only blank space.')
    if (args.quick !== undefined && !SECTION_QUICKS.includes(args.quick)) throw new ApiError('invalid_input', 'The AI cannot change a part that way.')
    const instruction = ownerLine(args.instruction, MAX_SECTION_WISH, 'What to change')
    if (args.quick === undefined && instruction === '') throw new ApiError('invalid_input', 'Say what should change: shorter, longer, simpler, warmer, or your own words.')

    const { opp, channel } = postTarget(this.core, this.store, args)
    if (opp && opp.kind === 'reply') throw new ApiError('invalid_input', 'A reply has no parts to change here.')
    const engine = await readyEngine(this.core)
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)
    const input: SectionInput = {
      subject: {
        channel: postChannelView(channel),
        product: { name: product.name, website: product.websiteUrl, description: product.description },
        role: roleView(this.core.repos.account(channel.accountId)),
        approved: knowledge.approved,
        prohibited: knowledge.prohibited
      },
      title,
      text,
      start: args.start,
      end: args.end,
      split,
      wish: sectionWish(args.quick, instruction),
      progressSubject: args.opportunityId ?? args.channelId
    }

    let answer: SectionAnswer
    try {
      answer = await this.ai.editSection(engine, input)
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
    const nowProduct = this.core.repos.product(channel.productId)
    if (knowledgeKey(loadKnowledge(this.core, channel.productId), nowProduct) !== knowledgeKey(knowledge, product)) {
      throw new ApiError('suggest_failed', 'The product knowledge changed while the AI was writing. Ask again.')
    }
    const notes = answer.droppedPictures.length > 0 ? [`${answer.droppedPictures.length === 1 ? 'A picture is' : `${answer.droppedPictures.length} pictures are`} not in the new part. They stay with the post; put them back where you want them.`] : []
    this.core.log.info('pipeline', `The AI changed a part of a post for ${channel.target}. Nothing was saved.`)
    const sources: DraftSource[] = answer.sources
    return { start: args.start, end: args.end, replacement: answer.replacement, ...(sources.length > 0 ? { sources } : {}), notes }
  }
}
