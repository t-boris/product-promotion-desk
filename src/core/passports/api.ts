// API handlers: products.*, sources.*, analysis.*, passport.* (src/shared/api.ts).

import { ApiError } from '../../shared/api'
import type { Product, PromotionGoalInput } from '../../shared/types'
import { tx } from '../db/database'
import type { Core } from '../core'
import type { PassportModule } from './module'
import { isClaimStatus } from './claim-input'
import { previewSource, validateSource } from './sources'
import { normalizeHttpUrl } from './url-reader'

const MAX_NAME = 120
const MAX_DESCRIPTION = 60_000

function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new ApiError('invalid_input', `${what} is missing.`)
  return value
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new ApiError('invalid_input', 'Give the product a name.')
  if (name.length > MAX_NAME) throw new ApiError('invalid_input', `The name is too long (limit ${MAX_NAME} characters).`)
  return name
}

/** undefined = not given; null = cleared; otherwise the normalized value. */
function parseOptionalUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || (typeof value === 'string' && !value.trim())) return null
  return normalizeHttpUrl(value as string)
}

function parseOptionalDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new ApiError('invalid_input', 'The description must be text.')
  const text = value.trim()
  if (text.length > MAX_DESCRIPTION) throw new ApiError('invalid_input', `The description is too long (limit ${MAX_DESCRIPTION} characters).`)
  return text || null
}

/** A product can have several goals, but not an unbounded number: the Results tab shows them all. */
const MAX_GOALS = 20

function parseGoal(value: unknown): PromotionGoalInput {
  const goal = (value ?? {}) as Partial<PromotionGoalInput>
  const metrics = Array.isArray(goal.successMetrics) ? goal.successMetrics : []
  const targetAction = typeof goal.targetAction === 'string' ? goal.targetAction.trim().slice(0, 500) : ''
  if (!targetAction) throw new ApiError('invalid_input', 'A goal needs a target action: what a person should do.')
  return {
    ...(typeof goal.id === 'string' && goal.id ? { id: goal.id } : {}),
    targetAction,
    successMetrics: metrics.filter((m): m is string => typeof m === 'string').map((m) => m.trim().slice(0, 300)).filter(Boolean).slice(0, 30),
    notes: typeof goal.notes === 'string' ? goal.notes.trim().slice(0, 5000) : ''
  }
}

