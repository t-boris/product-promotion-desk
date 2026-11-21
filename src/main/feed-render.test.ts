// The Feed's finding rows, the finding detail and the per-channel watching lines are rendered to markup here (the renderer has no test
// runner of its own): what the AI wrote is text and never markup, a notice offers nothing to approve or send, a link only opens a web
// address, and the lists look the same for a row of either kind. Times depend on the machine's zone, so none is asserted.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Channel, FeedAnalysisView, Finding, FindingCard, FindingComment, OpportunityCard } from '../shared/types'
import { FeedList } from '../renderer/src/pages/feed/FeedList'
import { FindingDetail } from '../renderer/src/pages/feed/FindingDetail'
import { FindingStream } from '../renderer/src/pages/feed/FindingStream'
import { AnalysisBody, FeedAnalysisCard } from '../renderer/src/pages/feed/FeedAnalysisCard'
import { ReplyComposer } from '../renderer/src/pages/feed/ReplyComposer'
import { ThreadTree } from '../renderer/src/pages/feed/FindingThread'
import { ReadingNotes } from '../renderer/src/pages/feed/ReadingNotes'
import { BROWSER_WATCH_NOTE, OWN_POSTS_NO_CHECK } from '../renderer/src/pages/channels/own-posts'
import { buildFeedRows } from '../renderer/src/pages/feed/feed-filter'
import { findingRowOf } from '../renderer/src/pages/feed/finding-rows'
import { SegmentedControl } from '../renderer/src/ui'

// The finding pane opens a post in the account's browser, so it imports the application's transport, which wants the window of the preload script: stubbed before the imports run.
vi.hoisted(() => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
})

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
const NOW = new Date('2026-11-15T12:00:00.000Z')

function finding(over: Partial<Finding> = {}): FindingCard {
  return {
    finding: {
      id: 'f1',
      productId: 'p1',
      channelId: 'c1',
      externalId: 't3_f1',
      title: 'Best birth chart apps?',
      url: 'https://www.reddit.com/r/astrology/comments/f1/',
      author: 'poster',
      postedAt: '2026-11-14T10:00:00.000Z',
      stage: 'read',
      label: 'notice',
      relation: 'Asks for tools like ours.',
      about: '',
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
      readAt: null,
      replies: null,
      score: null,
      statsAt: null,
      createdAt: '2026-11-15T08:00:00.000Z',
      ...over
    },
    channelTarget: 'r/astrology',
    channelPlatform: 'reddit'
  }
}

const detail = (over: Partial<Finding> = {}): string => html(createElement(FindingDetail, { row: findingRowOf(finding(over)) }))

