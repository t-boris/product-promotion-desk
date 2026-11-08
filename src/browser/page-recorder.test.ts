import { describe, expect, it } from 'vitest'
import { PageRecorder, sameSite, targetOf } from './page-recorder'

function setup(host = 'www.facebook.com') {
  const notes: string[] = []
  let now = 1_000_000
  const recorder = new PageRecorder(() => now, () => host, (text) => notes.push(text))
  return { recorder, notes, advance: (ms: number) => void (now += ms) }
}

describe('what is kept of an address', () => {
  it('keeps the host and the path, never the query or the fragment', () => {
    expect(targetOf('https://www.facebook.com/reg/submit/?token=secret&x=1#frag')).toBe('www.facebook.com/reg/submit/')
    expect(targetOf('not a url')).toBe('not a url')
    expect(targetOf(`https://a.test/${'p'.repeat(200)}`).length).toBeLessThanOrEqual('a.test/'.length + 80)
  })

  it('tells one site from another by its last two host labels', () => {
    expect(sameSite('www.facebook.com', 'facebook.com')).toBe(true)
    expect(sameSite('static.xx.fbcdn.net', 'www.facebook.com')).toBe(false)
    expect(sameSite('', 'facebook.com')).toBe(false)
  })
})

describe('page recorder: requests', () => {
  it('keeps what was sent and what failed, and leaves routine reads and sub-resources out', () => {
    const { recorder } = setup()
    recorder.completed({ method: 'GET', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/ok', statusCode: 200 })
    recorder.completed({ method: 'GET', resourceType: 'image', url: 'https://static.xx.fbcdn.net/a.png', statusCode: 404 })
    recorder.completed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/reg/submit/?secret=1', statusCode: 200 })
    recorder.completed({ method: 'GET', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/refused', statusCode: 403 })
    recorder.failed({ method: 'GET', resourceType: 'mainFrame', url: 'https://www.facebook.com/x', error: 'net::ERR_CONNECTION_RESET' })
    expect(recorder.recentRequests()).toEqual([
      { method: 'POST', kind: 'xhr', target: 'www.facebook.com/reg/submit/', status: 200, error: null, count: 1 },
      { method: 'GET', kind: 'xhr', target: 'www.facebook.com/ajax/refused', status: 403, error: null, count: 1 },
      { method: 'GET', kind: 'mainFrame', target: 'www.facebook.com/x', status: null, error: 'net::ERR_CONNECTION_RESET', count: 1 }
    ])
  })

  it('folds a request repeated one after another into a count', () => {
    const { recorder } = setup()
    for (let i = 0; i < 3; i++) recorder.completed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/bz', statusCode: 200 })
    recorder.completed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/other', statusCode: 200 })
    expect(recorder.recentRequests().map((r) => [r.target, r.count])).toEqual([['www.facebook.com/ajax/bz', 3], ['www.facebook.com/ajax/other', 1]])
  })

  it('does not count a cancelled navigation or a cache miss as something a site did', () => {
    const { recorder, notes } = setup()
    recorder.failed({ method: 'GET', resourceType: 'mainFrame', url: 'https://www.facebook.com/', error: 'net::ERR_ABORTED' })
    recorder.failed({ method: 'GET', resourceType: 'xhr', url: 'https://www.facebook.com/', error: 'net::ERR_CACHE_MISS' })
    expect(recorder.recentRequests()).toEqual([])
    expect(notes).toEqual([])
  })

  it('keeps at most the newest requests', () => {
    const { recorder } = setup()
    for (let i = 0; i < 200; i++) recorder.completed({ method: 'POST', resourceType: 'xhr', url: `https://www.facebook.com/p/${i}`, statusCode: 200 })
    expect(recorder.recentRequests(1000)).toHaveLength(120)
    expect(recorder.recentRequests(1)[0].target).toBe('www.facebook.com/p/199')
  })
})

describe('page recorder: log lines', () => {
  it('says once that the site refused a request on the page\'s own site, with the status and not the query', () => {
    const { recorder, notes } = setup()
    recorder.completed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/reg/submit/?a=1', statusCode: 400 })
    expect(notes).toEqual(['POST www.facebook.com/reg/submit/ answered 400 (xhr)'])
  })

  it('says nothing about a refusal on another site (trackers, ads) or about a successful send', () => {
    const { recorder, notes } = setup()
    recorder.completed({ method: 'POST', resourceType: 'xhr', url: 'https://tracker.example.net/p', statusCode: 500 })
    recorder.completed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/ok', statusCode: 200 })
    expect(notes).toEqual([])
  })

  it('holds back a page that keeps failing: one line, then the count in the next line', () => {
    const { recorder, notes, advance } = setup()
    for (let i = 0; i < 5; i++) recorder.failed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/bz', error: 'net::ERR_FAILED' })
    expect(notes).toHaveLength(1)
    advance(11_000)
    recorder.failed({ method: 'POST', resourceType: 'xhr', url: 'https://www.facebook.com/ajax/bz', error: 'net::ERR_FAILED' })
    expect(notes).toHaveLength(2)
    expect(notes[1]).toContain('(4 more failed since the last line)')
  })
})

describe('page recorder: console', () => {
  it('keeps warnings and errors once each, trimmed, and drops the chatter', () => {
    const { recorder } = setup()
    recorder.logged('info', 'hello')
    recorder.logged('error', 'Uncaught TypeError:   x is not a function')
    recorder.logged('error', 'Uncaught TypeError: x is not a function')
    recorder.logged('warning', 'y'.repeat(500))
    recorder.logged('error', '   ')
    expect(recorder.consoleErrors()).toEqual(['Uncaught TypeError: x is not a function', 'y'.repeat(200)])
  })
})
