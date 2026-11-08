// Hand-written validator for site profiles. It is deliberately strict: unknown keys, unknown step types,
// anything that looks like script/eval/function content, and oversized profiles are all rejected, so a profile
// (even an AI-generated one) can never smuggle in code. No arbitrary generated code is ever executed.

import { globToRegExp, hostBelongsTo } from './glob'
import {
  LIMITS,
  PROFILE_SCHEMA_VERSION,
  SELECTOR_PLACEHOLDERS,
  STEP_TYPES,
  VALUE_PLACEHOLDERS,
  type FieldSpec,
  type ItemReader,
  type MetricSpec,
  type PublishFlow,
  type SiteProfile,
  type Step,
  type Verify
} from './profile'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  profile: SiteProfile | null
}

/** Key names that suggest executable content, wherever they appear. */
const CODE_KEY = /^(on[a-z]+|script|scripts|eval|exec|execute|function|fn|js|javascript|code|expression|callback|handler|evaluate|inject|run)$/i
/** String content that looks like script, an eval-like call, a function, or template injection. */
const CODE_VALUE = /<\s*\/?\s*script|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\beval\s*\(|\bFunction\s*\(|\bnew\s+Function\b|=>|\bimport\s*\(|\brequire\s*\(|\bwindow\s*\.|\bdocument\s*\.|\$\{|`|\bfunction\s*\(/i

const HOST = /^(?=.{3,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const ATTR = /^(href|id|datetime|content|title|value|src|alt|data-[a-z0-9-]{1,40}|aria-[a-z]{1,30})$/
/** Plain-words form of ATTR for the format description given to the AI; format.test.ts keeps the two in step. */
export const ALLOWED_ATTRIBUTES_TEXT = 'href, id, datetime, content, title, value, src, alt, data-<name> (lower-case letters, digits and hyphens, up to 40) and aria-<name> (lower-case letters, up to 30)'
const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g
/** Stateless presence check (the global regex above keeps lastIndex between test() calls). */
const HAS_PLACEHOLDER = /\{\{/
const METRIC_KEY = /^[a-z][a-z0-9_]{0,39}$/

class Collector {
  readonly errors: string[] = []
  add(path: string, message: string): void {
    if (this.errors.length < 40) this.errors.push(`${path || 'profile'}: ${message}`)
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Walks the raw value once: only JSON data types, bounded depth, and no code-like keys or strings anywhere. */
function scanRaw(value: unknown, path: string, depth: number, c: Collector): void {
  if (depth > LIMITS.maxDepth) return c.add(path, `nesting deeper than ${LIMITS.maxDepth} levels`)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) c.add(path, 'numbers must be finite')
    return
  }
  if (typeof value === 'string') {
    if (value.length > LIMITS.maxString) c.add(path, `string longer than ${LIMITS.maxString} characters`)
    if (CODE_VALUE.test(value)) c.add(path, 'contains script-like content, which is not allowed')
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 50) c.add(path, 'array longer than 50 items')
    value.slice(0, 50).forEach((item, i) => scanRaw(item, `${path}[${i}]`, depth + 1, c))
    return
  }
  if (isObj(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (CODE_KEY.test(key)) c.add(`${path}.${key}`, 'executable content is not allowed in a profile')
      scanRaw(item, `${path}.${key}`, depth + 1, c)
    }
    return
  }
  c.add(path, `unsupported value of type ${typeof value} (functions and objects with behavior are not allowed)`)
}

function checkKeys(obj: Obj, allowed: readonly string[], path: string, c: Collector): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) c.add(`${path}.${key}`, 'unknown field')
}

function str(obj: Obj, key: string, path: string, c: Collector, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const v = obj[key]
  if (v === undefined) {
    if (opts.required) c.add(`${path}.${key}`, 'is required')
    return undefined
  }
  if (typeof v !== 'string' || v.trim() === '') {
    c.add(`${path}.${key}`, 'must be a non-empty string')
    return undefined
  }
  if (v.length > (opts.max ?? LIMITS.maxString)) {
    c.add(`${path}.${key}`, `longer than ${opts.max ?? LIMITS.maxString} characters`)
    return undefined
  }
  return v
}

/** Placeholders in a template must be known, and in selectors only the identifier-like ones. */
function checkPlaceholders(template: string, path: string, c: Collector, context: 'selector' | 'value'): void {
  const allowed: readonly string[] = context === 'selector' ? SELECTOR_PLACEHOLDERS : VALUE_PLACEHOLDERS
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (!allowed.includes(m[1])) c.add(path, `placeholder {{${m[1]}}} is not allowed here (allowed: ${allowed.join(', ')})`)
  }
  const stripped = template.replace(PLACEHOLDER, '')
  if (/\{\{|\}\}/.test(stripped)) c.add(path, 'malformed placeholder')
}

/** Characters that can never be part of a plain CSS selector here: statement/block punctuation, backslash, controls. */
function hasForbiddenSelectorChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || ch === ';' || ch === '{' || ch === '}' || ch === '\\') return true
  }
  return false
}

function selector(obj: Obj, key: string, path: string, c: Collector, opts: { required?: boolean; placeholders?: boolean } = {}): string | undefined {
  const v = str(obj, key, path, c, { required: opts.required, max: LIMITS.maxSelector })
  if (v === undefined) return undefined
  const stripped = v.replace(PLACEHOLDER, '')
  if (hasForbiddenSelectorChar(opts.placeholders ? stripped : v)) c.add(`${path}.${key}`, 'is not a plain CSS selector')
  if (opts.placeholders) checkPlaceholders(v, `${path}.${key}`, c, 'selector')
  else if (HAS_PLACEHOLDER.test(v)) c.add(`${path}.${key}`, 'placeholders are not allowed in this selector')
  return v
}

function field(value: unknown, path: string, c: Collector, required: boolean): FieldSpec | undefined {
  if (value === undefined) {
    if (required) c.add(path, 'is required')
    return undefined
  }
  if (!isObj(value)) {
    c.add(path, 'must be an object with optional "selector" and "attr"')
    return undefined
  }
  checkKeys(value, ['selector', 'attr'], path, c)
  const sel = selector(value, 'selector', path, c)
  const attr = str(value, 'attr', path, c, { max: 60 })
  if (attr !== undefined && !ATTR.test(attr)) c.add(`${path}.attr`, `attribute "${attr}" is not allowed`)
  if (required && sel === undefined && attr === undefined) c.add(path, 'needs a selector or an attribute')
  return { ...(sel !== undefined ? { selector: sel } : {}), ...(attr !== undefined ? { attr } : {}) }
}

function reader(value: unknown, path: string, c: Collector): ItemReader | undefined {
  if (!isObj(value)) {
    c.add(path, 'must be an object')
    return undefined
  }
  checkKeys(value, ['containerSelector', 'itemSelector', 'id', 'title', 'author', 'body', 'permalink', 'time', 'parentId'], path, c)
  const containerSelector = selector(value, 'containerSelector', path, c, { required: true })
  const itemSelector = selector(value, 'itemSelector', path, c, { required: true })
  const id = field(value.id, `${path}.id`, c, true)
  if (!containerSelector || !itemSelector || !id) return undefined
  const out: ItemReader = { containerSelector, itemSelector, id }
  for (const key of ['title', 'author', 'body', 'permalink', 'time', 'parentId'] as const) {
    const f = field(value[key], `${path}.${key}`, c, false)
    if (f) out[key] = f
  }
  return out
}

function urlPattern(value: unknown, path: string, host: string | undefined, c: Collector, allowCapture = false): string | undefined {
  if (typeof value !== 'string' || value === '') {
    c.add(path, 'must be a non-empty string')
    return undefined
  }
  if (!/^https?:\/\/[^\s]+$/i.test(value)) {
    c.add(path, 'must be an http(s) URL pattern')
    return undefined
  }
  const withoutCaptures = value.replace(/\{[a-z]+\}/gi, 'x')
  if (!allowCapture && /\{[a-z]+\}/i.test(value) && !HAS_PLACEHOLDER.test(value)) c.add(path, 'captures like {id} are only allowed in verify.urlGlob')
  try {
    globToRegExp(value.replace(PLACEHOLDER, 'x'))
    const hostname = new URL(withoutCaptures.replace(PLACEHOLDER, 'x').replace(/\*+/g, 'x')).hostname
    if (host && !hostBelongsTo(hostname, host)) c.add(path, `points to ${hostname}, outside the profile host ${host}`)
  } catch {
    c.add(path, 'is not a valid URL pattern')
  }
  return value
}

function step(value: unknown, path: string, host: string | undefined, c: Collector): Step | undefined {
  if (!isObj(value)) {
    c.add(path, 'must be an object')
    return undefined
  }
  const type = value.type
  if (typeof type !== 'string' || !(STEP_TYPES as readonly string[]).includes(type)) {
    c.add(`${path}.type`, `unknown step type ${JSON.stringify(type)} (allowed: ${STEP_TYPES.join(', ')})`)
    return undefined
  }
  switch (type) {
    case 'goto': {
      checkKeys(value, ['type', 'url'], path, c)
      const url = str(value, 'url', path, c, { required: true })
      if (url === undefined) return undefined
      checkPlaceholders(url, `${path}.url`, c, 'value')
      // A literal URL must stay on the profile's host; templated URLs are checked again when they are rendered.
      if (/^https?:\/\//i.test(url) && !HAS_PLACEHOLDER.test(url)) urlPattern(url, `${path}.url`, host, c)
      return { type, url }
    }
    case 'waitFor': {
      checkKeys(value, ['type', 'selector', 'timeoutMs'], path, c)
      const sel = selector(value, 'selector', path, c, { required: true, placeholders: true })
      const timeoutMs = value.timeoutMs
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)) {
        c.add(`${path}.timeoutMs`, 'must be an integer between 100 and 30000')
      }
      return sel ? { type, selector: sel, ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}) } : undefined
    }
    case 'fill': {
      checkKeys(value, ['type', 'selector', 'value'], path, c)
      const sel = selector(value, 'selector', path, c, { required: true, placeholders: true })
      const text = str(value, 'value', path, c, { required: true })
      if (text !== undefined) checkPlaceholders(text, `${path}.value`, c, 'value')
      return sel && text !== undefined ? { type, selector: sel, value: text } : undefined
    }
    default: {
      checkKeys(value, ['type', 'selector'], path, c)
      const sel = selector(value, 'selector', path, c, { required: true, placeholders: true })
      return sel ? { type: 'click', selector: sel } : undefined
    }
  }
}

function verify(value: unknown, path: string, host: string | undefined, c: Collector): Verify | undefined {
  if (!isObj(value)) {
    c.add(path, 'is required: how a successful result is recognized')
    return undefined
  }
  checkKeys(value, ['urlGlob', 'selector', 'textIncludes', 'errorSelector'], path, c)
  const out: Verify = {}
  if (value.urlGlob !== undefined) out.urlGlob = urlPattern(value.urlGlob, `${path}.urlGlob`, host, c, true)
  const sel = selector(value, 'selector', path, c)
  if (sel) out.selector = sel
  const text = str(value, 'textIncludes', path, c, { max: 200 })
  if (text) {
    checkPlaceholders(text, `${path}.textIncludes`, c, 'value')
    out.textIncludes = text
  }
  const err = selector(value, 'errorSelector', path, c)
  if (err) out.errorSelector = err
  if (!out.urlGlob && !out.selector && !out.textIncludes) c.add(path, 'needs at least one of urlGlob, selector or textIncludes')
  return out
}

function flow(value: unknown, path: string, host: string | undefined, c: Collector): PublishFlow | undefined {
  if (!isObj(value)) {
    c.add(path, 'must be an object with "steps" and "verify"')
    return undefined
  }
  checkKeys(value, ['steps', 'verify'], path, c)
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    c.add(`${path}.steps`, 'must be a non-empty list')
    return undefined
  }
  if (value.steps.length > LIMITS.maxSteps) c.add(`${path}.steps`, `more than ${LIMITS.maxSteps} steps`)
  const steps = value.steps.slice(0, LIMITS.maxSteps).flatMap((s, i) => {
    const parsed = step(s, `${path}.steps[${i}]`, host, c)
    return parsed ? [parsed] : []
  })
  if (!steps.some((s) => s.type === 'click')) c.add(`${path}.steps`, 'must contain a click step that submits the content')
  if (steps.length > 0 && steps[steps.length - 1].type !== 'click') c.add(`${path}.steps`, 'must end with the click that submits the content')
  const v = verify(value.verify, `${path}.verify`, host, c)
  return v ? { steps, verify: v } : undefined
}

function metrics(value: unknown, path: string, c: Collector): MetricSpec[] | undefined {
  if (!Array.isArray(value)) {
    c.add(path, 'must be a list')
    return undefined
  }
  if (value.length > LIMITS.maxMetrics) c.add(path, `more than ${LIMITS.maxMetrics} metrics`)
  return value.slice(0, LIMITS.maxMetrics).flatMap((m, i) => {
    const p = `${path}[${i}]`
    if (!isObj(m)) {
      c.add(p, 'must be an object')
      return []
    }
    checkKeys(m, ['key', 'label', 'selector', 'attr'], p, c)
    const key = str(m, 'key', p, c, { required: true, max: 40 })
    if (key && !METRIC_KEY.test(key)) c.add(`${p}.key`, 'must be lower-case letters, digits and underscores')
    const label = str(m, 'label', p, c, { required: true, max: 80 })
    const sel = selector(m, 'selector', p, c, { required: true })
    const attr = str(m, 'attr', p, c, { max: 60 })
    if (attr !== undefined && !ATTR.test(attr)) c.add(`${p}.attr`, `attribute "${attr}" is not allowed`)
    return key && label && sel ? [{ key, label, selector: sel, ...(attr ? { attr } : {}) }] : []
  })
}

export function validateProfile(input: unknown): ValidationResult {
  const c = new Collector()
  let size: number
  try {
    size = JSON.stringify(input)?.length ?? 0
  } catch {
    return { valid: false, errors: ['profile: is not JSON-serializable'], profile: null }
  }
  if (size > LIMITS.maxBytes) return { valid: false, errors: [`profile: larger than ${LIMITS.maxBytes} characters`], profile: null }
  if (!isObj(input)) return { valid: false, errors: ['profile: must be a JSON object'], profile: null }
  scanRaw(input, 'profile', 0, c)

  checkKeys(input, ['schema', 'name', 'host', 'channelUrls', 'discussionUrls', 'loginUrl', 'login', 'discussions', 'comments', 'ownContent', 'publish', 'metrics', 'rulesUrl', 'rulesSelector'], 'profile', c)
  if (input.schema !== PROFILE_SCHEMA_VERSION) c.add('profile.schema', `must be ${PROFILE_SCHEMA_VERSION}`)
  const name = str(input, 'name', 'profile', c, { required: true, max: LIMITS.maxName })
  const host = str(input, 'host', 'profile', c, { required: true, max: 253 })
  let validHost: string | undefined
  if (host !== undefined) {
    if (HOST.test(host)) validHost = host
    else c.add('profile.host', 'must be a lower-case hostname such as forum.example.com (no scheme or path)')
  }

  const patterns = (key: 'channelUrls' | 'discussionUrls'): string[] => {
    const v = input[key]
    if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.maxUrlPatterns) {
      c.add(`profile.${key}`, `must be a list of 1 to ${LIMITS.maxUrlPatterns} URL patterns`)
      return []
    }
    return v.flatMap((p, i) => {
      const parsed = urlPattern(p, `profile.${key}[${i}]`, validHost, c)
      return parsed ? [parsed] : []
    })
  }
  const channelUrls = patterns('channelUrls')
  const discussionUrls = patterns('discussionUrls')
  const loginUrl = input.loginUrl === undefined ? undefined : urlPattern(input.loginUrl, 'profile.loginUrl', validHost, c)
  const rulesUrl = input.rulesUrl === undefined ? undefined : urlPattern(input.rulesUrl, 'profile.rulesUrl', validHost, c)
  const rulesSelector = selector(input, 'rulesSelector', 'profile', c)

  let login: SiteProfile['login'] | undefined
  if (!isObj(input.login)) c.add('profile.login', 'is required')
  else {
    checkKeys(input.login, ['loggedInSelector', 'identitySelector', 'captchaSelector'], 'profile.login', c)
    const loggedInSelector = selector(input.login, 'loggedInSelector', 'profile.login', c, { required: true })
    const identitySelector = selector(input.login, 'identitySelector', 'profile.login', c)
    const captchaSelector = selector(input.login, 'captchaSelector', 'profile.login', c)
    if (loggedInSelector) login = { loggedInSelector, ...(identitySelector ? { identitySelector } : {}), ...(captchaSelector ? { captchaSelector } : {}) }
  }

  const discussions = reader(input.discussions, 'profile.discussions', c)
  const comments = reader(input.comments, 'profile.comments', c)

  let ownContent: SiteProfile['ownContent']
  if (input.ownContent !== undefined) {
    if (!isObj(input.ownContent)) c.add('profile.ownContent', 'must be an object')
    else {
      checkKeys(input.ownContent, ['url', 'reader'], 'profile.ownContent', c)
      const url = str(input.ownContent, 'url', 'profile.ownContent', c, { required: true })
      if (url) {
        checkPlaceholders(url, 'profile.ownContent.url', c, 'value')
        if (/^https?:\/\//i.test(url) && !HAS_PLACEHOLDER.test(url)) urlPattern(url, 'profile.ownContent.url', validHost, c)
      }
      const r = reader(input.ownContent.reader, 'profile.ownContent.reader', c)
      if (url && r) ownContent = { url, reader: r }
    }
  }

  let publish: SiteProfile['publish']
  if (input.publish !== undefined) {
    if (!isObj(input.publish)) c.add('profile.publish', 'must be an object')
    else {
      checkKeys(input.publish, ['post', 'reply'], 'profile.publish', c)
      const post = input.publish.post === undefined ? undefined : flow(input.publish.post, 'profile.publish.post', validHost, c)
      const reply = input.publish.reply === undefined ? undefined : flow(input.publish.reply, 'profile.publish.reply', validHost, c)
      publish = { ...(post ? { post } : {}), ...(reply ? { reply } : {}) }
    }
  }
  const metricList = input.metrics === undefined ? undefined : metrics(input.metrics, 'profile.metrics', c)

  if (c.errors.length > 0 || !name || !validHost || !login || !discussions || !comments) {
    return { valid: false, errors: c.errors.length > 0 ? c.errors : ['profile: incomplete'], profile: null }
  }
  const profile: SiteProfile = {
    schema: PROFILE_SCHEMA_VERSION,
    name,
    host: validHost,
    channelUrls,
    discussionUrls,
    ...(loginUrl ? { loginUrl } : {}),
    login,
    discussions,
    comments,
    ...(ownContent ? { ownContent } : {}),
    ...(publish && (publish.post || publish.reply) ? { publish } : {}),
    ...(metricList && metricList.length > 0 ? { metrics: metricList } : {}),
    ...(rulesUrl ? { rulesUrl } : {}),
    ...(rulesSelector ? { rulesSelector } : {})
  }
  return { valid: true, errors: [], profile }
}