describe('FindingDetail', () => {
  it('shows the post, the channel and the AI\'s note, and how far the AI looked', () => {
    const out = detail()
    expect(out).toContain('data-testid="finding-detail"')
    expect(out).toContain('Best birth chart apps?')
    expect(out).toContain('r/astrology')
    expect(out).toContain('Reddit')
    expect(out).toContain('by poster')
    expect(out).toContain('Asks for tools like ours.')
    expect(out).toContain('The AI’s note on how it relates to your goal')
    expect(out).toContain('Opened and read by the AI')
    expect(out).toContain('Noted')
  })

  it('says a post judged by its title was judged by its title', () => {
    expect(detail({ stage: 'title', label: 'skip' })).toContain('Judged by its title')
    expect(detail({ stage: 'title', label: 'skip' })).toContain('Judged not relevant')
  })

  it('writes what the AI and the page wrote as text: markup in it is shown, never run', () => {
    const wild = '<img src=x onerror=alert(1)><script>alert(2)</script>'
    const out = detail({ title: wild, relation: wild, author: wild })
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('onerror=alert(1)>')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })

  it('says the AI gave no reason, and that a post has no title, rather than leave a gap', () => {
    const out = detail({ relation: '   ', title: '  ' })
    expect(out).toContain('The AI gave no reason.')
    expect(out).toContain('Untitled post')
  })

  it('offers nothing to approve, save or send: its only action is the link to the post', () => {
    const out = detail()
    expect(out).not.toContain('<button')
    expect(out).not.toContain('<textarea')
    expect(out).not.toMatch(/Approve|Send|Save|Skip|Reject/)
    expect(out).toContain('A notice has nothing to send. Star it to find it again, or answer it from here.')
    expect(out.match(/<a /g)).toHaveLength(1)
  })

  it('opens the post in the app\'s own browser, never in the system\'s: no "_blank" link', () => {
    expect(detail()).not.toContain('target="_blank"')
    expect(detail()).toContain('<a class="btn" href="https://www.reddit.com/r/astrology/comments/f1/" rel="noreferrer" data-testid="finding-open-post" aria-busy="false">Open post</a>')
  })

  it('shows nothing of a thread for a post nobody read, and the post, the thread, whom to answer and the comment for one the AI read', () => {
    expect(detail()).not.toContain('finding-read')
    const out = detail({ about: 'Asks which app draws a chart with houses.', thread: 'Two people suggest apps; nobody explains houses.', replyTo: 'The author: the question is still open.', suggestedComment: 'Houses depend on the birth time.\n\nTry a free chart first.' })
    expect(out).toContain('data-testid="finding-about"')
    expect(out).toContain('Asks which app draws a chart with houses.')
    expect(out).toContain('Two people suggest apps; nobody explains houses.')
    expect(out).toContain('The author: the question is still open.')
    expect(out).toContain('Houses depend on the birth time.')
    expect(out).toContain('data-testid="finding-comment-copy"')
    // nothing posts or sends from here: the only buttons are the copy of the text and the opening of the post
    expect(out).not.toMatch(/Approve|Send|Post it|Reject/)
  })

  it('shows the comments of a thread under the post, each as plain text and indented by its depth, and nothing for an empty thread', () => {
    expect(html(createElement(ThreadTree, { comments: [] }))).toBe('')
    const out = html(
      createElement(ThreadTree, {
        comments: [
          { position: 0, depth: 0, author: 'anna', text: 'Try a free chart', url: '' },
          { position: 1, depth: 1, author: '', text: '<img src=x onerror=alert(1)>', url: '' }
        ]
      })
    )
    expect(out).toContain('data-testid="finding-thread-list"')
    expect(out).toContain('anna')
    expect(out).toContain('Try a free chart')
    expect(out).toContain('Someone')
    expect(out).toContain('data-depth="1"')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('shows the AI\'s words as text, never as markup', () => {
    const out = detail({ about: '<img src=x onerror=alert(1)>', thread: '<b>bold</b>', replyTo: '<script>x</script>', suggestedComment: '<a href="https://evil.example">x</a>' })
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<b>')
    expect(out).not.toContain('href="https://evil.example"')
  })

  it('opens only a web address: any other address is not a link', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', '', 'not an address']) {
      const out = detail({ url })
      expect(out).not.toContain('href=')
      expect(out).not.toContain('Open post')
      expect(out).toContain('No address for this post.')
    }
  })

  it('tags a post found by the first look, and only that one', () => {
    expect(detail({ firstLook: true })).toContain('First look')
    expect(detail({ firstLook: true })).toContain('by the first look at this channel')
    expect(detail({ firstLook: false })).not.toContain('First look')
  })

  it('says when the time of the post is not known', () => {
    expect(detail({ postedAt: null })).toContain('Posting time unknown')
    expect(detail()).toContain('Posted ')
  })
})

