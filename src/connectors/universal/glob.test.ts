import { describe, expect, it } from 'vitest'
import { globToRegExp, hostBelongsTo, matchGlob, matchesAnyGlob } from './glob'

describe('URL globs', () => {
  it('matches a segment wildcard, captures, and an optional trailing slash', () => {
    expect(matchGlob('https://forum.example.com/c/*', 'https://forum.example.com/c/news')).toEqual({})
    expect(matchGlob('https://forum.example.com/c/*', 'https://forum.example.com/c/news/')).toEqual({})
    expect(matchGlob('https://forum.example.com/c/*', 'https://forum.example.com/c/news/extra')).toBeNull()
    expect(matchGlob('https://forum.example.com/t/{id}', 'https://forum.example.com/t/42?x=1')).toBeNull()
    expect(matchGlob('https://forum.example.com/t/{id}', 'https://forum.example.com/t/42')).toEqual({ id: '42' })
    expect(matchGlob('https://forum.example.com/**', 'https://forum.example.com/a/b/c')).toEqual({})
  })

  it('ignores the fragment of the address being matched', () => {
    expect(matchGlob('https://forum.example.com/t/{id}', 'https://forum.example.com/t/42#reply-3')).toEqual({ id: '42' })
  })

  it('treats regex syntax literally, so a profile cannot smuggle in a catastrophic pattern', () => {
    const glob = 'https://forum.example.com/t/(a+)+$'
    const started = Date.now()
    expect(matchGlob(glob, `https://forum.example.com/t/${'a'.repeat(40)}!`)).toBeNull()
    expect(Date.now() - started).toBeLessThan(200)
    expect(globToRegExp(glob).source).toContain('\\(a\\+\\)\\+\\$')
  })

  it('matches any of several patterns and checks host membership', () => {
    expect(matchesAnyGlob(['https://a.example.com/*', 'https://b.example.com/*'], 'https://b.example.com/x')).toBe(true)
    expect(hostBelongsTo('eu.forum.example.com', 'forum.example.com')).toBe(true)
    expect(hostBelongsTo('forum.example.com.evil.org', 'forum.example.com')).toBe(false)
    expect(hostBelongsTo('notforum.example.com', 'forum.example.com')).toBe(false)
  })
})
