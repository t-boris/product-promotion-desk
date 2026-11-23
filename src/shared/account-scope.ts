// Which people (profiles) and logins (accounts) belong to a product (owner, 2026-11-23, narrowing DEC-015): the Accounts screen and the
// top bar's count show the open product's, not every product's. An account can still serve a channel of another product; it is then
// listed in both. Pure, so the screen, the top bar and the core read one rule.

import type { Account, Channel, Id, Profile } from './types'

export interface ProductPeople {
  profiles: Profile[]
  /** The logins listed with the product: every login of a listed person, and the logins without a person that belong to it. */
  accounts: Account[]
}

/**
 * The people and logins of `productId`:
 * - a person made for the product, or one whose login serves a channel of the product, with every login of that person;
 * - a person made for no product counts for the product its logins were made for;
 * - a login without a person, made for the product or serving one of its channels;
 * - a person or a login tied to no product and serving no channel belongs to none yet, so it is listed in every product (nothing is hidden).
 */
export function peopleOfProduct(productId: Id, profiles: readonly Profile[], accounts: readonly Account[], channels: readonly Channel[]): ProductPeople {
  const serving = new Set(channels.filter((c) => c.productId === productId).map((c) => c.accountId))
  const used = new Set(channels.map((c) => c.accountId))
  const free = (a: Account): boolean => a.productId === null && !used.has(a.id)
  const listed = profiles.filter((profile) => {
    if (profile.productId === productId) return true
    const logins = accounts.filter((a) => a.profileId === profile.id)
    if (logins.some((a) => serving.has(a.id))) return true
    return profile.productId === null && (logins.some((a) => a.productId === productId) || logins.every(free))
  })
  const kept = new Set(listed.map((p) => p.id))
  const known = new Set(profiles.map((p) => p.id))
  return {
    profiles: listed,
    accounts: accounts.filter((a) => (a.profileId !== null && known.has(a.profileId) ? kept.has(a.profileId) : a.productId === productId || serving.has(a.id) || free(a)))
  }
}

/**
 * The product a link to one login should open (an Inbox item names a login): the product of its person, else the product it was made for, else
 * the product of a channel it serves. Null: it belongs to no product, and is listed in every one.
 */
export function productOfAccount(accountId: Id, profiles: readonly Profile[], accounts: readonly Account[], channels: readonly Channel[]): Id | null {
  const account = accounts.find((a) => a.id === accountId)
  if (!account) return null
  const person = account.profileId ? profiles.find((p) => p.id === account.profileId) : undefined
  return person?.productId ?? account.productId ?? channels.find((c) => c.accountId === accountId)?.productId ?? null
}
