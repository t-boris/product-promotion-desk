// "Make the post from my material" (drafts.compose, material.preview): the service that reads what the owner gave, asks the engine, turns the pictures the AI chose into
// pictures of the library and hands the owner a post to read and change. The prompt and the checks are in post-compose.ts; nothing is stored here (the owner saves the post
// like any other), and the log says that a post was made, never what it says.

import { ApiError } from '../../shared/api'
import { formOf } from '../../shared/post-format'
import { POST_LENGTHS, type Attachment, type ComposeResult, type Id, type MaterialPreview, type Opportunity, type PostLength, type Channel } from '../../shared/types'
import { readyEngine } from '../assist/gate'
import { askWithRepair } from '../assist/kit'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { AiError, type AiEngine, type AiRunOptions } from '../ports'
import { MAX_CURRENT, knowledgeKey } from './draft-help'
import { ATTACHMENT_MAX_COUNT } from './attachments'
import { loadKnowledge, postChannelView, roleView } from './context'
import { composePrompt, offerPictures, readComposeAnswer, MAX_BRIEF, type ComposeAnswer, type ComposeInput, type ComposeSubject } from './post-compose'
import { describeMaterial, readMaterial, type MaterialRead } from './post-material'
import type { FlowStore } from './store'

/** Material a screen may send at once: a handful of files and folders, not a list that could be a script. */
const MAX_PATHS = 50
const MAX_EXCLUDED = 500

export interface ComposeArgs {
  channelId?: Id
  opportunityId?: Id
  material: string[]
  exclude?: string[]
  brief?: string
  length?: PostLength
  form: { title: string; text: string }
}

/** The part of the engine call the service owns, injectable so the tests script it. */
export interface PostComposerAi {
  composePost(engine: AiEngine, input: ComposeInput, options?: AiRunOptions): Promise<ComposeAnswer>
}

export async function composePost(engine: AiEngine, input: ComposeInput, options: AiRunOptions = {}): Promise<ComposeAnswer> {
  return askWithRepair(engine, composePrompt(input), (raw) => readComposeAnswer(raw, input), options)
}

/** A list of paths from a screen: strings only, a bounded number. */
function pathList(value: unknown, what: string, max: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new ApiError('invalid_input', `${what} must be a list of paths.`)
  if (value.length > max) throw new ApiError('invalid_input', `${what} has more than ${max} entries.`)
  return value as string[]
}

/** What the owner wrote about the post: paragraphs are kept (a brief may be several), runs of blank lines and control characters are not. */
export function cleanBrief(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new ApiError('invalid_input', 'What the post should be like must be text.')
  // eslint-disable-next-line no-control-regex
  const brief = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (brief.length > MAX_BRIEF) throw new ApiError('invalid_input', `What the post should be like is longer than ${MAX_BRIEF} characters. Shorten it.`)
  return brief
}

/** The card or the channel the post is for. A card wins: its channel is the card's. */
export function postTarget(core: Core, store: FlowStore, args: { opportunityId?: Id; channelId?: Id }): { opp: Opportunity | null; channel: Channel } {
  if (args.opportunityId !== undefined && args.channelId !== undefined) throw new ApiError('invalid_input', 'Name the item or the channel, not both.')
  if (args.opportunityId !== undefined) {
    const opp = store.requireOpportunity(requireText(args.opportunityId, 'The item'))
    return { opp, channel: store.requireChannel(opp.channelId) }
  }
  const channelId = requireText(args.channelId, 'The channel')
  return { opp: null, channel: found(() => core.repos.channel(channelId), 'The channel') }
}

const altOf = (alt: string, name: string): string => (alt.replace(/[\]\n[]/g, ' ').trim() || name.replace(/\.[A-Za-z0-9]+$/, '')).slice(0, 80)

