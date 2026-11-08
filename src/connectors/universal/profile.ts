// Declarative site profile of the universal connector (SRC-001 "Расширяемость первой версии").
// A profile is DATA: URL patterns, CSS selectors and a short list of navigation steps. It can never carry
// code, and the connector only ever interprets it with its own fixed logic.

export const PROFILE_SCHEMA_VERSION = 1

export const LIMITS = {
  /** Serialized profile size in characters. */
  maxBytes: 20_000,
  maxDepth: 6,
  maxSteps: 20,
  maxUrlPatterns: 10,
  maxMetrics: 10,
  maxString: 500,
  maxSelector: 300,
  maxName: 80
} as const

/** How to read one value out of an item: an element below the item (or the item itself) and optionally an attribute. */
export interface FieldSpec {
  selector?: string
  attr?: string
}

export interface ItemReader {
  /** Exists on the page even when there are no items; its absence means the site layout changed. */
  containerSelector: string
  itemSelector: string
  id: FieldSpec
  title?: FieldSpec
  author?: FieldSpec
  body?: FieldSpec
  permalink?: FieldSpec
  time?: FieldSpec
  parentId?: FieldSpec
}

export type Step =
  | { type: 'goto'; url: string }
  | { type: 'waitFor'; selector: string; timeoutMs?: number }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'click'; selector: string }

export const STEP_TYPES = ['goto', 'waitFor', 'fill', 'click'] as const
export type StepType = (typeof STEP_TYPES)[number]

/** How a successful submission is recognized. At least one of urlGlob, selector, textIncludes. */
export interface Verify {
  /** URL pattern of the result page; `{id}` captures the platform id. */
  urlGlob?: string
  selector?: string
  textIncludes?: string
  /** Visible element whose text means the site rejected the submission. */
  errorSelector?: string
}

export interface PublishFlow {
  steps: Step[]
  verify: Verify
}

export interface MetricSpec {
  key: string
  label: string
  selector: string
  attr?: string
}

export interface SiteProfile {
  schema: typeof PROFILE_SCHEMA_VERSION
  name: string
  /** Hostname the profile applies to, e.g. "forum.example.com". Subdomains are accepted. */
  host: string
  channelUrls: string[]
  discussionUrls: string[]
  loginUrl?: string
  login: { loggedInSelector: string; identitySelector?: string; captchaSelector?: string }
  discussions: ItemReader
  comments: ItemReader
  ownContent?: { url: string; reader: ItemReader }
  publish?: { post?: PublishFlow; reply?: PublishFlow }
  metrics?: MetricSpec[]
  rulesUrl?: string
  rulesSelector?: string
}

/** Names usable inside `{{ }}` placeholders. */
export const VALUE_PLACEHOLDERS = ['text', 'title', 'link', 'parentId', 'destination', 'channelUrl', 'target', 'identity'] as const
/** Placeholders allowed inside selectors: restricted to identifier-like values at render time. */
export const SELECTOR_PLACEHOLDERS = ['parentId', 'identity'] as const
export type PlaceholderName = (typeof VALUE_PLACEHOLDERS)[number]
