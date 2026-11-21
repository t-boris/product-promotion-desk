// The card a post gets in the Feed (owner, 2026-11-21: "like Facebook or Reddit"), rendered to markup because the renderer has no test runner of its own: the head, the
// text cut to five lines, the numbers the site showed, the bar of tools, the menu, and the folded reading of the thread. Listed in tsconfig.web.json beside the other
// render tests.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Finding, FindingCard } from '../shared/types'
import { CardMenuItems } from '../renderer/src/pages/feed/CardMenu'
import { findingRowOf } from '../renderer/src/pages/feed/finding-rows'
import { FindingStream } from '../renderer/src/pages/feed/FindingStream'

// The card opens posts in the account's browser, so it imports the application's transport, which wants the window of the preload script: stubbed before the imports run.
vi.hoisted(() => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
})

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

function card(over: Partial<Finding> = {}): FindingCard {
  return {
    finding: {
      id: 'f1',
      productId: 'p1',
      channelId: 'c1',
      externalId: 't3_f1',
      title: 'Venus in the first house?',
      url: 'https://www.reddit.com/r/beginnerastrology/comments/f1/',
      author: 'u/anna',
      postedAt: '2026-11-14T10:00:00.000Z',
      stage: 'read',
      label: 'notice',
      relation: 'Asks for a chart tool.',
      about: 'The author asks about Taurus rising.',
      thread: '',
      replyTo: '',
      suggestedComment: '',
      firstLook: false,
      opportunityId: null,
      seenAt: null,
      starredAt: null,
      own: false,
      analysis: '',
      topics: [],
      readAt: '2026-11-15T08:30:00.000Z',
      replies: null,
      score: null,
      statsAt: null,
      body: 'I am new to this.',
      bodyAt: '2026-11-15T08:30:00.000Z',
      createdAt: '2026-11-15T08:00:00.000Z',
      ...over
    },
    channelTarget: 'r/beginnerastrology',
    channelPlatform: 'reddit',
    tags: []
  }
}

const stream = (cards: FindingCard[]): string => html(createElement(FindingStream, { rows: cards.map(findingRowOf), markSeen: async () => {}, setStarred: async () => {} }))

