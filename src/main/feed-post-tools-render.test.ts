// The tools of a post of the Feed (Explain, Read the post, Translate), the tags on the cards and the Tags tab of the analysis card, rendered to markup (the
// renderer has no test runner of its own). What the AI wrote, and what a stranger wrote, is text and never markup; every number of a tag is the application's;
// nothing here sends or posts.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Finding, FindingAssist, FindingCard, FindingComment, FindingTranslation, TagStat } from '../shared/types'
import { FeedAnalysisCard } from '../renderer/src/pages/feed/FeedAnalysisCard'
import { FindingStream, TagChips } from '../renderer/src/pages/feed/FindingStream'
import { findingRowOf } from '../renderer/src/pages/feed/finding-rows'
import { AssistPanel, BodyPanel, Explanation, PostToolsRow, TranslationLine } from '../renderer/src/pages/feed/PostTools'
import { openingMove } from '../renderer/src/pages/feed/reply-composer'
import { TagRow, TagsPanel } from '../renderer/src/pages/feed/TagsPanel'

// The stream imports the application's transport, which wants the window of the preload script: stubbed before the imports run.
vi.hoisted(() => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
})

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

function finding(over: Partial<Finding> = {}, tags: string[] = []): FindingCard {
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
      about: 'A beginner asks which app draws a chart with houses.',
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
      body: 'I am new to this.\n\nWhich app do you trust?',
      bodyAt: '2026-11-15T08:30:00.000Z',
      createdAt: '2026-11-15T08:00:00.000Z',
      ...over
    },
    channelTarget: 'r/astrology',
    channelPlatform: 'reddit',
    tags: tags.map((name) => ({ id: `tag-${name}`, name }))
  }
}

const stream = (cards: FindingCard[], picked: string[] = []): string => html(createElement(FindingStream, { rows: cards.map(findingRowOf), markSeen: async () => {}, setStarred: async () => {}, tags: picked, onTag: () => {} }))

