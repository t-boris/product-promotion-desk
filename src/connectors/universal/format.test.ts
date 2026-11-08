import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { describeProfileFormat, summarizeProfile } from './format'
import { LIMITS, SELECTOR_PLACEHOLDERS, STEP_TYPES, VALUE_PLACEHOLDERS } from './profile'
import { UniversalConnector } from './connector'
import { validProfileDefinition } from './test-helpers'
import { ALLOWED_ATTRIBUTES_TEXT, validateProfile } from './validate'

describe('the format description given to the AI', () => {
  const text = describeProfileFormat()

  it('names every field the validator accepts at the top level and in readers, flows, steps and verification', () => {
    const fields = [
      'schema', 'name', 'host', 'channelUrls', 'discussionUrls', 'loginUrl', 'login', 'discussions', 'comments', 'ownContent', 'publish', 'metrics', 'rulesUrl', 'rulesSelector',
      'loggedInSelector', 'identitySelector', 'captchaSelector',
      'containerSelector', 'itemSelector', 'id', 'title', 'author', 'body', 'permalink', 'time', 'parentId',
      'steps', 'verify', 'urlGlob', 'textIncludes', 'errorSelector', 'timeoutMs', 'key', 'label', 'selector', 'attr'
    ]
    for (const field of fields) expect(text, field).toContain(field)
  })

  it('states the limits the validator enforces, from the same constants', () => {
    for (const value of [LIMITS.maxBytes, LIMITS.maxDepth, LIMITS.maxSteps, LIMITS.maxUrlPatterns, LIMITS.maxMetrics, LIMITS.maxString, LIMITS.maxSelector, LIMITS.maxName]) {
      expect(text).toContain(String(value))
    }
  })

  it('lists only the step types and placeholders that exist', () => {
    for (const type of STEP_TYPES) expect(text).toContain(`"type":"${type}"`)
    for (const name of VALUE_PLACEHOLDERS) expect(text).toContain(`{{${name}}}`)
    expect(SELECTOR_PLACEHOLDERS.every((name) => text.includes(`{{${name}}}`))).toBe(true)
  })

  it('tells the AI that code is forbidden, and the validator really rejects what it says is rejected', () => {
    expect(text).toMatch(/Never include code/)
    expect(text).toMatch(/Unknown fields are rejected/)
    const withScript = validProfileDefinition({ onclick: 'x' })
    expect(validateProfile(withScript).valid).toBe(false)
    const withUnknownStep = validProfileDefinition()
    ;(withUnknownStep.publish as { post: { steps: unknown[] } }).post.steps.unshift({ type: 'evaluate', selector: 'x' })
    expect(validateProfile(withUnknownStep).valid).toBe(false)
  })

  it('describes the allowed attributes exactly as the validator accepts them', () => {
    const readerWith = (attr: string) => validProfileDefinition({ discussions: { ...(validProfileDefinition().discussions as object), permalink: { selector: 'a', attr } } })
    for (const attr of ['href', 'id', 'datetime', 'content', 'title', 'value', 'src', 'alt', 'data-id', 'aria-label']) expect(validateProfile(readerWith(attr)).valid, attr).toBe(true)
    for (const attr of ['onclick', 'style', 'class', 'srcdoc', 'data-', 'aria-Label']) expect(validateProfile(readerWith(attr)).valid, attr).toBe(false)
    expect(text).toContain(ALLOWED_ATTRIBUTES_TEXT)
  })

  it('a profile that follows the described rules is accepted (the example forum profile)', () => {
    expect(validateProfile(validProfileDefinition()).valid).toBe(true)
  })
})

