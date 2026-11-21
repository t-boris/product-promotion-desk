// REQ-004: the pure rules the quick-post AI helps share: how long a caption the AI writes for a platform, and which of several chosen platforms it writes for.

import { describe, expect, it } from 'vitest'
import { QUICK_CAPTION_CEILING, captionLimit, quickTrendsSubject, strictestPlatform } from './quick-ai'

describe('captionLimit', () => {
  it('is the platform\'s own limit, and never more than the ceiling of a quick post', () => {
    expect(captionLimit('instagram')).toBe(2200)
    expect(captionLimit('threads')).toBe(500)
    // Facebook takes 63 thousand characters; a quick post is a few lines
    expect(captionLimit('facebook')).toBe(QUICK_CAPTION_CEILING)
    expect(QUICK_CAPTION_CEILING).toBe(2200)
  })

  it('is the ceiling for a platform that has no limit, or is not listed', () => {
    expect(captionLimit('somewhere')).toBe(QUICK_CAPTION_CEILING)
  })
})

describe('strictestPlatform', () => {
  it('is the platform that takes the least, so that one caption fits every channel chosen', () => {
    expect(strictestPlatform(['instagram', 'threads', 'facebook'])).toBe('threads')
    expect(strictestPlatform(['facebook', 'instagram'])).toBe('facebook')
  })

  it('is the first of equals, the only one, and nothing for nothing', () => {
    expect(strictestPlatform(['instagram', 'facebook'])).toBe('instagram')
    expect(strictestPlatform(['threads'])).toBe('threads')
    expect(strictestPlatform([])).toBeNull()
  })
})

describe('quickTrendsSubject', () => {
  it('names the search of one channel, so that the progress panel shows only its own', () => {
    expect(quickTrendsSubject('ch1')).toBe('quick-trends:ch1')
    expect(quickTrendsSubject('ch1')).not.toBe(quickTrendsSubject('ch2'))
  })
})