export class PostComposer {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly ai: PostComposerAi = { composePost }
  ) {}

  /** What is in the material, so the owner sees it before anything is written. Reads files, writes nothing. */
  preview(args: { paths: string[]; exclude?: string[] }): MaterialPreview {
    const paths = pathList(args?.paths, 'The material', MAX_PATHS)
    const read = readMaterial(paths, undefined, new Set(pathList(args?.exclude, 'The left-out files', MAX_EXCLUDED)))
    return {
      files: read.files.map((f) => ({ path: f.path, name: f.name, relative: f.relative, kind: f.kind, size: f.size })),
      summary: describeMaterial(read),
      skipped: read.skipped,
      cut: read.cut
    }
  }

  async compose(args: ComposeArgs): Promise<ComposeResult> {
    const form = args.form as unknown
    if (typeof form !== 'object' || form === null || typeof (form as { title?: unknown }).title !== 'string' || typeof (form as { text?: unknown }).text !== 'string') {
      throw new ApiError('invalid_input', 'The draft is missing its title and text.')
    }
    const current = form as { title: string; text: string }
    if (current.text.length > MAX_CURRENT) throw new ApiError('invalid_input', 'The draft is too long for the AI to read whole.')
    const length = args.length ?? 'medium'
    if (!POST_LENGTHS.includes(length)) throw new ApiError('invalid_input', 'Say how long the post should be: short, medium or long.')
    const brief = cleanBrief(args.brief)
    const paths = pathList(args.material, 'The material', MAX_PATHS)
    const { opp, channel } = postTarget(this.core, this.store, args)
    if (opp && opp.kind === 'reply') throw new ApiError('invalid_input', 'A reply is not made from material.')

    const material = readMaterial(paths, undefined, new Set(pathList(args.exclude, 'The left-out files', MAX_EXCLUDED)))
    if (material.texts.length === 0 && material.files.every((f) => f.kind !== 'picture') && brief === '') {
      throw new ApiError('invalid_input', 'Give the AI something to work from: a document, some pictures, or a few words about the post.')
    }
    const engine = await readyEngine(this.core)
    const product = this.core.repos.product(channel.productId)
    const knowledge = loadKnowledge(this.core, channel.productId)
    // The owner's material, or their own words, stands where approved facts stand for a post made from nothing; with neither, there is nothing true to say.
    if (material.texts.length === 0 && brief === '' && knowledge.approved.length === 0) {
      throw new ApiError('no_knowledge', 'There is no approved product knowledge yet, and no document to work from. Approve claims in the product passport, or give the AI a document.')
    }
    const subject: ComposeSubject = {
      channel: postChannelView(channel),
      product: { name: product.name, website: product.websiteUrl, description: product.description },
      role: roleView(this.core.repos.account(channel.accountId)),
      approved: knowledge.approved,
      prohibited: knowledge.prohibited
    }
    const { offered, more } = offerPictures(material)
    const input: ComposeInput = { subject, material, pictures: offered, morePictures: more, brief, length, form: current, progressSubject: args.opportunityId ?? args.channelId }

    let answer: ComposeAnswer
    try {
      answer = await this.ai.composePost(engine, input)
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
    // The checks ran against the knowledge the AI was given: if it changed while the AI was writing, the post is not handed over as checked.
    const nowProduct = this.core.repos.product(channel.productId)
    if (knowledgeKey(loadKnowledge(this.core, channel.productId), nowProduct) !== knowledgeKey(knowledge, product)) {
      throw new ApiError('suggest_failed', 'The product knowledge changed while the AI was writing. Ask again.')
    }

    const resolved = await this.placePictures(channel.productId, answer, input)
    const notes = [...notesOf(material, more, offered.length), ...resolved.notes]
    this.core.log.info('pipeline', `The AI made a post from ${material.files.length} file(s) for ${channel.target}, with ${resolved.attachments.length} picture(s). Nothing was saved.`)
    return { title: answer.title, text: resolved.text, attachments: resolved.attachments, ...(answer.sources.length > 0 ? { sources: answer.sources } : {}), notes }
  }

  /**
   * Turns each `![alt](file:pN)` the AI wrote into a picture of the library (`![alt](media:ID)`): the file is checked and copied by the library like any picture the owner
   * adds. A picture that cannot be kept (too large, not a real picture, unreadable) is left out of the text, and the owner is told which and why.
   */
  private async placePictures(productId: Id, answer: ComposeAnswer, input: ComposeInput): Promise<{ text: string; attachments: Attachment[]; notes: string[] }> {
    const refs = [...answer.text.matchAll(/!\[([^\]\n]{0,200})\]\(file:([A-Za-z0-9]{1,8})\)/g)]
    if (refs.length === 0) return { text: answer.text, attachments: [], notes: [] }
    const media = this.core.services.media
    if (!media) throw new ApiError('no_picker', 'This version cannot keep pictures here.')
    const byRef = new Map(input.pictures.map((p) => [p.ref, p.file]))
    const kept = new Map<string, { id: string; alt: string }>()
    const attachments: Attachment[] = []
    const notes: string[] = []
    const limit = Math.min(formOf(input.subject.channel.platform).maxPictures, ATTACHMENT_MAX_COUNT)
    for (const match of refs) {
      const file = byRef.get(match[2])
      if (!file) continue
      try {
        const item = await media.addFile(productId, file.path, file.name, 'picked', '')
        kept.set(match[2], { id: item.id, alt: altOf(match[1], item.name) })
        if (!attachments.some((a) => a.mediaId === item.id) && attachments.length < limit) {
          attachments.push({ name: item.name, path: item.path, mime: item.mime, sha256: item.sha256, mediaId: item.id })
        }
      } catch (error) {
        notes.push(`The picture ${file.relative} was left out: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const text = answer.text
      .replace(/!\[([^\]\n]{0,200})\]\(file:([A-Za-z0-9]{1,8})\)/g, (_all, _alt: string, ref: string) => {
        const item = kept.get(ref)
        return item ? `![${item.alt}](media:${item.id})` : ''
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return { text, attachments, notes }
  }
}

/** What the owner should know about what the AI was and was not shown, in words. */
function notesOf(material: MaterialRead, morePictures: number, offered: number): string[] {
  const notes: string[] = []
  for (const text of material.texts.filter((t) => t.truncated)) notes.push(`The AI was shown only the beginning of ${text.relative}.`)
  for (const skip of material.skipped.slice(0, 5)) notes.push(`${skip.relative} was not used: ${skip.reason}.`)
  if (material.skipped.length > 5) notes.push(`${material.skipped.length - 5} more files were not used.`)
  if (material.cut) notes.push('The folder holds more than was read (the first files, to a few levels deep, were used).')
  if (morePictures > 0) notes.push(`The AI was offered the first ${offered} pictures; ${morePictures} more were not offered.`)
  const videos = material.files.filter((f) => f.kind === 'video').length
  if (videos > 0) notes.push(`${videos === 1 ? 'A video was' : `${videos} videos were`} found; videos cannot be placed in a post yet.`)
  return notes
}