describe('FeedList with findings', () => {
  const rows = new Map([
    ['f1', findingRowOf(finding({ id: 'f1', firstLook: true }))],
    ['f2', findingRowOf(finding({ id: 'f2', seenAt: '2026-11-15T09:00:00.000Z', title: '<b>Mod announcement</b>', relation: '<i>not about us</i>' }))]
  ])
  const days = [{ day: '2026-11-14', label: 'Yesterday', ids: ['f1', 'f2'] }]
  const out = html(createElement(FeedList, { days, rows, selectedId: 'f1', onSelect: () => undefined, label: 'Noted posts', now: NOW }))

  it('is a listbox of options named for what it holds, grouped under the day', () => {
    expect(out).toContain('role="listbox"')
    expect(out).toContain('aria-label="Noted posts"')
    expect(out).toContain('aria-label="Yesterday"')
    expect(out.match(/role="option"/g)).toHaveLength(2)
  })

  it('marks the selected row, and only it, as selected and in the tab order', () => {
    expect(out).toMatch(/aria-selected="true" tabindex="0" class="inbox-row feed-row finding-row selected unseen" data-testid="finding-row-f1"/)
    expect(out).toMatch(/aria-selected="false" tabindex="-1" class="inbox-row feed-row finding-row" data-testid="finding-row-f2"/)
  })

  it('shows a row\'s channel, how long ago the post was written, its title and the AI\'s line', () => {
    expect(out).toContain('r/astrology')
    expect(out).toContain('1 d ago')
    expect(out).toContain('Best birth chart apps?')
    expect(out).toContain('Asks for tools like ours.')
  })

  it('says a post not seen yet is not seen, in words and in a bold title, and a seen one is quiet', () => {
    expect(out).toContain('<span class="sr-only">Not seen yet. </span><strong>Best birth chart apps?</strong>')
    expect(out).toContain('data-unseen="true"')
    expect(out).toContain('data-unseen="false"')
    expect(out).not.toContain('<strong>&lt;b&gt;Mod announcement')
  })

  it('tags only the post the first look found', () => {
    expect(out.match(/First look/g)).toHaveLength(1)
    expect(out.indexOf('First look')).toBeLessThan(out.indexOf('data-testid="finding-row-f2"'))
  })

  it('writes a title and a line that are markup as text', () => {
    expect(out).not.toContain('<b>')
    expect(out).not.toContain('<i>')
    expect(out).toContain('&lt;b&gt;Mod announcement&lt;/b&gt;')
    expect(out).toContain('&lt;i&gt;not about us&lt;/i&gt;')
  })

  it('keeps the list of opportunities as it was: the same list shows their rows', () => {
    const opportunity = {
      opportunity: { id: 'o1', channelId: 'c1', productId: 'p1', kind: 'reply', source: 'new_post', state: 'draft', createdAt: '2026-11-14T10:00:00.000Z', updatedAt: '2026-11-14T10:00:00.000Z' },
      channelTarget: 'r/astrology',
      comment: null,
      discussion: { author: 'poster', title: 'A post', body: '' },
      draft: { text: 'A reply' },
      lastAction: null
    } as unknown as OpportunityCard
    const [row] = buildFeedRows([opportunity])
    const opportunities = html(createElement(FeedList, { days: [{ day: '2026-11-14', label: 'Yesterday', ids: ['o1'] }], rows: new Map([['o1', row]]), selectedId: 'o1', onSelect: () => undefined }))
    expect(opportunities).toContain('aria-label="Items in the feed"')
    expect(opportunities).toContain('data-testid="feed-row-o1"')
    expect(opportunities).toContain('New post · Reply drafted')
    expect(opportunities).not.toContain('finding-row')
  })
})

describe('the Noted tab\'s count', () => {
  it('sits in the tab\'s label beside its words', () => {
    const out = html(
      createElement(SegmentedControl<'decide' | 'noted'>, {
        label: 'State',
        name: 'feed-state',
        testIdPrefix: 'feed-state-',
        value: 'noted',
        onChange: () => undefined,
        options: [
          { value: 'decide', label: 'To decide 4' },
          { value: 'noted', label: createElement('span', null, 'Noted 7', createElement('span', { className: 'count neutral' }, '3')) }
        ]
      })
    )
    expect(out).toContain('To decide 4')
    expect(out).toContain('Noted 7<span class="count neutral">3</span>')
    expect(out).toContain('data-testid="feed-state-noted"')
  })
})

