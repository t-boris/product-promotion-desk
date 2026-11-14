// assist.refine: the AI writes or improves the text of one field. Nothing is saved; the owner reads it and saves it with the form.

import { ApiError } from '../../shared/api'
import type { Core } from '../core'
import { AiError } from '../ports'
import { collapseWhitespace } from '../passports/text'
import { isAssistField, FIELDS } from './fields'
import { prepareAssist, readyEngine } from './gate'
import type { Claim, ProductFacts } from './kit'
import { refineText } from './refine'

/** The AI helper this service calls (refine.ts); injectable so tests can script it. */
export interface RefineHelp {
  refineText: typeof refineText
}

const MAX_CURRENT = 6000
const MAX_INSTRUCTION = 300
const MAX_AROUND = 6
const MAX_LABEL = 60
const MAX_AROUND_TEXT = 600

/** The other fields of the form as the screen sends them: text only, bounded. Anything else is left out. */
function readAround(value: unknown): { label: string; text: string }[] {
  if (!Array.isArray(value)) return []
  const items: { label: string; text: string }[] = []
  for (const entry of value) {
    if (items.length >= MAX_AROUND) break
    if (typeof entry !== 'object' || entry === null) continue
    const { label, text } = entry as { label?: unknown; text?: unknown }
    if (typeof label !== 'string' || typeof text !== 'string' || !text.trim()) continue
    items.push({ label: collapseWhitespace(label).slice(0, MAX_LABEL), text: text.slice(0, MAX_AROUND_TEXT) })
  }
  return items
}

export class AssistService {
  constructor(
    private readonly core: Core,
    private readonly ai: RefineHelp = { refineText }
  ) {}

  async refine(args: { field: unknown; productId?: unknown; current?: unknown; instruction?: unknown; around?: unknown }): Promise<{ text: string }> {
    if (!isAssistField(args.field)) throw new ApiError('invalid_input', 'The AI cannot help with this field.')
    const field = args.field
    const spec = FIELDS[field]

    let product: ProductFacts | null = null
    let claims: Claim[] = []
    let engine
    if (spec.needsProduct) {
      const prepared = await prepareAssist(this.core, args.productId, { passport: 'optional' })
      engine = prepared.engine
      product = { name: prepared.product.name, websiteUrl: prepared.product.websiteUrl, description: prepared.product.description }
      claims = prepared.claims
    } else {
      engine = await readyEngine(this.core)
    }

    const current = typeof args.current === 'string' ? args.current.slice(0, MAX_CURRENT) : ''
    const instruction = typeof args.instruction === 'string' ? collapseWhitespace(args.instruction).slice(0, MAX_INSTRUCTION) : ''
    try {
      const text = await this.ai.refineText(engine, { field, product, claims, around: readAround(args.around), current, instruction })
      // The log says that a text was written, not what it says.
      this.core.log.info('passports', `The AI ${current.trim() ? 'improved' : 'wrote'} the ${spec.label}. Nothing is saved.`)
      return { text }
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
  }
}