describe('the tags on a post', () => {
  it('shows each tag as a button, the ones the owner picked pressed', () => {
    const out = stream([finding({}, ['houses', 'chart apps'])], ['houses'])
    expect(out).toContain('data-testid="stream-tags"')
    expect(out.match(/data-testid="stream-tag"/g)).toHaveLength(2)
    expect(out).toMatch(/aria-pressed="true"[^>]*data-testid="stream-tag"[^>]*data-tag="houses"|data-tag="houses"[^>]*aria-pressed="true"/)
    expect(out).toMatch(/tag-chip on"[^>]*aria-pressed="true"/)
    expect(out).toMatch(/class="tag-chip"[^>]*aria-pressed="false"/)
  })

  it('shows nothing for a post that has no tags', () => {
    expect(stream([finding()])).not.toContain('stream-tags')
    expect(html(createElement(TagChips, { tags: [], picked: [], onTag: () => {} }))).toBe('')
  })

  it('writes a tag as text, never markup', () => {
    const out = stream([finding({}, ['<img src=x onerror=alert(1)>'])])
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('the tools of a post', () => {
  it('are Explain and Translate on the bar of the card with one language list, Russian first and chosen until the owner chooses another; Read the post is in its menu', () => {
    const out = stream([finding()])
    expect(out).toContain('data-testid="post-tools"')
    for (const id of ['post-explain', 'post-translate', 'post-language']) expect(out).toContain(`data-testid="${id}"`)
    expect(out).toContain('Explain')
    // "Read the post" is an entry of the card's menu (closed here), not a button of the bar.
    expect(out).not.toContain('data-testid="post-read"')
    expect(out).toMatch(/data-testid="post-translate"[^>]*>Translate</)
    const options = [...out.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])
    expect(options).toEqual(['Russian', 'English', 'Ukrainian', 'Spanish', 'German', 'French', 'Portuguese', 'Italian', 'Turkish', 'Polish'])
    expect(out).toMatch(/<option value="Russian" selected/)
    // a panel is open only when the owner opens it
    expect(out).not.toContain('data-testid="post-assist"')
    expect(out).not.toContain('data-testid="post-body-panel"')
  })

  it('offers the translation back and forth: Translate, Show translation, Translate again, Show original', () => {
    const tool = (translation: FindingTranslation | null, translated: boolean, translating = false): string =>
      html(createElement(PostToolsRow, { panel: null, onPanel: () => {}, language: 'Russian', onLanguage: () => {}, translation, translated, onTranslate: () => {}, onShowOriginal: () => {}, translating }))
    const made: FindingTranslation = { language: 'Russian', title: 'T', body: '', comments: [], at: '2026-11-21T08:00:00.000Z', stale: false }
    expect(tool(null, false)).toMatch(/data-testid="post-translate"[^>]*>Translate</)
    expect(tool(made, false)).toMatch(/data-testid="post-translate"[^>]*>Show translation</)
    expect(tool({ ...made, stale: true }, false)).toMatch(/data-testid="post-translate"[^>]*>Translate again</)
    expect(tool(made, true)).toMatch(/data-testid="post-translate"[^>]*>Show original</)
    const busy = tool(null, false, true)
    expect(busy).toContain('Translating…')
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*data-testid="post-translate"|data-testid="post-translate"[^>]*disabled=""/)
  })

  it('presses the panel that is open', () => {
    const tool = (panel: 'explain' | 'read' | null): string =>
      html(createElement(PostToolsRow, { panel, onPanel: () => {}, language: 'Russian', onLanguage: () => {}, translation: null, translated: false, onTranslate: () => {}, onShowOriginal: () => {}, translating: false }))
    expect(tool('explain')).toMatch(/aria-pressed="true"[^>]*data-testid="post-explain"|data-testid="post-explain"[^>]*aria-pressed="true"/)
    expect(tool('read')).toMatch(/aria-pressed="true"[^>]*data-testid="post-read"|data-testid="post-read"[^>]*aria-pressed="true"/)
    expect(tool(null)).not.toContain('aria-pressed="true"')
  })

  it('says the AI translated it, and offers the original, only while the owner reads the translation', () => {
    const made: FindingTranslation = { language: 'German', title: 'T', body: '', comments: [], at: '2026-11-21T08:00:00.000Z', stale: false }
    const line = (translation: FindingTranslation | null, translated: boolean): string => html(createElement(TranslationLine, { translation, translated, onShowOriginal: () => {} }))
    expect(line(made, true)).toContain('Translated into German by the AI.')
    expect(line(made, true)).toContain('Show original')
    expect(line({ ...made, stale: true }, true)).toContain('before it changed')
    expect(line(made, false)).toBe('')
    expect(line(null, true)).toBe('')
  })
})

describe('the text of a post', () => {
  const panel = (over: Partial<Finding> = {}, translation: FindingTranslation | null = null, translated = false): string => {
    const card = finding(over).finding
    return html(createElement(BodyPanel, { finding: card, translation, translated, onRead: () => {}, reading: false }))
  }

  it("shows the post's own text, a paragraph each, as text", () => {
    const out = panel()
    expect(out).toContain('data-state="text"')
    expect(out).toContain('<p>I am new to this.</p>')
    expect(out).toContain('<p>Which app do you trust?</p>')
    const wild = panel({ body: '<script>alert(1)</script>' })
    expect(wild).not.toContain('<script')
    expect(wild).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('shows the translated text while the owner reads the translation', () => {
    const made: FindingTranslation = { language: 'Russian', title: 'T', body: 'Я новичок.\n\nКакому приложению вы доверяете?', comments: [], at: '2026-11-21T08:00:00.000Z', stale: false }
    expect(panel({}, made, true)).toContain('<p>Я новичок.</p>')
    expect(panel({}, made, false)).toContain('<p>I am new to this.</p>')
  })

  it('says a post has no text of its own once its page was read, without offering to read it again', () => {
    const out = panel({ body: '', bodyAt: '2026-11-15T08:30:00.000Z' })
    expect(out).toContain('data-state="none"')
    expect(out).toContain('no text of its own')
    expect(out).not.toContain('post-body-read')
  })

  it('offers to read a post whose text was never read', () => {
    const out = panel({ body: '', bodyAt: null })
    expect(out).toContain('data-state="unread"')
    expect(out).toContain('Let the AI read it')
    expect(out).toContain('only reads')
  })
})

describe('the explanation of a post', () => {
  const source = { url: 'https://example.org/houses', title: 'What houses are', fact: 'Houses divide the chart into twelve parts.' }
  const assist = (over: Partial<FindingAssist> = {}): FindingAssist => ({
    language: 'Russian',
    about: 'A beginner asks which app draws a chart.',
    wants: 'A tool that is free and shows houses.',
    interesting: ['They already know their sun sign.', 'They ask for houses, not for a reading.'],
    right: [{ point: 'Free tools do exist.', basis: 'facts' }],
    wrong: [{ point: 'Houses are not a feature of every app.', basis: 'practice' }],
    noJudgement: '',
    answers: [
      { angle: 'Name two free tools', why: 'It answers the question.', place: null },
      { angle: 'Explain what houses are first', why: 'The person may not know.', place: 1 }
    ],
    sources: [source],
    followUps: [{ question: 'Is it free?', reply: 'Yes, with limits.', sources: [], at: '2026-11-21T09:00:00.000Z' }],
    at: '2026-11-21T08:00:00.000Z',
    stale: false,
    ...over
  })
  const comments = [{ position: 1, author: 'bob', text: 'Try a free site.', depth: 0, url: '' }] as FindingComment[]
  const body = (over: Partial<FindingAssist> = {}): string => html(createElement(Explanation, { assist: assist(over), comments, author: 'poster', onWrite: () => {} }))

  it('has the parts the owner asked for: what it is about, what the person wants, what is worth noticing, where they are right and wrong, what could be answered', () => {
    const out = body()
    for (const id of ['post-assist-about', 'post-assist-wants', 'post-assist-interesting', 'post-assist-right', 'post-assist-wrong', 'post-assist-answers']) expect(out).toContain(`data-testid="${id}"`)
    for (const words of ['What it is about', 'What the person wants', 'What is worth noticing', 'Where the person is right', 'Where the person is wrong', 'What could be answered']) expect(out).toContain(words)
    expect(out).toContain('A beginner asks which app draws a chart.')
    expect(out).toContain('They already know their sun sign.')
  })

  it('says what each judgement stands on: facts or practice', () => {
    const out = body()
    expect(out).toContain('by facts')
    expect(out).toContain('by practice')
  })

  it('offers "Write a reply from this" for each angle, and says whom it would answer', () => {
    const out = body()
    expect(out.match(/Write a reply from this/g)).toHaveLength(2)
    expect(out).toContain('to the post by poster')
    expect(out).toContain("to bob&#x27;s comment")
  })

  it('shows what the AI found on the web, and what the owner asked afterwards', () => {
    const out = body()
    expect(out).toContain('data-testid="ai-found"')
    expect(out).toContain('What houses are')
    expect(out).toContain('data-testid="post-assist-followup"')
    expect(out).toContain('Is it free?')
    expect(out).toContain('Yes, with limits.')
    expect(body({ sources: [], followUps: [] })).not.toContain('ai-found')
    expect(body({ followUps: [] })).not.toContain('post-assist-followups')
  })

  it('says a post makes no claim to judge instead of leaving the place empty, and only then', () => {
    const none = body({ right: [], wrong: [], noJudgement: 'It is a question: there is nothing to judge.' })
    expect(none).toContain('data-testid="post-assist-nojudgement"')
    expect(none).toContain('nothing to judge')
    expect(none).not.toContain('Where the person is right')
    expect(body()).not.toContain('post-assist-nojudgement')
  })

  it('writes what the AI wrote as text, never markup, and says in whose name and in what language', () => {
    const wild = '<img src=x onerror=alert(1)>'
    const out = body({ about: wild, interesting: [wild], answers: [{ angle: wild, why: wild, place: null }] })
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).toContain('Explained by the AI in Russian')
    expect(out).toContain('with 1 page from the web')
  })

  it('opens as a panel that is the AI\'s, with the button that makes it, and no sending of anything', () => {
    const out = html(createElement(AssistPanel, { finding: finding().finding, comments, language: 'German', onWrite: () => {} }))
    expect(out).toContain('data-testid="post-assist"')
    expect(out).toContain('Explained by the AI')
    expect(out).toContain('Explain in German')
    expect(out).not.toContain('post-assist-question')
    expect(out).not.toContain('Send')
  })
})

describe('what the reply window does when it opens', () => {
  it('asks with the wish it was opened with, whatever the place holds', () => {
    expect(openingMove({ initialWish: ' Write the reply from this angle: X ', kept: true, stored: 'old' })).toEqual({ move: 'ask', wish: 'Write the reply from this angle: X' })
    expect(openingMove({ initialWish: 'X', kept: false, stored: null })).toEqual({ move: 'ask', wish: 'X' })
  })

  it('without a wish: leaves a text it kept, shows what the place holds, or asks for a first text', () => {
    expect(openingMove({ initialWish: '', kept: true, stored: 'old' })).toEqual({ move: 'nothing' })
    expect(openingMove({ initialWish: '  ', kept: false, stored: 'planned' })).toEqual({ move: 'show', text: 'planned' })
    expect(openingMove({ initialWish: '', kept: false, stored: null })).toEqual({ move: 'ask', wish: '' })
  })
})

describe('the Tags tab of the analysis card', () => {
  const tag = (over: Partial<TagStat> = {}): TagStat => ({
    id: 't1',
    name: 'houses',
    posts: 3,
    before: 1,
    replies: 42,
    score: 1300,
    known: 2,
    daily: Array.from({ length: 30 }, (_, i) => (i === 29 ? 2 : i === 3 ? 1 : 0)),
    ...over
  })
  const row = (over: Partial<TagStat> = {}, picked = false, compared = true): string => html(createElement(TagRow, { tag: tag(over), rank: 1, widest: 3, compared, picked, onTag: () => {} }))

  it('offers Themes and Tags on the card, Themes first and chosen', () => {
    const out = html(createElement(FeedAnalysisCard, { productId: 'p1', channelId: null, onFocus: () => {}, pickedTags: [], onTag: () => {} }))
    expect(out).toContain('data-testid="feed-analysis-tab-themes"')
    expect(out).toContain('data-testid="feed-analysis-tab-tags"')
    expect(out).toMatch(/segmented-option on[^>]*>[\s\S]*?Themes/)
    expect(out).toContain('Analyze the feed')
    expect(out).not.toContain('data-testid="feed-tags"')
  })

  it('ranks a tag with its numbers counted by the application, a bar and a picture of the last thirty days', () => {
    const out = row()
    expect(out).toContain('data-testid="feed-tag"')
    expect(out).toMatch(/feed-theme-rank[^>]*>1</)
    expect(out).toContain('3 posts (+2 against before) · 42 comments · score 1,300 · known for 2 of 3 posts')
    expect(out).toContain('feed-theme-bar')
    expect(out).toContain('data-testid="feed-tag-spark"')
    expect(out).toContain('data-testid="sparkline"')
    expect(out).toContain('houses: 3 posts in the last 30 days, at most 2 in one day')
  })

  it('writes no number a site did not show, and no comparison when there is nothing to compare with', () => {
    const out = row({ replies: null, score: null, known: 0, before: 0 }, false, false)
    expect(out).toContain('3 posts')
    expect(out).not.toContain('comments')
    expect(out).not.toContain('score')
    expect(out).not.toContain('against before')
    expect(out).not.toContain('(new)')
  })

  it('is a button that narrows the stream, pressed while it is picked', () => {
    expect(row()).toMatch(/class="tag-chip"[^>]*aria-pressed="false"/)
    expect(row({}, true)).toMatch(/class="tag-chip on"[^>]*aria-pressed="true"/)
    expect(row()).toContain('Show only the posts with this tag')
  })

  it('writes the name of a tag as text', () => {
    const out = row({ name: '<script>alert(1)</script>' })
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
  })

  it('has the button that tags the posts, and says who counts what', () => {
    const out = html(createElement(TagsPanel, { productId: 'p1', channelId: null, days: 7, all: false, setAll: () => {}, picked: [], onTag: () => {} }))
    expect(out).toContain('data-testid="feed-tags"')
    expect(out).toContain('Tag the posts')
    expect(out).toContain('counted by the application')
    expect(out).toContain('The AI names the tags')
  })
})