describe('ReadingNotes: the channels\' own watching lines', () => {
  const channel = (id: string, over: Partial<Channel> = {}): Channel =>
    ({
      id,
      target: `r/${id}`,
      reads: true,
      watchedInBrowser: false,
      status: 'active',
      statusDetail: '',
      lastRunAt: '2026-11-15T09:05:00.000Z',
      nextCheckAt: '2026-11-15T13:12:00.000Z',
      settings: { checkIntervalMin: 180 },
      capabilities: [],
      ...over
    }) as unknown as Channel
  const context = { now: NOW, automationPaused: false, offsetAt: () => 60 }
  const notes = (channels: Channel[], watching: typeof context | null, channelId: string | null = null): string => html(createElement(ReadingNotes, { channels, source: 'all', channelId, watching }))

  it('gives each channel its own line when the product has several, folded under "Each channel"', () => {
    const out = notes([channel('alpha'), channel('beta', { status: 'paused' })], context)
    expect(out).toContain('Each channel')
    expect(out).toContain('data-testid="feed-watching-alpha"')
    expect(out).toContain('<strong>r/alpha</strong> · Watching every ~3 h · last 10:05 · next ≈14:12')
    expect(out).toContain('<strong>r/beta</strong> · Not watching: this channel is paused')
    expect(out).toContain('<details class="more">')
    expect(out).not.toContain('<details class="more" open')
  })

  it('says the same for the channel chosen, alone', () => {
    const out = notes([channel('alpha'), channel('beta')], context, 'beta')
    expect(out).toContain('feed-watching-beta')
    expect(out).not.toContain('feed-watching-alpha')
  })

  it('says nothing of one channel: the header line of the Feed is its line', () => {
    expect(notes([channel('alpha')], context)).toBe('')
    expect(notes([channel('alpha'), channel('own', { reads: false })], context)).not.toContain('feed-watching-')
  })

  it('says nothing until the application has said whether automation is paused', () => {
    expect(notes([channel('alpha'), channel('beta')], null)).toBe('')
  })

  it('says paused automation in each channel\'s line', () => {
    const out = notes([channel('alpha'), channel('beta')], { ...context, automationPaused: true })
    expect(out.match(/Not watching: automation is paused/g)).toHaveLength(2)
  })
  describe('a channel the AI watches in the browser (DEC-042)', () => {
    const insta = (over: Partial<Channel> = {}): Channel => channel('insta', { target: '@brand', reads: false, watchedInBrowser: true, ...over })
    const unread = (): Channel => channel('own', { target: '@own', reads: false })

    it('says in one quiet sentence that the AI watches it like a person, and replies to nothing', () => {
      const out = notes([insta()], context)
      expect(out).toContain('data-testid="feed-browser-watch"')
      expect(out).toContain(BROWSER_WATCH_NOTE)
      expect(out).toContain('Needs an AI engine that can work the browser (Claude Code or Codex).')
      // It is not one the app does not read.
      expect(out).not.toContain('feed-unread')
      expect(out).not.toContain('own-posts-no-check')
      expect(out).not.toContain('Not read by the app')
    })

    it('says it before the application has said whether automation is paused: the sentence does not depend on it', () => {
      expect(notes([insta()], null)).toContain(BROWSER_WATCH_NOTE)
    })

    it('lists it under "Each channel" beside a channel a connector reads, with "in the browser" in its line', () => {
      const out = notes([channel('alpha'), insta()], context)
      expect(out).toContain('Each channel')
      expect(out).toContain('<strong>r/alpha</strong> · Watching every ~3 h · last 10:05 · next ≈14:12')
      expect(out).toContain('<strong>@brand</strong> · Watching every ~3 h in the browser · last 10:05 · next ≈14:12')
      expect(out).toContain(BROWSER_WATCH_NOTE)
    })

    it('says the usual reason in its line when it is not watched', () => {
      expect(notes([channel('alpha'), insta({ status: 'paused' })], context)).toContain('<strong>@brand</strong> · Not watching: this channel is paused')
      expect(notes([channel('alpha'), insta()], { ...context, automationPaused: true })).toContain('<strong>@brand</strong> · Not watching: automation is paused')
    })

    it('lists two browser channels under "Each channel", and only the channel that is chosen when one is', () => {
      const two = [insta(), insta({ id: 'threads', target: '@brand_threads' })]
      expect(notes(two, context)).toContain('feed-watching-threads')
      const chosen = notes(two, context, 'threads')
      expect(chosen).toContain('feed-watching-threads')
      expect(chosen).not.toContain('feed-watching-insta')
      expect(chosen).toContain(BROWSER_WATCH_NOTE)
    })

    it('names a channel that is neither read nor watched as before, and not the one the AI watches', () => {
      const out = notes([insta(), unread()], context)
      expect(out).toContain('Not read by the app: @own.')
      expect(out).not.toContain('@brand.')
      expect(out).toContain(BROWSER_WATCH_NOTE)
      // One watched channel is not several: no list.
      expect(out).not.toContain('Each channel')
    })

    it('tells the chosen channel\'s own story: watched, or not read', () => {
      const both = [insta(), unread()]
      const watched = notes(both, context, 'insta')
      expect(watched).toContain(BROWSER_WATCH_NOTE)
      expect(watched).not.toContain('own-posts-no-check')
      const left = notes(both, context, 'own')
      expect(left).toContain('data-testid="own-posts-no-check"')
      expect(left).toContain(`${OWN_POSTS_NO_CHECK}</p>`)
      expect(left).not.toContain(BROWSER_WATCH_NOTE)
    })

    it('says nothing of it when the product has none, and names a channel a connector reads by nothing', () => {
      expect(notes([channel('alpha'), unread()], context)).not.toContain('feed-browser-watch')
      expect(notes([channel('alpha')], context)).toBe('')
    })

    it('does not report the abilities of a channel without a connector as a reading problem', () => {
      const withCapabilities = insta({ capabilities: [{ key: 'read_posts', status: 'unavailable', detail: 'No connector.', checkedAt: null }] })
      expect(notes([withCapabilities], context)).not.toContain('feed-reading-problems')
    })
  })
})

