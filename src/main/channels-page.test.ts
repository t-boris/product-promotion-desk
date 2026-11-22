// The Channels page: the list (rows, search, platform chips, arrow keys) and the add-a-channel flow's rules.

import { describe, expect, it } from 'vitest'
import type { Account, Channel, ChannelSuggestion, PlatformInfo } from '../shared/types'
import { accountsFor, addressLabel, chosenAccount, connectReason, ideasForPlatform, needsSiteProfile, platformChoices, platformLine } from '../renderer/src/pages/channels/add-channel'
import { channelRows, filterRows, neighbour, platformChips, rowLine, shownChannelId } from '../renderer/src/pages/channels/channels-list'

const info = (platform: string, over: Partial<PlatformInfo> = {}): PlatformInfo => ({ connectorId: platform === 'reddit' ? 'reddit' : 'universal', platform, label: platform === 'web' ? 'Other website' : platform[0].toUpperCase() + platform.slice(1), prepared: platform === 'reddit', loginUrl: '', ...over })
const PLATFORMS = [info('instagram'), info('web'), info('reddit', { canJoin: true }), info('telegram'), info('threads')]

const channel = (id: string, platform: string, target: string, over: Partial<Channel> = {}): Channel => ({ id, productId: 'p1', accountId: `a-${platform}`, platform, connectorId: platform, target, url: '', status: 'active', reads: platform === 'reddit', ...over }) as unknown as Channel
const CHANNELS = [
  channel('c1', 'reddit', 'r/astrology'),
  channel('c2', 'reddit', 'r/AskAstrologers'),
  channel('c3', 'reddit', 'r/tarot', { status: 'needs_user' }),
  channel('c4', 'instagram', '@natalmystic'),
  channel('c5', 'threads', '@natalmystic', { status: 'paused' })
]
const WAITING = new Map([['c1', 3], ['c2', 1], ['c4', 2]])

describe('the rows of the list', () => {
  const rows = channelRows(CHANNELS, WAITING, PLATFORMS)

  it('are one for each channel, by platform and then by address, with how many posts wait', () => {
    expect(rows.map((r) => `${r.label}:${r.target}:${r.waiting}`)).toEqual(['Instagram:@natalmystic:2', 'Reddit:r/AskAstrologers:1', 'Reddit:r/astrology:3', 'Reddit:r/tarot:0', 'Threads:@natalmystic:0'])
  })

  it('say what is worth saying beside the platform: a status that is not "working", or that the channel is for the owner\'s own posts', () => {
    const line = (id: string): string => rowLine(rows.find((r) => r.id === id)!)
    expect(line('c1')).toBe('Reddit')
    expect(line('c3')).toBe('Reddit · needs you')
    expect(line('c4')).toBe('Instagram · your own posts')
    expect(line('c5')).toBe('Threads · paused')
  })

  it('do not call a channel the AI watches in the browser "your own posts": it is read, only not by a connector', () => {
    const [watched] = channelRows([channel('c6', 'reddit', 'r/GiftIdeas', { reads: false, watchedInBrowser: true })], new Map(), PLATFORMS)
    expect(rowLine(watched)).toBe('Reddit')
  })

  it('carry the status in words and a tone, for the dot', () => {
    expect(rows.find((r) => r.id === 'c3')).toMatchObject({ statusLabel: 'Needs you', tone: 'warn' })
    expect(rows.find((r) => r.id === 'c5')).toMatchObject({ statusLabel: 'Paused', tone: 'neutral' })
    expect(rows.find((r) => r.id === 'c1')).toMatchObject({ statusLabel: 'Active', tone: 'good' })
  })
})

describe('the search and the platform chips', () => {
  const rows = channelRows(CHANNELS, WAITING, PLATFORMS)

  it('find a channel by a part of its address or its platform, every word of the search having to match, case aside', () => {
    expect(filterRows(rows, null, '').length).toBe(5)
    expect(filterRows(rows, null, 'ASTRO').map((r) => r.id).sort()).toEqual(['c1', 'c2'])
    expect(filterRows(rows, null, 'reddit tarot').map((r) => r.id)).toEqual(['c3'])
    expect(filterRows(rows, null, '  natal   thr ').map((r) => r.id)).toEqual(['c5'])
    expect(filterRows(rows, null, 'nothing like this')).toEqual([])
  })

  it('narrow to the platform chosen on a chip, together with the search', () => {
    expect(filterRows(rows, 'reddit', '').length).toBe(3)
    expect(filterRows(rows, 'reddit', 'tarot').map((r) => r.id)).toEqual(['c3'])
    expect(filterRows(rows, 'instagram', 'tarot')).toEqual([])
  })

  it('count the channels of each platform, the largest first, after "All"', () => {
    expect(platformChips(rows)).toEqual([
      { key: null, label: 'All', count: 5 },
      { key: 'reddit', label: 'Reddit', count: 3 },
      { key: 'instagram', label: 'Instagram', count: 1 },
      { key: 'threads', label: 'Threads', count: 1 }
    ])
    expect(platformChips([])).toEqual([{ key: null, label: 'All', count: 0 }])
  })
})