export function registerHandlers(core: Core, mod: PassportModule): void {
  const { store, claims, versions, analysis } = mod

  /** The primary website and description are mirrored as sources so that the analysis only reads sources. */
  const syncPrimary = (product: Product, next: { websiteUrl?: string | null; description?: string | null }): void => {
    const mirror = (kind: 'url' | 'text', oldValue: string | null, newValue: string | null | undefined, label: string): void => {
      if (newValue === undefined || newValue === oldValue) return
      const existing = store.sources(product.id).find((s) => s.kind === kind && s.ref === oldValue)
      if (newValue === null) {
        if (existing) store.removeSource(existing.id)
      } else if (existing) {
        store.updateSource(existing.id, { ref: newValue, label: kind === 'url' ? new URL(newValue).hostname : label })
      } else {
        store.insertSource({ productId: product.id, kind, ref: newValue, label: kind === 'url' ? new URL(newValue).hostname : label, scope: null })
      }
    }
    mirror('url', product.websiteUrl, next.websiteUrl, 'Website')
    mirror('text', product.description, next.description, 'Description')
  }

  core.router.register({
    'products.list': () => store.list(),

    'products.create': (args) => {
      const name = parseName(args?.name)
      const websiteUrl = parseOptionalUrl(args?.websiteUrl) ?? null
      const description = parseOptionalDescription(args?.description) ?? null
      if (!websiteUrl && !description) {
        throw new ApiError('invalid_input', 'Add a website address or a short description: one source is enough to start.')
      }
      const product = tx(core.db, () => {
        const created = store.insert({ name, websiteUrl, description })
        if (websiteUrl) store.insertSource({ productId: created.id, kind: 'url', ref: websiteUrl, label: new URL(websiteUrl).hostname, scope: null })
        if (description) store.insertSource({ productId: created.id, kind: 'text', ref: description, label: 'Description', scope: null })
        return created
      })
      core.log.info('passports', `Product created: ${product.name}`)
      mod.touch()
      return product
    },

    'products.update': (args) => {
      const id = requireId(args?.id, 'The product')
      const current = store.product(id)
      const name = args.name === undefined ? undefined : parseName(args.name)
      const websiteUrl = parseOptionalUrl(args.websiteUrl)
      const description = parseOptionalDescription(args.description)
      const product = tx(core.db, () => {
        syncPrimary(current, { websiteUrl, description })
        const updated = store.update(id, { name, websiteUrl, description })
        if (!updated.websiteUrl && !updated.description && store.sources(id).length === 0) {
          throw new ApiError('invalid_input', 'A product needs at least a website address or a description.')
        }
        return updated
      })
      mod.touch()
      return product
    },

    'products.delete': async (args) => {
      const id = requireId(args?.id, 'The product')
      const product = store.product(id)
      const dependents = store.dependents(id)
      if (dependents.sendActions > 0) {
        throw new ApiError('conflict', `"${product.name}" has publication history, which must be kept. Products with publications cannot be deleted.`)
      }
      if (dependents.channels > 0) {
        throw new ApiError('conflict', `"${product.name}" still has ${dependents.channels} connected channel(s). Remove them first.`)
      }
      await analysis.stop(id)
      store.remove(id)
      core.log.info('passports', `Product deleted: ${product.name}`)
      mod.touch()
    },

    'products.saveGoal': (args) => {
      const id = requireId(args?.id, 'The product')
      const goal = parseGoal(args.goal)
      if (goal.id === undefined && store.product(id).goals.length >= MAX_GOALS) {
        throw new ApiError('conflict', `A product can have at most ${MAX_GOALS} goals. Remove one before adding another.`)
      }
      const product = store.saveGoal(id, goal)
      mod.touch()
      return product
    },

    'products.removeGoal': (args) => {
      const id = requireId(args?.id, 'The product')
      const product = store.removeGoal(id, requireId(args?.goalId, 'The goal'))
      mod.touch()
      return product
    },

    'sources.add': (args) => {
      const productId = requireId(args?.productId, 'The product')
      const product = store.product(productId)
      const valid = validateSource(args)
      if (store.sources(productId).some((s) => s.kind === valid.kind && s.ref === valid.ref)) {
        throw new ApiError('conflict', 'This source is already added to the product.')
      }
      const source = tx(core.db, () => {
        const added = store.insertSource({ productId, ...valid })
        // The first website or description also becomes the product's own.
        if (valid.kind === 'url' && !product.websiteUrl) store.update(productId, { websiteUrl: valid.ref })
        if (valid.kind === 'text' && !product.description) store.update(productId, { description: valid.ref })
        return added
      })
      core.log.info('passports', `Source added to "${product.name}": ${valid.kind} ${valid.kind === 'text' ? '' : valid.ref}`.trim())
      mod.touch()
      return source
    },

    'sources.remove': (args) => {
      const source = store.source(requireId(args?.id, 'The source'))
      const product = store.product(source.productId)
      tx(core.db, () => {
        store.removeSource(source.id)
        if (source.kind === 'url' && product.websiteUrl === source.ref) store.update(product.id, { websiteUrl: null })
        if (source.kind === 'text' && product.description === source.ref) store.update(product.id, { description: null })
      })
      mod.touch()
    },

    'sources.preview': (args) => previewSource(args),

    'analysis.start': async (args) => {
      const productId = requireId(args?.productId, 'The product')
      await analysis.start(productId)
      return mod.view(productId)
    },

    'analysis.stop': async (args) => {
      const productId = requireId(args?.productId, 'The product')
      store.product(productId)
      await analysis.stop(productId)
      return mod.view(productId)
    },

    'passport.get': (args) => mod.view(requireId(args?.productId, 'The product')),

    'passport.versions': (args) => {
      const productId = requireId(args?.productId, 'The product')
      store.product(productId)
      return mod.repo.versions(productId)
    },

    'passport.claim.save': (args) => {
      const productId = requireId(args?.productId, 'The product')
      store.product(productId)
      const claim = claims.save(productId, args.claim)
      mod.touch()
      return claim
    },

    'passport.claim.setStatus': (args) => {
      if (!isClaimStatus(args?.status)) throw new ApiError('invalid_input', `Unknown claim status: ${String(args?.status)}`)
      const claim = claims.setStatus(requireId(args.claimId, 'The claim'), args.status)
      mod.touch()
      return claim
    },

    'passport.claim.delete': (args) => {
      claims.remove(requireId(args?.claimId, 'The claim'))
      mod.touch()
    },

    'passport.approve': (args) => {
      const productId = requireId(args?.productId, 'The product')
      const product = store.product(productId)
      const { version, changedLineageIds } = versions.approve(productId)
      core.log.info('passports', `Passport of "${product.name}" approved as version ${version.version}`)
      mod.touch()
      if (changedLineageIds.length > 0) {
        // Content already prepared with the old facts goes back to review. The approval itself stays valid even if
        // the pipeline fails to process the notification.
        try {
          const affected = core.services.pipeline?.invalidateForChangedFacts(productId, changedLineageIds)
          if (affected) core.log.info('passports', `${affected} pending item(s) sent back to review because facts changed`)
        } catch (error) {
          core.log.error('passports', `Could not send changed facts to the review queue: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return version
    }
  })
}
