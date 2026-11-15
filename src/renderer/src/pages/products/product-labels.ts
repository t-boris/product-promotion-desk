// What a list that mixes products calls each of them (BUG-054). A product name is not unique, so two products of one name looked
// identical in the product switcher and in the Product pop-ups of the screens that list more than one product. Pure, so the rule is tested
// without the interface.

import type { Id, Product } from '../../../../shared/types'

export type LabelledProduct = Pick<Product, 'id' | 'name' | 'createdAt'>

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_ID_LENGTH = 4

/** "14 Nov 13:46" on the owner's clock, or null when the time cannot be read. */
function shownTime(iso: string): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${two(at.getHours())}:${two(at.getMinutes())}`
}

/** The shortest start of each id, at least four characters, that no other id of the set shares. */
function shortIds(ids: readonly Id[]): Map<Id, string> {
  const longest = Math.max(...ids.map((id) => id.length))
  let length = MIN_ID_LENGTH
  while (length < longest && new Set(ids.map((id) => id.slice(0, length))).size < ids.length) length++
  return new Map(ids.map((id) => [id, id.slice(0, length)]))
}

/**
 * The label of every product, by id. A name that only one product has stays as it is. A name that several products share (compared
 * without case and without the spaces around it) gets the time the product was created, "Name · 14 Nov 13:46", on every one of
 * them. Where that time is the same minute for two products, or cannot be read, those products also get the start of their id, so no
 * two products of the list ever share a label. A label does not depend on the order of the list.
 */
export function productLabels(products: readonly LabelledProduct[]): Map<Id, string> {
  const byName = new Map<string, LabelledProduct[]>()
  for (const product of products) {
    const key = product.name.trim().toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), product])
  }
  const labels = new Map<Id, string>()
  for (const group of byName.values()) {
    if (group.length === 1) {
      labels.set(group[0].id, group[0].name)
      continue
    }
    const times = group.map((product) => shownTime(product.createdAt))
    const needsId = (i: number): boolean => times[i] === null || times.filter((time) => time === times[i]).length > 1
    const ids = shortIds(group.filter((_, i) => needsId(i)).map((product) => product.id))
    group.forEach((product, i) => {
      const parts = [times[i], needsId(i) ? `#${ids.get(product.id)}` : null].filter((part) => part !== null)
      labels.set(product.id, `${product.name.trim()} · ${parts.join(' · ')}`)
    })
  }
  return labels
}
