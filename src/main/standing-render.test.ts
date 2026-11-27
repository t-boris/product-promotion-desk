// A post that one community took down while another kept it up (owner, 2026-11-23: the group said Removed, both communities said Sent): the
// community that removed it says so in the list and on its card, with the community's own words and until when the post is looked at. Rendered to
// markup because the renderer has no test runner of its own; listed in tsconfig.web.json beside the other render tests.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { STANDING_WINDOW_MS } from '../shared/standing'
import type { OpportunityCard, PostGroupCard, SendAction } from '../shared/types'
import { buildPostRows } from '../renderer/src/pages/posts/posts-filter'
import { PostsList } from '../renderer/src/pages/posts/PostsList'
import { ReviewIdentity } from '../renderer/src/pages/review/ReviewParts'
import { StandingNote } from '../renderer/src/pages/review/StandingNote'

// The list's thumbnails and the card's parts import the application's transport, which wants the window of the preload script.
vi.hoisted(() => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
})

const SENT = '2026-11-22T20:08:04.544Z'
const AUTOMOD =
  'ALL POSTS ARE INSTANTLY REMOVED INTO A QUEUE TO AWAIT MOD APPROVAL (allow 24 hours)\nRead our [Rules Post](https://www.reddit.com/r/AskAstrologers/comments/1r974nm/rules_please_read/) at the top of our page in Highlights before posting! This Automod message is not our full rules.\n* Charts (required): Use astro-seek.com and the WHOLE SIGN house system.'

function action(over: Partial<SendAction> = {}): SendAction {
  return {
    id: 'a1',
    opportunityId: 'o1',
    draftId: 'd1',
    approvalId: 'ap1',
    contentHash: 'h',
    accountId: 'acc',
    destination: 'r/x',
    state: 'confirmed',
    attemptedAt: SENT,
    completedAt: SENT,
    resultUrl: 'https://www.reddit.com/r/AskAstrologers/comments/1y2ymii/sun/',
    resultExternalId: 't3_1y2ymii',
    authorizationBasis: 'user approval',
    knowledgeVersionId: null,
    error: null,
    standing: 'removed',
    standingNote: 'A moderator of r/AskAstrologers or its bot took it down; the moderators can still approve it.',
    standingCheckedAt: SENT,
    standingNotice: { by: 'AutoModerator', text: AUTOMOD },
    numbers: null,
    ...over
  }
}

function card(id: string, target: string, last: SendAction | null): OpportunityCard {
  return {
    opportunity: { id, channelId: `c-${id}`, productId: 'p1', kind: 'standalone', source: 'comment', state: 'confirmed', scheduledAt: null, groupId: 'g1', updatedAt: SENT, decision: null, category: null },
    channelTarget: target,
    channelPlatform: 'reddit',
    accountLabel: 'Boris Velnarov - Reddit (boris_chart_notebook)',
    draft: { title: 'Sun in Sagittarius in the ninth house, with Neptune close by', text: 'Text', attachments: [] },
    lastAction: last
  } as unknown as OpportunityCard
}

const kept = card('b', 'r/beginnerastrology', action({ id: 'a2', standing: 'live', standingNote: 'The post is up on Reddit.', standingNotice: null }))
const removed = card('a', 'r/AskAstrologers', action())
const group: PostGroupCard = {
  group: { id: 'g1', productId: 'p1', master: { title: null, text: 'Master', link: null, attachments: [], markup: 'markdown' }, createdAt: SENT },
  versions: [kept, removed].map((c) => ({ card: c, problems: [], edited: false }))
} as unknown as PostGroupCard

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
const lines = (markup: string): string[] => [...markup.matchAll(/data-testid="post-version">(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

describe('a group that one community took down', () => {
  it('says Removed on the line of that community, and Sent on the line of the one that kept it', () => {
    const rows = buildPostRows([], [group])
    const markup = html(createElement(PostsList, { rows, selectedId: 'g1', onSelect: () => {} }))
    expect(lines(markup)).toEqual(['r/beginnerastrology Sent', 'r/AskAstrologers Removed'])
    expect(markup).toContain('posts-version-state bad">Removed')
  })

  it('gives the card of that community a Removed badge instead of Sent, and leaves the other one Sent', () => {
    expect(html(createElement(ReviewIdentity, { card: removed }))).toMatch(/>Removed</)
    expect(html(createElement(ReviewIdentity, { card: removed }))).not.toMatch(/>Sent</)
    expect(html(createElement(ReviewIdentity, { card: kept }))).toMatch(/>Sent</)
  })
})

describe("what the owner reads under a removed post", () => {
  it("says who took it down, what the community's bot wrote (the start, plain, with Show all) and until when it is looked at", () => {
    const markup = html(createElement(StandingNote, { action: action(), nowMs: Date.parse(SENT) + 60_000 }))
    expect(markup).toContain('A moderator of r/AskAstrologers or its bot took it down; the moderators can still approve it.')
    expect(markup).toContain('The community&#x27;s bot wrote under the post:')
    expect(markup).toContain('ALL POSTS ARE INSTANTLY REMOVED INTO A QUEUE TO AWAIT MOD APPROVAL (allow 24 hours) Read our Rules Post')
    expect(markup).not.toContain('](')
    expect(markup).toContain('Show all')
    expect(markup).toMatch(/Looked at until [A-Z][a-z]{2} \d{1,2}\. If a moderator approves it, you will be told\./)
  })

  it('says only why when the community wrote nothing, and that the looking has ended once the three days are over', () => {
    const markup = html(createElement(StandingNote, { action: action({ standingNotice: null }), nowMs: Date.parse(SENT) + STANDING_WINDOW_MS }))
    expect(markup).not.toContain('wrote under the post')
    expect(markup).toMatch(/It was looked at until .+ and is no longer followed\./)
  })
})
