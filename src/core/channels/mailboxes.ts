// Base mailboxes and the addresses made from them (DEC-015). A base mailbox is an ordinary mailbox of the owner; every account
// gets an address of its own from it (an alias: name+platform@host), so mail for one account is told apart from another's.
// Connecting to the mailbox to read it comes later (DEC-014); here an address is only kept and proposed.

import { ApiError } from '../../shared/api'
import type { Mailbox } from '../../shared/types'
import type { Core } from '../core'
import { requireText } from './errors'
import type { ChannelsStore } from './store'

const MAX_ADDRESS = 254

/** A plain address: one @, something on both sides, a dot in the domain. Lower case, because nobody tells addresses apart by case. */
export function parseEmail(input: unknown, what = 'The e-mail address'): string {
  const text = requireText(input, what).toLowerCase()
  if (text.length > MAX_ADDRESS || !/^[^\s@,;<>()[\]\\"]+@[^\s@,;<>()[\]\\"]+\.[^\s@,;<>()[\]\\"]+$/.test(text)) {
    throw new ApiError('invalid_input', `${what} does not look like an e-mail address.`)
  }
  return text
}

/** The part of a platform key that is safe in an address: letters and digits only, "web" reads better as "site". */
const tagOf = (platform: string): string => (platform === 'web' ? 'site' : platform.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'account')

/** `name@host` and a tag give `name+tag@host`; a number after the tag tells the second account of the same kind apart. */
export function aliasOf(base: string, platform: string, n: number): string {
  const at = base.lastIndexOf('@')
  const name = base.slice(0, at).split('+')[0]
  return `${name}+${tagOf(platform)}${n > 1 ? n : ''}${base.slice(at)}`
}

export class MailboxService {
  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore
  ) {}

  list(): Mailbox[] {
    return this.store.listMailboxes()
  }

  add(args: { address: string }): Mailbox {
    const address = parseEmail(args.address, 'The mailbox address')
    if (this.store.listMailboxes().some((m) => m.address === address)) throw new ApiError('duplicate', `${address} is already registered.`)
    const mailbox = this.store.insertMailbox(address)
    this.core.log.info('accounts', `Mailbox ${address} registered. Addresses for accounts can be made from it.`)
    this.core.events.changed('accounts')
    return mailbox
  }

  remove(id: unknown): void {
    const mailbox = this.mailbox(id)
    this.store.deleteMailbox(mailbox.id)
    this.core.log.info('accounts', `Mailbox ${mailbox.address} removed. Addresses already given to accounts stay.`)
    this.core.events.changed('accounts')
  }

  mailbox(id: unknown): Mailbox {
    const wanted = requireText(id, 'The mailbox')
    const found = this.store.listMailboxes().find((m) => m.id === wanted)
    if (!found) throw new ApiError('not_found', 'The mailbox was not found.')
    return found
  }

  /** The first address of the form name+platform[N]@host that no account has yet. */
  proposeEmail(args: { mailboxId: string; platform: string }): { address: string } {
    const mailbox = this.mailbox(args.mailboxId)
    const platform = requireText(args.platform, 'The platform').toLowerCase()
    const taken = new Set(this.core.repos.listAccounts().flatMap((a) => (a.email ? [a.email.toLowerCase()] : [])))
    for (let n = 1; n < 1000; n++) {
      const address = aliasOf(mailbox.address, platform, n)
      if (!taken.has(address)) return { address }
    }
    throw new ApiError('invalid_input', 'No free address could be made from this mailbox.')
  }
}
