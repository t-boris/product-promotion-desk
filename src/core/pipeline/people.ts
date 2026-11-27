// The people met while promoting a product (DEC-066). The owner's own notes: typed by hand, kept on this computer, never given to the AI and
// never posted. A testimonial is kept with where it was said and whether its author let it be quoted.
import { ApiError } from '../../shared/api'
import { MAX_HANDLE, MAX_NOTE, MAX_OWED, MAX_PEOPLE, MAX_SOURCE, MAX_TESTIMONIAL, MAX_WHERE, PERMISSIONS, type Permission, type Person, type PersonFields } from '../../shared/people'
import type { Id } from '../../shared/types'
import { oneLine, plainText } from '../assist/kit'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { newId } from '../db/database'

type Row = Record<string, unknown>
const mapPerson = (r: Row): Person => ({
  id: r.id as string,
  productId: r.product_id as string,
  handle: r.handle as string,
  platform: r.platform as string,
  where: r.where_met as string,
  note: r.note as string,
  owed: r.owed as string,
  testimonial: r.testimonial as string,
  testimonialSource: r.testimonial_source as string,
  permission: r.permission as Permission,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

export class People {
  constructor(private readonly core: Core) {}

  /** The people of a product; those the owner owes something first, then the latest touched. */
  list(args: { productId: Id }): Person[] {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    return (this.core.db.prepare("SELECT * FROM people WHERE product_id = ? ORDER BY (owed = '') ASC, updated_at DESC, rowid DESC").all(product.id) as Row[]).map(mapPerson)
  }

  private fields(raw: Partial<PersonFields>): PersonFields {
    const text = (value: unknown, max: number): string => (typeof value === 'string' ? plainText(value, max) : '')
    const handle = oneLine(typeof raw.handle === 'string' ? raw.handle : '', MAX_HANDLE)
    if (handle === '') throw new ApiError('invalid_input', 'Say who it is: a name or a handle.')
    const permission = PERMISSIONS.find((p) => p === raw.permission) ?? 'none'
    const testimonial = text(raw.testimonial, MAX_TESTIMONIAL)
    let source = oneLine(typeof raw.testimonialSource === 'string' ? raw.testimonialSource : '', MAX_SOURCE)
    if (source !== '') {
      try {
        const url = new URL(source)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not a web address')
        source = url.toString()
      } catch {
        throw new ApiError('invalid_input', 'Where they said it must be a web address (https://…), or empty.')
      }
    }
    return {
      handle,
      platform: oneLine(typeof raw.platform === 'string' ? raw.platform : '', 40),
      where: oneLine(typeof raw.where === 'string' ? raw.where : '', MAX_WHERE),
      note: text(raw.note, MAX_NOTE),
      owed: oneLine(typeof raw.owed === 'string' ? raw.owed : '', MAX_OWED),
      testimonial,
      testimonialSource: source,
      // A permission belongs to words: without a testimonial there is nothing to permit.
      permission: testimonial === '' ? 'none' : permission
    }
  }

  /** Adds a person (no id) or changes one. */
  save(args: { productId: Id; id?: Id | null } & Partial<PersonFields>): Person {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const f = this.fields(args)
    const now = this.core.clock.now().toISOString()
    let id = args.id ?? null
    if (id) {
      const row = this.core.db.prepare('SELECT product_id FROM people WHERE id = ?').get(id) as { product_id: Id } | undefined
      if (!row || row.product_id !== product.id) throw new ApiError('not_found', 'That person is not kept any more.')
      this.core.db
        .prepare('UPDATE people SET handle = ?, platform = ?, where_met = ?, note = ?, owed = ?, testimonial = ?, testimonial_source = ?, permission = ?, updated_at = ? WHERE id = ?')
        .run(f.handle, f.platform, f.where, f.note, f.owed, f.testimonial, f.testimonialSource, f.permission, now, id)
    } else {
      const count = (this.core.db.prepare('SELECT COUNT(*) AS n FROM people WHERE product_id = ?').get(product.id) as { n: number }).n
      if (count >= MAX_PEOPLE) throw new ApiError('invalid_state', `A product keeps at most ${MAX_PEOPLE} people. Delete one first.`)
      id = newId()
      this.core.db
        .prepare('INSERT INTO people (id, product_id, handle, platform, where_met, note, owed, testimonial, testimonial_source, permission, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, product.id, f.handle, f.platform, f.where, f.note, f.owed, f.testimonial, f.testimonialSource, f.permission, now, now)
    }
    this.core.events.changed('products')
    return mapPerson(this.core.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as Row)
  }

  remove(args: { id: Id }): { removed: true } {
    const done = this.core.db.prepare('DELETE FROM people WHERE id = ?').run(requireText(args.id, 'The person'))
    if (done.changes === 0) throw new ApiError('not_found', 'That person is not kept any more.')
    this.core.events.changed('products')
    return { removed: true }
  }
}
