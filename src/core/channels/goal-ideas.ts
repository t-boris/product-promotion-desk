// "Suggest a goal with AI": one promotion goal idea at a time, from the approved passport. Nothing is saved here: the owner turns an
// idea into a goal on the Goal tab (products.saveGoal), the one place where goals are written (DEC-009, DEC-012, DEC-019).

import { ApiError } from '../../shared/api'
import type { GoalIdea } from '../../shared/types'
import type { Core } from '../core'
import { AiError } from '../ports'
import { collapseWhitespace } from '../passports/text'
import type { suggestGoal } from './ai-help'
import { prepareSuggestion } from './suggestions'

/** The AI helper this service calls (ai-help.ts); injectable so tests can script it. */
export interface GoalIdeaHelp {
  suggestGoal: typeof suggestGoal
}

const MAX_HINT = 300
const MAX_AVOID = 20
const MAX_AVOID_TEXT = 500

/** The owner's one-line preference: text only, one line, cut. Anything else is "no preference". */
function readHint(value: unknown): string {
  return typeof value === 'string' ? collapseWhitespace(value).slice(0, MAX_HINT) : ''
}

/** The ideas already shown: the screen keeps them, the core only bounds what it passes on to the AI. */
function readAvoid(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => collapseWhitespace(item).slice(0, MAX_AVOID_TEXT))
    .filter(Boolean)
    .slice(-MAX_AVOID)
}

export class GoalIdeaService {
  constructor(
    private readonly core: Core,
    private readonly ai: GoalIdeaHelp
  ) {}

  async suggest(args: { productId: string; hint?: unknown; avoid?: unknown }): Promise<GoalIdea | null> {
    const { product, engine, claims } = await prepareSuggestion(this.core, args.productId)
    const input = {
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      claims,
      existing: product.goals.map((goal) => goal.targetAction),
      shown: readAvoid(args.avoid),
      hint: readHint(args.hint)
    }
    try {
      const idea = await this.ai.suggestGoal(engine, input)
      // The log says that an idea was offered, not what it says (as for goals, BUG-066).
      this.core.log.info('passports', idea ? `Suggested a goal for ${product.name}. Nothing is saved.` : `The AI had no new goal idea for ${product.name}.`)
      return idea
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
  }
}