describe('the summary the owner reviews', () => {
  const profile = validateProfile(validProfileDefinition()).profile!

  it('says in plain lines what the profile covers', () => {
    const lines = summarizeProfile(profile)
    const all = lines.join('\n')
    expect(lines[0]).toMatch(/Example forum \(forum\.example\.com/)
    expect(all).toMatch(/Channel pages: https:\/\/forum\.example\.com\/c\/\*/)
    expect(all).toMatch(/Discussion pages: https:\/\/forum\.example\.com\/t\/\*/)
    expect(all).toMatch(/Sign-in check: signed in when "#current-user" is on the page; the account name is read from "#current-user \.name"; a human check is recognized by "\.captcha"/)
    expect(all).toMatch(/Reads discussions from "li\.topic" inside "ul\.topics": its id, title, author, text, link, time/)
    expect(all).toMatch(/Reads comments from "div\.post" inside "div\.posts": its id, author, text, link, time, parent comment/)
    expect(all).toMatch(/Can publish a new post in 6 steps/)
    expect(all).toMatch(/Can publish a reply in 5 steps/)
    expect(all).toMatch(/Success is recognized when the address becomes https:\/\/forum\.example\.com\/t\/\{id\} and the page shows "\{\{title\}\}"; a rejection is recognized by "\.alert-error"/)
    expect(all).toMatch(/Metrics: Members/)
    expect(all).toMatch(/Looks up the account's own posts at https:\/\/forum\.example\.com\/u\/\{\{identity\}\}\/posts/)
    expect(all).toMatch(/Community rules are read from https:\/\/forum\.example\.com\/rules/)
  })

  it('says plainly what the profile cannot do', () => {
    const bare: Record<string, unknown> = { ...validProfileDefinition(), login: { loggedInSelector: '#me' } }
    for (const key of ['publish', 'metrics', 'ownContent', 'rulesUrl', 'rulesSelector']) delete bare[key]
    const minimal = validateProfile(bare).profile!
    const all = summarizeProfile(minimal).join('\n')
    expect(all).toMatch(/the account name is not read; a human check is not recognized/)
    expect(all).toMatch(/Cannot publish anything/)
    expect(all).toMatch(/No metrics are read/)
    expect(all).toMatch(/No page with the account's own posts/)
    expect(all).toMatch(/No rules page is described/)
    const replyOnly = validProfileDefinition()
    delete (replyOnly.publish as Record<string, unknown>).post
    expect(summarizeProfile(validateProfile(replyOnly).profile!).join('\n')).toMatch(/Cannot publish new posts/)
  })
})

describe('authoring (what the core uses to validate, describe and store profiles)', () => {
  function connectorWithStorage() {
    const connector = new UniversalConnector()
    const t = makeTestCore({ connectors: [connector] })
    connector.bindStorage({ db: t.core.db, clock: t.core.clock })
    return connector
  }

  it('is offered by the universal connector, which is labelled for people', () => {
    const connector = new UniversalConnector()
    expect(connector.label).toBe('Other website')
    expect(connector.authoring.describeFormat()).toBe(describeProfileFormat())
  })

  it('validates without storing: valid → summary and host; invalid → problems and the host it claims', () => {
    const connector = connectorWithStorage()
    const ok = connector.authoring.validateDefinition(validProfileDefinition())
    expect(ok).toMatchObject({ valid: true, errors: [], host: 'forum.example.com' })
    expect(ok.summary.length).toBeGreaterThan(5)

    const broken = connector.authoring.validateDefinition({ ...validProfileDefinition(), schema: 2, evil: 'x' })
    expect(broken.valid).toBe(false)
    expect(broken.errors.join(' ')).toMatch(/schema/)
    expect(broken.errors.join(' ')).toMatch(/evil/)
    expect(broken.summary).toEqual([])
    expect(broken.host).toBe('forum.example.com')

    expect(connector.authoring.validateDefinition('not an object')).toMatchObject({ valid: false, host: null, summary: [] })
    expect(connector.listProfiles()).toEqual([])
  })

  it('saves new versions, remembers which hosts have a valid profile, and refuses a host mismatch', () => {
    const connector = connectorWithStorage()
    const { authoring } = connector
    expect(authoring.hasValidProfile('forum.example.com')).toBe(false)
    const first = authoring.saveDefinition('forum.example.com', validProfileDefinition())
    const second = authoring.saveDefinition('FORUM.example.com', validProfileDefinition({ name: 'Renamed' }))
    expect([first.version, second.version]).toEqual([1, 2])
    expect(second).toMatchObject({ host: 'forum.example.com', valid: true, errors: [] })
    expect(authoring.hasValidProfile('forum.example.com')).toBe(true)
    expect(authoring.hasValidProfile('sub.forum.example.com')).toBe(true)
    expect(authoring.hasValidProfile('other.example.org')).toBe(false)
    expect(() => authoring.saveDefinition('elsewhere.example.org', validProfileDefinition())).toThrow(/not for elsewhere\.example\.org/)
  })

  it('needs its storage before it can save', () => {
    expect(() => new UniversalConnector().authoring.saveDefinition('forum.example.com', validProfileDefinition())).toThrow(/storage/)
    expect(new UniversalConnector().authoring.hasValidProfile('forum.example.com')).toBe(false)
  })
})