describe('which channel is shown', () => {
  const rows = channelRows(CHANNELS, WAITING, PLATFORMS)
  it('is the one the address names even when the search hides it, else the first of the list, else none', () => {
    const visible = filterRows(rows, 'reddit', '')
    expect(shownChannelId(visible, rows, 'c4')).toBe('c4')
    expect(shownChannelId(visible, rows, null)).toBe(visible[0].id)
    expect(shownChannelId([], rows, null)).toBeNull()
    expect(shownChannelId(visible, rows, 'gone')).toBeNull()
  })

  it('moves with the arrow keys, stays at the ends, and starts at the first when nothing is shown', () => {
    expect(neighbour(rows, 'c2', 1)).toBe('c1')
    expect(neighbour(rows, 'c2', -1)).toBe(rows[0].id)
    expect(neighbour(rows, rows[0].id, -1)).toBe(rows[0].id)
    expect(neighbour(rows, rows[rows.length - 1].id, 1)).toBe(rows[rows.length - 1].id)
    expect(neighbour(rows, null, 1)).toBe(rows[0].id)
    expect(neighbour([], 'c1', 1)).toBeNull()
  })
})

describe('what each platform says it does', () => {
  it('names what the application does there in one line', () => {
    expect(platformLine(info('reddit', { canJoin: true }))).toBe('Reads communities, can join them')
    expect(platformLine(info('web'))).toBe('Needs a site profile first')
    expect(platformLine(info('telegram'))).toBe('A channel or group you run')
    expect(platformLine(info('instagram'))).toBe('Your own posts, in your account')
  })

  it('are offered the application reads first, then the named ones by name, and "Other website" last', () => {
    expect(platformChoices(PLATFORMS).map((p) => p.platform)).toEqual(['reddit', 'instagram', 'telegram', 'threads', 'web'])
  })
})

describe('the account of the flow', () => {
  const account = (id: string, platform: string, productId: string | null = null): Account => ({ id, platform, productId, label: id }) as unknown as Account
  const accounts = [account('r-mine', 'reddit', 'p1'), account('r-other', 'reddit', 'p2'), account('r-used', 'reddit', 'p3'), account('i1', 'instagram')]
  const channels = [channel('c9', 'reddit', 'r/x', { accountId: 'r-used' })]

  it('are the ones of the chosen platform alone, the product\'s own before the rest', () => {
    const reddit = accountsFor('reddit', accounts, 'p1', channels)
    expect(reddit.mine.map((a) => a.id)).toEqual(['r-mine', 'r-used'])
    expect(reddit.others.map((a) => a.id)).toEqual(['r-other'])
    expect(accountsFor('instagram', accounts, 'p1', channels)).toEqual({ mine: [], others: [accounts[3]] })
    expect(accountsFor('telegram', accounts, 'p1', channels)).toEqual({ mine: [], others: [] })
    expect(accountsFor(null, accounts, 'p1', channels)).toEqual({ mine: [], others: [] })
  })

  it('choose the one asked for while it serves the platform, else the first', () => {
    const reddit = accountsFor('reddit', accounts, 'p1', channels)
    expect(chosenAccount(reddit, 'r-other')?.id).toBe('r-other')
    expect(chosenAccount(reddit, 'i1')?.id).toBe('r-mine')
    expect(chosenAccount(reddit, null)?.id).toBe('r-mine')
    expect(chosenAccount({ mine: [], others: [] }, 'r-mine')).toBeUndefined()
  })
})

describe('why Connect channel is off', () => {
  it('says what is missing, in the order the steps are', () => {
    expect(connectReason({ platformLabel: null, hasAccount: false, target: '' })).toBe('Choose where the channel is first.')
    expect(connectReason({ platformLabel: 'Reddit', hasAccount: false, target: 'r/x' })).toBe('Add an account for Reddit first.')
    expect(connectReason({ platformLabel: 'Reddit', hasAccount: true, target: '  ' })).toBe('Type the address of the channel.')
    expect(connectReason({ platformLabel: 'Reddit', hasAccount: true, target: 'r/x' })).toBeNull()
  })

  it('asks for a community on Reddit and an address elsewhere', () => {
    expect(addressLabel(info('reddit'))).toBe('Community')
    expect(addressLabel(info('instagram'))).toBe('Address')
    expect(addressLabel(undefined)).toBe('Address')
  })
})

describe('the ideas of the flow', () => {
  const idea = (platform: string, target: string): ChannelSuggestion => ({ platform, target, reason: 'fits' })
  it('are those of the platform chosen, an idea for "other" belonging to Other website', () => {
    const ideas = [idea('reddit', 'r/a'), idea('instagram', '@b'), idea('other', 'https://forum.example.com')]
    expect(ideasForPlatform(ideas, PLATFORMS[2], PLATFORMS).map((i) => i.target)).toEqual(['r/a'])
    expect(ideasForPlatform(ideas, PLATFORMS[1], PLATFORMS).map((i) => i.target)).toEqual(['https://forum.example.com'])
    expect(ideasForPlatform(ideas, undefined, PLATFORMS)).toEqual([])
  })
})

describe('the site profile', () => {
  it('is offered for another website that is given as a web address, and for no named platform', () => {
    expect(needsSiteProfile(info('web'), 'https://forum.example.com/board')).toBe(true)
    expect(needsSiteProfile(info('web'), 'forum.example.com')).toBe(false)
    expect(needsSiteProfile(info('web'), '')).toBe(false)
    expect(needsSiteProfile(info('instagram'), 'https://www.instagram.com/brand/')).toBe(false)
    expect(needsSiteProfile(info('reddit'), 'https://www.reddit.com/r/astrology/')).toBe(false)
    expect(needsSiteProfile(undefined, 'https://example.com')).toBe(false)
  })
})
