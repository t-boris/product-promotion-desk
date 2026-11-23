import { describe, expect, it } from 'vitest'
import { NOTICE_EXCERPT, STANDING_WINDOW_MS, isTakenDown, noticeAuthor, noticeExcerpt, noticeText, watchWords, watchedUntil } from './standing'

const SENT = '2026-11-22T20:08:04.544Z'

describe('a confirmed post as the site shows it later', () => {
  it('is taken down only when it was sent and the look found it removed', () => {
    expect(isTakenDown('confirmed', { standing: 'removed' })).toBe(true)
    expect(isTakenDown('confirmed', { standing: 'live' })).toBe(false)
    expect(isTakenDown('confirmed', { standing: null })).toBe(false)
    expect(isTakenDown('confirmed', null)).toBe(false)
    expect(isTakenDown('cancelled', { standing: 'removed' })).toBe(false)
  })

  it('is looked at for three days after it was published', () => {
    expect(watchedUntil({ completedAt: SENT })).toBe(new Date(Date.parse(SENT) + STANDING_WINDOW_MS).toISOString())
    expect(watchedUntil({ completedAt: null })).toBeNull()
    expect(watchedUntil({ completedAt: 'not a time' })).toBeNull()
  })

  it('says until when it is looked at and what the owner will hear, then that it is no longer followed', () => {
    const until = Date.parse(SENT) + STANDING_WINDOW_MS
    expect(watchWords({ completedAt: SENT }, until - 1)).toMatch(/^Looked at until .+\. If a moderator approves it, you will be told\.$/)
    expect(watchWords({ completedAt: SENT }, until)).toMatch(/^It was looked at until .+ and is no longer followed\.$/)
    expect(watchWords({ completedAt: null }, until)).toBeNull()
  })
})

describe("the community's words under a removed post", () => {
  const AUTOMOD =
    'ALL POSTS ARE INSTANTLY REMOVED INTO A QUEUE TO AWAIT MOD APPROVAL (allow 24 hours)\nRead our [Rules Post](https://www.reddit.com/r/AskAstrologers/comments/1r974nm/rules_please_read/) first.\n* Charts (required): Use astro-seek.com.\n* State one very specific question in your title.'

  it("names the community's bot as such and a moderator by name", () => {
    expect(noticeAuthor({ by: 'AutoModerator', text: '' })).toBe("The community's bot")
    expect(noticeAuthor({ by: 'mod_a', text: '' })).toBe('The moderator u/mod_a')
  })

  it('reads the Markdown as plain text: a link as its words, a list as bullets', () => {
    const text = noticeText({ by: 'AutoModerator', text: AUTOMOD })
    expect(text).toContain('Read our Rules Post (https://www.reddit.com/r/AskAstrologers/comments/1r974nm/rules_please_read/) first.')
    expect(text).toContain('• Charts (required): Use astro-seek.com.')
    expect(text).not.toContain('](')
  })

  it('shows the start of a long message cut at a word, and a short one whole', () => {
    const long = noticeExcerpt(noticeText({ by: 'AutoModerator', text: AUTOMOD }))
    expect(long.cut).toBe(true)
    expect(long.text.length).toBeLessThanOrEqual(NOTICE_EXCERPT + 1)
    expect(long.text.endsWith('…')).toBe(true)
    expect(long.text.startsWith('ALL POSTS ARE INSTANTLY REMOVED INTO A QUEUE')).toBe(true)
    expect(noticeExcerpt('Removed: rule 2.')).toEqual({ text: 'Removed: rule 2.', cut: false })
    // A short message on several lines is shown on one line, so "Show all" has its lines to show.
    expect(noticeExcerpt('Removed.\nSee rule 2.')).toEqual({ text: 'Removed. See rule 2.', cut: true })
  })
})
