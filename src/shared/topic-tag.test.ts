import { describe, expect, it } from 'vitest'
import { PLATFORM_FORMS } from './post-format'
import { TOPIC_TAG_LIMIT, cleanTopicTag, hasTopicField, topicRuleOf, topicTagProblem } from './topic-tag'

describe('the topic of a post', () => {
  it('is kept without the "#" people write before it, on one line, with single spaces', () => {
    expect(cleanTopicTag('  #Birth   charts ')).toBe('Birth charts')
    expect(cleanTopicTag('## Astrology')).toBe('Astrology')
    expect(cleanTopicTag('Moon\nphases')).toBe('Moon phases')
    expect(cleanTopicTag('C# tips')).toBe('C# tips')
    expect(cleanTopicTag('   ')).toBe('')
    expect(cleanTopicTag('#')).toBe('')
  })

  it('holds 1 to 50 characters and no period or ampersand, as Threads takes it', () => {
    expect(topicTagProblem('Astrology')).toBeNull()
    expect(topicTagProblem('x'.repeat(TOPIC_TAG_LIMIT))).toBeNull()
    expect(topicTagProblem('x'.repeat(TOPIC_TAG_LIMIT + 1))).toMatch(/longer than 50/)
    // Counted by character, so an emoji is one.
    expect(topicTagProblem('🌙'.repeat(TOPIC_TAG_LIMIT))).toBeNull()
    expect(topicTagProblem('Node.js')).toMatch(/period or an ampersand/)
    expect(topicTagProblem('Arts & crafts')).toMatch(/period or an ampersand/)
  })

  it('has a field on Threads and on no other platform of the application', () => {
    expect(hasTopicField('threads')).toBe(true)
    expect(Object.keys(PLATFORM_FORMS).filter(hasTopicField)).toEqual(['threads'])
    expect(hasTopicField('a site nobody listed')).toBe(false)
  })

  it('is asked of the AI that writes a post only where the field exists', () => {
    expect(topicRuleOf('threads')).toMatch(/"topicTag".*at most 50 characters.*no "#", no period and no "&"/)
    expect(topicRuleOf('reddit')).toBeNull()
  })
})