describe('the card of a post', () => {
  it('has the head of a feed: the mark of the platform, the community in bold, the author and the platform, then the star and the menu', () => {
    const out = stream([card()])
    expect(out).toContain('class="stream-mark"')
    expect(out).toMatch(/class="stream-mark"[^>]*>r\/</)
    expect(out).toMatch(/data-testid="stream-channel">r\/beginnerastrology</)
    expect(out).toContain('by u/anna')
    expect(out).toContain('data-testid="stream-star"')
    expect(out).toContain('data-testid="stream-menu"')
  })

  it('shows the text of the post itself, and not the AI\'s account of it', () => {
    const out = stream([card({ body: 'My Venus is in the first house.', about: 'The author asks about Taurus rising.' })])
    expect(out).toContain('data-testid="stream-body"')
    expect(out).toContain('My Venus is in the first house.')
    expect(out).not.toContain('data-testid="stream-brief"')
    expect(out).not.toContain('data-testid="stream-body-more"')
  })

  it('cuts a long text to five lines and offers Read more', () => {
    const out = stream([card({ body: 'x'.repeat(2000) })])
    expect(out).toContain('class="stream-body cut"')
    expect(out).toContain('data-testid="stream-body-more"')
    expect(out).toContain('Read more')
  })

  it('shows the AI\'s one-line brief for a post that has no text of its own', () => {
    const out = stream([card({ body: '', bodyAt: '2026-11-15T08:30:00.000Z' })])
    expect(out).toContain('data-testid="stream-brief"')
    expect(out).toContain('The author asks about Taurus rising.')
    expect(out).not.toContain('data-testid="stream-body"')
  })

  it('shows what the site showed: the score and the comments, and nothing for a site that shows none', () => {
    const out = stream([card({ score: 97, replies: 12 })])
    expect(out).toContain('data-testid="stream-score"')
    expect(out).toMatch(/data-testid="stream-score"[^>]*>.*97/)
    expect(out).toMatch(/data-testid="stream-comments"[^>]*>.*12/)
    const none = stream([card()])
    expect(none).not.toContain('data-testid="stream-score"')
    expect(none).not.toContain('data-testid="stream-comments"')
  })

  it('has the owner\'s tools on its bar: Explain, Translate, Reply and Open post', () => {
    const out = stream([card()])
    expect(out).toContain('data-testid="stream-actions"')
    for (const id of ['post-explain', 'post-translate', 'reply-to-post', 'stream-open-post']) expect(out).toContain(`data-testid="${id}"`)
  })

  it('has no Reply on a post the AI has not read, and says so, with the one button to read it', () => {
    const out = stream([card({ about: '', readAt: null })])
    expect(out).not.toContain('data-testid="reply-to-post"')
    expect(out).toContain('data-testid="stream-unread"')
    expect(out.match(/data-testid="stream-check-ai"/g)).toHaveLength(1)
    expect(out).not.toContain('data-testid="stream-reading"')
  })

  it('folds what the AI read of the thread into one line, and puts the thread and the topics in it', () => {
    const out = stream([
      card({
        analysis: 'People recommend free sites. Nobody explained the houses.',
        topics: [{ topic: 'What houses mean', idea: 'A short post on the twelve houses.' }]
      })
    ])
    expect(out).toContain('<details class="stream-reading" data-testid="stream-reading">')
    expect(out).toContain('What people say:')
    expect(out).toMatch(/class="stream-reading-line muted">People recommend free sites\.</)
    // The folded part holds the AI's reading in full.
    expect(out.indexOf('data-testid="stream-insights"')).toBeGreaterThan(out.indexOf('data-testid="stream-reading"'))
    expect(out).toContain('Idea for your post: A short post on the twelve houses.')
    expect(out).toContain('data-testid="stream-thread"')
  })

  it('marks an unread card with the accent edge, a dot and a bold title, and a read card with none of them', () => {
    const unread = stream([card()])
    expect(unread).toContain('data-unseen="true"')
    expect(unread).toContain('data-testid="stream-unread-dot"')
    const read = stream([card({ seenAt: '2026-11-15T09:00:00.000Z' })])
    expect(read).toContain('data-unseen="false"')
    expect(read).not.toContain('data-testid="stream-unread-dot"')
  })

  it('writes the text of the post and of the reading as text, never markup', () => {
    const wild = '<img src=x onerror=alert(1)>'
    const out = stream([card({ body: wild, analysis: wild })])
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('the menu of a card', () => {
  const items = (state: { unread: boolean; aiRead: boolean; checking?: boolean; readOpen?: boolean }): string =>
    html(createElement(CardMenuItems, { state: { checking: false, readOpen: false, ...state }, onToggleRead: () => {}, onCheck: () => {}, onReadPost: () => {} }))

  it('offers Mark as read on an unread card and Mark as unread on a read one', () => {
    const unread = items({ unread: true, aiRead: true })
    expect(unread).toMatch(/data-state="unread"[^>]*>.*Mark as read/)
    const read = items({ unread: false, aiRead: true })
    expect(read).toMatch(/data-state="read"[^>]*>.*Mark as unread/)
  })

  it('offers Check again with AI for a post the AI read, and nothing of the kind for one it has not (the card has its own button)', () => {
    expect(items({ unread: true, aiRead: true })).toContain('Check again with AI')
    expect(items({ unread: true, aiRead: false })).not.toContain('data-testid="stream-check-ai"')
    expect(items({ unread: true, aiRead: true, checking: true })).toMatch(/disabled=""[^>]*data-testid="stream-check-ai"|data-testid="stream-check-ai"[^>]*disabled=""/)
  })

  it('keeps Read the post, and says when it is open', () => {
    expect(items({ unread: true, aiRead: true })).toContain('Read the post')
    expect(items({ unread: true, aiRead: true, readOpen: true })).toMatch(/aria-pressed="true"[^>]*data-testid="post-read"|data-testid="post-read"[^>]*aria-pressed="true"/)
  })
})
