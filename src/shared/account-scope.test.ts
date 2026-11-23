import { describe, expect, it } from 'vitest'
import { peopleOfProduct, productOfAccount } from './account-scope'
import type { Account, Channel, Profile } from './types'

const NM = 'natal-mystic'
const SA = 'sirius-art'
const profile = (id: string, productId: string | null): Profile => ({ id, label: id, productId }) as unknown as Profile
const account = (id: string, profileId: string | null, productId: string | null): Account => ({ id, label: id, platform: 'reddit', profileId, productId }) as unknown as Account
const channel = (id: string, productId: string, accountId: string): Channel => ({ id, productId, accountId }) as unknown as Channel
const ids = (people: { profiles: Profile[]; accounts: Account[] }) => ({ profiles: people.profiles.map((p) => p.id), accounts: people.accounts.map((a) => a.id) })

// The owner's library on 2026-11-23: Boris Velnarov speaks for Natal Mystic, Sirius Art Official for Sirius Art; some logins were made
// with no product (Boris's Instagram and Threads, Sirius's Reddit and Threads) and belong through their person.
const profiles = [profile('boris', NM), profile('sirius', SA)]
const accounts = [
  account('boris-ig', 'boris', null),
  account('boris-rd', 'boris', NM),
  account('boris-th', 'boris', null),
  account('sirius-fb', 'sirius', SA),
  account('sirius-rd', 'sirius', null),
  account('sirius-th', 'sirius', null)
]
const channels = [channel('c1', NM, 'boris-rd'), channel('c2', NM, 'boris-ig'), channel('c3', SA, 'sirius-rd')]

describe("the people and logins of a product", () => {
  it("lists only the product's person with all of their logins, as the owner expects on the Accounts screen", () => {
    expect(ids(peopleOfProduct(NM, profiles, accounts, channels))).toEqual({ profiles: ['boris'], accounts: ['boris-ig', 'boris-rd', 'boris-th'] })
    expect(ids(peopleOfProduct(SA, profiles, accounts, channels))).toEqual({ profiles: ['sirius'], accounts: ['sirius-fb', 'sirius-rd', 'sirius-th'] })
  })

  it("also lists another product's person whose login serves one of the product's channels (an account shared on purpose, DEC-015)", () => {
    const shared = [...channels, channel('c4', NM, 'sirius-fb')]
    expect(ids(peopleOfProduct(NM, profiles, accounts, shared)).profiles).toEqual(['boris', 'sirius'])
    expect(ids(peopleOfProduct(SA, profiles, accounts, shared)).profiles).toEqual(['sirius'])
  })

  it('counts a person made for no product for the product its logins were made for', () => {
    const people = [profile('ann', null)]
    const logins = [account('ann-rd', 'ann', SA)]
    expect(ids(peopleOfProduct(SA, people, logins, []))).toEqual({ profiles: ['ann'], accounts: ['ann-rd'] })
    expect(ids(peopleOfProduct(NM, people, logins, []))).toEqual({ profiles: [], accounts: [] })
  })

  it('lists a login without a person in the product it was made for or serves, and nowhere else', () => {
    const logins = [account('made', null, NM), account('serves', null, null)]
    const used = [channel('c9', SA, 'serves')]
    expect(ids(peopleOfProduct(NM, [], logins, used)).accounts).toEqual(['made'])
    expect(ids(peopleOfProduct(SA, [], logins, used)).accounts).toEqual(['serves'])
  })

  it('lists a person or a login tied to no product and serving no channel in every product, so nothing is hidden', () => {
    const people = [profile('new', null)]
    const logins = [account('new-rd', 'new', null), account('loose', null, null)]
    expect(ids(peopleOfProduct(NM, people, logins, []))).toEqual({ profiles: ['new'], accounts: ['new-rd', 'loose'] })
    expect(ids(peopleOfProduct(SA, people, logins, []))).toEqual({ profiles: ['new'], accounts: ['new-rd', 'loose'] })
  })

  it('treats a login whose person was removed as a login without a person', () => {
    expect(ids(peopleOfProduct(NM, [], [account('orphan', 'gone', NM)], [])).accounts).toEqual(['orphan'])
    expect(ids(peopleOfProduct(SA, [], [account('orphan', 'gone', NM)], [])).accounts).toEqual([])
  })
})

describe('the product a link to one login opens', () => {
  it("is the product of the login's person, else the one it was made for, else the one whose channel it serves", () => {
    expect(productOfAccount('sirius-rd', profiles, accounts, channels)).toBe(SA)
    expect(productOfAccount('made', [], [account('made', null, NM)], [])).toBe(NM)
    expect(productOfAccount('serves', [], [account('serves', null, null)], [channel('c', SA, 'serves')])).toBe(SA)
    expect(productOfAccount('loose', [], [account('loose', null, null)], [])).toBeNull()
    expect(productOfAccount('missing', profiles, accounts, channels)).toBeNull()
  })
})
