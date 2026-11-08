// Base mailboxes and the e-mail address of each account (DEC-015, REQ-014).

import { describe, expect, it } from 'vitest'
import { aliasOf, parseEmail } from './mailboxes'
import { makeReadyWorld, makeWorld } from './test-helpers'

describe('addresses', () => {
  it.each([
    ['Boris@Example.com ', 'boris@example.com'],
    ['a.b+c@mail.example.org', 'a.b+c@mail.example.org']
  ])('accepts %s', (input, expected) => {
    expect(parseEmail(input)).toBe(expected)
  })

  it.each(['', '   ', 'boris', 'boris@', '@example.com', 'boris@example', 'a b@example.com', 'a@b@example.com', 'a@example.com, b@example.com', '<a@example.com>', 'x'.repeat(250) + '@example.com'])('refuses "%s"', (input) => {
    expect(() => parseEmail(input)).toThrow(/e-mail address/)
  })

  it('makes an alias of a base address: name+platform@host, a number tells a second one apart', () => {
    expect(aliasOf('boris@gmail.com', 'reddit', 1)).toBe('boris+reddit@gmail.com')
    expect(aliasOf('boris@gmail.com', 'reddit', 2)).toBe('boris+reddit2@gmail.com')
    expect(aliasOf('boris+old@gmail.com', 'web', 1)).toBe('boris+site@gmail.com')
    expect(aliasOf('boris@gmail.com', 'Hacker News!', 1)).toBe('boris+hackernews@gmail.com')
  })
})

describe('base mailboxes', () => {
  it('registers, lists and removes a mailbox, and refuses a duplicate in any case', async () => {
    const w = makeWorld()
    const mailbox = await w.call('mailboxes.add', { address: 'Boris@Gmail.com' })
    expect(mailbox).toMatchObject({ address: 'boris@gmail.com', kind: 'existing' })
    expect(await w.call('mailboxes.list', undefined)).toEqual([mailbox])
    expect(await w.refusal('mailboxes.add', { address: 'boris@gmail.com' })).toBe('duplicate')
    expect(await w.refusal('mailboxes.add', { address: 'nonsense' })).toBe('invalid_input')
    await w.call('mailboxes.remove', { id: mailbox.id })
    expect(await w.call('mailboxes.list', undefined)).toEqual([])
    expect(await w.refusal('mailboxes.remove', { id: mailbox.id })).toBe('not_found')
  })

  it('proposes a different address for every account, never one already in use', async () => {
    const w = await makeReadyWorld()
    const mailbox = await w.call('mailboxes.add', { address: 'boris@gmail.com' })
    const first = await w.call('accounts.proposeEmail', { mailboxId: mailbox.id, platform: 'reddit' })
    expect(first.address).toBe('boris+reddit@gmail.com')
    await w.call('accounts.setEmail', { accountId: w.account.id, email: first.address, mailboxId: mailbox.id })
    expect((await w.call('accounts.proposeEmail', { mailboxId: mailbox.id, platform: 'reddit' })).address).toBe('boris+reddit2@gmail.com')
    expect((await w.call('accounts.proposeEmail', { mailboxId: mailbox.id, platform: 'instagram' })).address).toBe('boris+instagram@gmail.com')
    expect(await w.refusal('accounts.proposeEmail', { mailboxId: 'nope', platform: 'reddit' })).toBe('not_found')
  })

  it('removing a mailbox keeps the addresses already given to accounts', async () => {
    const w = await makeReadyWorld()
    const mailbox = await w.call('mailboxes.add', { address: 'boris@gmail.com' })
    await w.call('accounts.setEmail', { accountId: w.account.id, email: 'boris+reddit@gmail.com', mailboxId: mailbox.id })
    await w.call('mailboxes.remove', { id: mailbox.id })
    expect(w.core.repos.account(w.account.id)).toMatchObject({ email: 'boris+reddit@gmail.com', mailboxId: null })
  })
})

describe('the e-mail address of an account', () => {
  it('is set, changed and cleared, logged without any secret, and announced', async () => {
    const w = await makeReadyWorld()
    w.changes.length = 0
    expect((await w.call('accounts.setEmail', { accountId: w.account.id, email: ' Bot@Example.com ' })).email).toBe('bot@example.com')
    expect(w.changes).toContain('accounts')
    expect((await w.call('accounts.setEmail', { accountId: w.account.id, email: null })).email).toBeNull()
    expect(w.core.log.list(20).filter((e) => e.source === 'accounts').map((e) => e.message)).toEqual(
      expect.arrayContaining(['E-mail of Natal Mystic Reddit set to bot@example.com.', 'E-mail of Natal Mystic Reddit cleared.'])
    )
  })

  it('says nothing when nothing changes', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.setEmail', { accountId: w.account.id, email: 'bot@example.com' })
    w.changes.length = 0
    const before = w.core.log.list(50).length
    await w.call('accounts.setEmail', { accountId: w.account.id, email: 'BOT@example.com' })
    expect(w.changes).not.toContain('accounts')
    expect(w.core.log.list(50).length).toBe(before)
  })

  it('can be given when the account is created', async () => {
    const w = makeWorld()
    const mailbox = await w.call('mailboxes.add', { address: 'boris@gmail.com' })
    const account = await w.call('accounts.create', { platform: 'fake', label: 'With address', email: 'boris+fake@gmail.com', mailboxId: mailbox.id })
    expect(account).toMatchObject({ email: 'boris+fake@gmail.com', mailboxId: mailbox.id, productId: null })
  })

  it('refuses an unusable address, an unknown mailbox and an unknown account without changing anything', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('accounts.setEmail', { accountId: w.account.id, email: 'nope' })).toBe('invalid_input')
    expect(await w.refusal('accounts.setEmail', { accountId: w.account.id, email: 'a@example.com', mailboxId: 'nope' })).toBe('not_found')
    expect(await w.refusal('accounts.setEmail', { accountId: 'nope', email: 'a@example.com' })).toBe('not_found')
    expect(await w.refusal('accounts.create', { platform: 'fake', label: 'X', email: 'nope' })).toBe('invalid_input')
    expect(w.core.repos.account(w.account.id).email).toBeNull()
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
  })
})