describe('FindingStream: the Noted posts as cards', () => {
  const stream = (cards: FindingCard[]): string =>
    html(createElement(FindingStream, { rows: cards.map(findingRowOf), markSeen: async () => {}, setStarred: async () => {} }))

  it('puts a star on every post: empty while the post is not starred, filled and pressed when it is', () => {
    const plain = stream([finding()])
    expect(plain).toContain('data-testid="stream-star"')
    expect(plain).toContain('aria-pressed="false"')
    expect(plain).toContain('aria-label="Star this post"')
    const starred = stream([finding({ starredAt: '2026-11-15T09:00:00.000Z' })])
    expect(starred).toContain('aria-pressed="true"')
    expect(starred).toContain('aria-label="Take the star off this post"')
  })

  it('says the AI would answer a post it called worth a reply, and says nothing of it for a post it only noted', () => {
    expect(stream([finding({ relation: 'Worth a reply: asks for a tool like ours.' })])).toContain('The AI would answer it')
    expect(stream([finding({ relation: 'Relates to the goal.' })])).not.toContain('The AI would answer it')
  })

  it('marks the account\'s own post, and only that one', () => {
    const out = stream([finding({ id: 'own', own: true }), finding({ id: 'other' })])
    expect(out.match(/data-own="true"/g)).toHaveLength(1)
    expect(out.match(/Your post/g)).toHaveLength(1)
  })

  it('has no Worth a reply list of its own: the card names the feed Noted posts', () => {
    expect(stream([finding()])).toContain('aria-label="Noted posts"')
  })

  it('has a Check with AI button on every post: a post not read in full says so, and the button asks to read it', () => {
    const unread = stream([finding()])
    expect(unread).toContain('data-testid="stream-check-ai"')
    expect(unread).toContain('Check with AI')
    expect(unread).toContain('data-testid="stream-unread"')
    expect(unread).toContain('has not read this post in full yet')
    expect(unread).not.toContain('Check again with AI')
    expect(unread).not.toContain('data-testid="stream-insights"')
  })

  it('shows what the AI read: what the thread says and the topics it raises, each with an idea for the owner\'s own post, as text', () => {
    const out = stream([
      finding({
        about: 'The author asks for a chart tool.',
        thread: 'Two people name apps.',
        analysis: 'People recommend free sites. <b>Nobody</b> explained the houses.',
        topics: [
          { topic: 'What houses mean', idea: 'A short post on the twelve houses.' },
          { topic: 'Free chart sites', idea: '' }
        ],
        readAt: '2026-11-15T09:00:00.000Z'
      })
    ])
    expect(out).toContain('data-testid="stream-analysis"')
    expect(out).toContain('What the thread says')
    expect(out).toContain('People recommend free sites. &lt;b&gt;Nobody&lt;/b&gt; explained the houses.')
    expect(out).not.toContain('<b>Nobody</b>')
    expect(out.match(/data-testid="stream-topic"/g)).toHaveLength(2)
    expect(out).toContain('Idea for your post: A short post on the twelve houses.')
    expect(out.match(/Idea for your post/g)).toHaveLength(1)
    expect(out).toContain('Check again with AI')
    expect(out).not.toContain('data-testid="stream-unread"')
  })

  it('shows no analysis block for a post read with nothing to say about it', () => {
    expect(stream([finding({ about: 'It asks.', thread: 'Nothing.', readAt: '2026-11-15T09:00:00.000Z' })])).not.toContain('data-testid="stream-insights"')
  })
})

