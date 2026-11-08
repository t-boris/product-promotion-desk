// Roles of logins (DEC-010): a short name plus a voice, set by the owner. The AI may propose roles and login-name ideas;
// the application never registers accounts and never sees a password: the owner creates the real login on the platform.

import { ApiError } from '../../shared/api'
import type { AccountRole, PlatformInfo, RoleSuggestion } from '../../shared/types'
import type { Core } from '../core'
import { AiError } from '../ports'
import type { RoleSuggestInput, suggestRoles } from './ai-help'
import { listPlatforms } from './platforms'
import { prepareSuggestion } from './suggestions'

export const MAX_ROLE_NAME = 40
export const MAX_ROLE_VOICE = 280

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** True when the text holds a control character (line breaks and tabs are turned into spaces before this is asked). */
const hasControlCharacter = (text: string): boolean => [...text].some((char) => {
  const code = char.charCodeAt(0)
  return code < 32 || (code >= 127 && code <= 159)
})

/**
 * The role as it is stored: trimmed, with runs of white space (line breaks included) turned into single spaces.
 * null (or undefined) means "no role". Anything else that is not a usable role is refused.
 */
export function parseRole(input: unknown): AccountRole | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'object' || Array.isArray(input)) throw new ApiError('invalid_input', 'A role needs a name and a voice.')
  const { name, voice } = input as { name?: unknown; voice?: unknown }
  if (typeof name !== 'string') throw new ApiError('invalid_input', 'The role name is missing.')
  if (voice !== undefined && voice !== null && typeof voice !== 'string') throw new ApiError('invalid_input', 'The voice of the role must be text.')
  const cleanName = tidy(name)
  const cleanVoice = tidy(typeof voice === 'string' ? voice : '')
  if (hasControlCharacter(cleanName) || hasControlCharacter(cleanVoice)) throw new ApiError('invalid_input', 'The role must not contain control characters.')
  const nameLength = [...cleanName].length
  if (nameLength < 1) throw new ApiError('invalid_input', 'The role name is missing.')
  if (nameLength > MAX_ROLE_NAME) throw new ApiError('invalid_input', `The role name is too long (limit ${MAX_ROLE_NAME} characters).`)
  if ([...cleanVoice].length > MAX_ROLE_VOICE) throw new ApiError('invalid_input', `The voice is too long (limit ${MAX_ROLE_VOICE} characters).`)
  return { name: cleanName, voice: cleanVoice }
}

export const sameRoleName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The AI helper this service calls (ai-help.ts); injectable so tests can script it. */
export interface RoleHelp {
  suggestRoles: typeof suggestRoles
}

/** "Suggest roles with AI": ideas only. Nothing is created and nothing is registered on any platform. */
export class RoleSuggestionService {
  constructor(
    private readonly core: Core,
    private readonly ai: RoleHelp
  ) {}

  async suggest(args: { productId: string }): Promise<RoleSuggestion[]> {
    const { product, engine, claims } = await prepareSuggestion(this.core, args.productId)
    const platforms = listPlatforms(this.core.connectors)
    const accounts = this.core.repos.accountsOfProduct(product.id)
    // The platform the owner is working on: the one of the most recent login, else the first prepared platform.
    const latest = accounts.reduce<(typeof accounts)[number] | null>((best, account) => (best === null || account.createdAt >= best.createdAt ? account : best), null)
    const platform: PlatformInfo | undefined = platforms.find((p) => p.platform === latest?.platform) ?? platforms.find((p) => p.prepared) ?? platforms[0]
    if (!platform) throw new ApiError('invalid_input', 'No platform is available to suggest roles for.')
    const existing = accounts.flatMap((account) => (account.platform === platform.platform && account.role ? [account.role.name] : []))

    const input: RoleSuggestInput = {
      product: { name: product.name, websiteUrl: product.websiteUrl, description: product.description },
      claims,
      platform,
      existingRoles: existing
    }
    try {
      const answered = await this.ai.suggestRoles(engine, input)
      // "Use this role" must lead to a login that can be created: drop ideas the role rules would refuse or that repeat a role in use.
      const usable = answered.filter((idea) => {
        try {
          const role = parseRole({ name: idea.name, voice: idea.voice })
          return role !== null && !existing.some((name) => sameRoleName(name, role.name))
        } catch {
          return false
        }
      })
      this.core.log.info('accounts', `Suggested ${usable.length} role${usable.length === 1 ? '' : 's'} for ${product.name} on ${platform.label}. None is created; the owner creates the real login on the platform.`)
      return usable
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('suggest_failed', error.message)
      throw error
    }
  }
}