describe('ReplyComposer: Send under a post', () => {
  const composer = (place: 'post' | number, comments: FindingComment[] = []): string =>
    html(createElement(ReplyComposer, { finding: finding({ about: 'It asks.', readAt: '2026-11-15T09:00:00.000Z' }).finding, place, comments, onClose: () => {} }))

  it('has a primary Send button next to Copy', () => {
    const out = composer('post')
    expect(out).toContain('data-testid="reply-send"')
    expect(out).toMatch(/data-testid="reply-send"[^>]*btn-primary/)
    expect(out).toContain('data-testid="reply-copy"')
  })

  it('keeps Send shut while there is no text, and says why', () => {
    const out = composer('post')
    expect(out).toMatch(/disabled=""\s+data-testid="reply-send"/)
    expect(out).toContain('Write the comment first.')
  })

  it('shows no result and no "is it there" question before anything was sent', () => {
    const out = composer(0, [{ position: 0, depth: 0, author: 'anna', text: 'Try a free chart site', url: 'https://www.reddit.com/r/x/comments/1/comment/2' }])
    expect(out).not.toContain('data-testid="reply-send-result"')
    expect(out).not.toContain('data-testid="reply-resolve"')
  })
})

describe('the card of the analysis of the Feed', () => {
  const theme = (over: Partial<FeedAnalysisView['themes'][number]> = {}): FeedAnalysisView['themes'][number] => ({
    id: 't1',
    name: 'What the houses mean',
    summary: 'People ask which house rules what.',
    idea: 'A short explainer of the twelve houses.',
    postIds: ['a', 'b', 'c'],
    posts: 3,
    before: 1,
    replies: 42,
    score: 1300,
    known: 3,
    mostAnswered: true,
    mostPopular: false,
    growing: true,
    fading: false,
    ...over
  })
  const view = (over: Partial<FeedAnalysisView> = {}): FeedAnalysisView => ({
    days: 7,
    channelId: null,
    at: '2026-11-15T09:00:00.000Z',
    summary: 'People ask how to read a chart.',
    themes: [theme(), theme({ id: 't2', name: 'Which app to use', postIds: ['d'], posts: 1, before: 0, replies: null, score: null, known: 0, mostAnswered: false, growing: false })],
    questions: [{ postId: 'd', title: 'Which app?', channel: 'r/astrology', question: 'Does any free app show the houses?' }],
    posts: 4,
    readInFull: 1,
    other: 0,
    total: 4,
    stale: false,
    compared: true,
    ...over
  })
  const body = (v: FeedAnalysisView, stale = false, all = false): string => html(createElement(AnalysisBody, { view: v, stale, all, setAll: () => {}, onFocus: () => {} }))

  it('offers to analyze, and says what it does, before any analysis was made', () => {
    const out = html(createElement(FeedAnalysisCard, { productId: 'p1', channelId: null, onFocus: () => {} }))
    expect(out).toContain('data-testid="feed-analysis"')
    expect(out).toContain('What is going on in your channels')
    expect(out).toContain('Analyze the feed')
    expect(out).toMatch(/data-testid="feed-analysis-run"[^>]*btn-primary|btn-primary[^>]*data-testid="feed-analysis-run"/)
    expect(out).toContain('uses no browser and posts nothing')
    expect(out).not.toContain('data-testid="feed-themes"')
  })

  it('names the channel when it is about one', () => {
    const out = html(createElement(FeedAnalysisCard, { productId: 'p1', channelId: 'c1', onFocus: () => {} }))
    expect(out).toContain('What is going on in this channel')
  })

  it('offers the three periods, the week chosen', () => {
    const out = html(createElement(FeedAnalysisCard, { productId: 'p1', channelId: null, onFocus: () => {} }))
    for (const label of ['24 hours', '7 days', '30 days']) expect(out).toContain(label)
    expect(out).toMatch(/segmented-option on[^>]*>[\s\S]*?7 days/)
  })

  it('lists the themes with their numbers, what stands out and a way to the posts', () => {
    const out = body(view())
    expect(out).toContain('People ask how to read a chart.')
    expect(out).toContain('What the houses mean')
    expect(out).toContain('3 posts (+2 against before) · 42 comments · score 1,300')
    expect(out).toContain('Most answered')
    expect(out).toContain('Growing')
    expect(out).toContain('Idea for your post: A short explainer of the twelve houses.')
    expect(out).toContain('Show these posts (3)')
    expect(out).toContain('1 post (new)')
    expect(out).not.toContain('1 post (new) ·')
  })

  it('writes no comparison, and marks nothing as growing, when there was no period before to compare with', () => {
    const out = body(view({ compared: false }))
    expect(out).toContain('3 posts · 42 comments · score 1,300')
    expect(out).not.toContain('against before')
    expect(out).not.toContain('(new)')
  })

  it('says what it was made from and when', () => {
    const out = body(view())
    expect(out).toContain('4 posts analyzed · 1 read in full')
    expect(out).toMatch(/Made [^<]*·/)
  })

  it('lists the questions nobody answered, each with the post it came from', () => {
    const out = body(view())
    expect(out).toContain('Questions nobody answered (1)')
    expect(out).toContain('Does any free app show the houses?')
    expect(out).toContain('r/astrology · Which app?')
    expect(out).toContain('Show the post')
    expect(body(view({ questions: [] }))).not.toContain('Questions nobody answered')
  })

  it('says when posts came since, and only then', () => {
    expect(body(view(), true)).toContain('Posts were noted or read since this was made')
    expect(body(view(), false)).not.toContain('Posts were noted or read since')
  })

  it('lists four themes and offers the rest', () => {
    const many = Array.from({ length: 6 }, (_, i) => theme({ id: `t${i}`, name: `Theme ${i}` }))
    const short = body(view({ themes: many }))
    expect(short.match(/data-testid="feed-theme"/g)).toHaveLength(4)
    expect(short).toContain('Show all 6 themes')
    expect(body(view({ themes: many }), false, true).match(/data-testid="feed-theme"/g)).toHaveLength(6)
    expect(body(view({ themes: many.slice(0, 3) }))).not.toContain('Show all')
  })

  it('shows what the AI wrote as text, never as markup', () => {
    const out = body(view({ summary: '<img src=x onerror=alert(1)>', themes: [theme({ name: '<script>alert(1)</script>', summary: '<b>bold</b>', idea: '<a href="https://evil.test">x</a>' })] }))
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<img src=x')
    expect(out).not.toContain('<a href="https://evil.test">')
    expect(out).toContain('&lt;script&gt;')
  })

  it('says for how many posts the numbers are known, when it is some of them', () => {
    expect(body(view({ themes: [theme({ known: 2 })] }))).toContain('Comments and score known for 2 of 3 posts.')
    expect(body(view({ themes: [theme({ known: 3 })] }))).not.toContain('Comments and score known for')
  })
})
