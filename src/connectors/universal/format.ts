// Plain-language material about site profiles for people and for the AI that drafts them:
//  - describeProfileFormat(): the schema, limits and rules of validate.ts, so a draft matches the validator;
//  - summarizeProfile(): what a (valid) profile says, as lines the owner can review before saving it.
// Numbers come from the same constants the validator uses; format.test.ts checks the text against the validator.

import { LIMITS, PROFILE_SCHEMA_VERSION, SELECTOR_PLACEHOLDERS, STEP_TYPES, VALUE_PLACEHOLDERS, type ItemReader, type PublishFlow, type SiteProfile, type Step } from './profile'
import { ALLOWED_ATTRIBUTES_TEXT } from './validate'

export function describeProfileFormat(): string {
  const values = VALUE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')
  const inSelectors = SELECTOR_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')
  return `A site profile is ONE JSON object that tells a fixed program how to read and use one website. It is data only.
Never include code: no scripts, functions, "javascript:" links, template strings, backticks, "=>", "eval", "window." or "document." anywhere, and no field named script, eval, function, code, handler or starting with "on". Unknown fields are rejected. Use only JSON strings, numbers, booleans, lists and objects.
Limits: the whole object at most ${LIMITS.maxBytes} characters; nesting at most ${LIMITS.maxDepth} levels; any list at most 50 items; any string at most ${LIMITS.maxString} characters; any CSS selector at most ${LIMITS.maxSelector} characters.

SELECTORS are plain CSS selectors (tag, #id, .class, [attribute=value], descendant and child combinators, :nth-child and similar). They must not contain ; { } backslash or control characters. Prefer stable ids, classes, roles and data- attributes over positions.
ATTRIBUTES a field may read ("attr"): ${ALLOWED_ATTRIBUTES_TEXT}. No other attribute is accepted.
URL PATTERNS start with http:// or https:// and must be on the profile host or a subdomain of it. In a pattern "*" matches any characters inside one path segment, "**" matches anything, and {name} matches one path segment and captures it. Captures such as {id} are allowed only in verify.urlGlob; "id" is the capture that names the created item.

TOP-LEVEL FIELDS (all others are rejected):
- schema (required): the number ${PROFILE_SCHEMA_VERSION}.
- name (required): short display name, at most ${LIMITS.maxName} characters.
- host (required): lower-case hostname with at least one dot, no scheme and no path, for example "forum.example.com".
- channelUrls (required): 1 to ${LIMITS.maxUrlPatterns} URL patterns of pages that LIST discussions (a board, category or community).
- discussionUrls (required): 1 to ${LIMITS.maxUrlPatterns} URL patterns of single discussion pages.
- loginUrl (optional): URL pattern of the sign-in page.
- login (required): { loggedInSelector (required): an element that exists only when the account is signed in; identitySelector (optional): the element whose text is the signed-in account name; captchaSelector (optional): an element shown when the site asks for a human check }.
- discussions (required) and comments (required): an ITEM READER, see below. "discussions" reads the list of discussions on a channel page; "comments" reads the comments on a discussion page.
- ownContent (optional): { url: address of the page listing the account's own posts and comments, may use value placeholders such as {{identity}}; reader: an ITEM READER }. It lets the program find out whether a message really went out. For that the reader should provide time, and parentId (for replies) or title (for posts).
- publish (optional): { post (optional): PUBLISH FLOW, reply (optional): PUBLISH FLOW }. Leave a flow out when it cannot be described reliably; the program then never sends that kind of message.
- metrics (optional): up to ${LIMITS.maxMetrics} items { key (lower-case letters, digits, underscore, starts with a letter, at most 40), label (at most 80), selector, attr (optional) } reading one number from the channel page, for example the member count.
- rulesUrl (optional) and rulesSelector (optional): where the community rules are published (URL pattern) and the element holding their text.

ITEM READER: { containerSelector (required): exists on the page even when there are no items (its absence means the layout changed); itemSelector (required): one element per item; id (required): FIELD; title, author, body, permalink, time, parentId (all optional): FIELD }.
FIELD: { selector (optional): an element below the item; omit it to use the item itself; attr (optional): the attribute to read instead of the element's text }. A field needs a selector or an attr. Use for example id: {"attr":"data-id"}, permalink: {"selector":"a.title","attr":"href"}, time: {"selector":"time","attr":"datetime"}. The id must be unique and stable per item. parentId is the id of the comment being answered (empty for top-level comments).

PUBLISH FLOW: { steps: list of 1 to ${LIMITS.maxSteps} steps; verify: how success is recognized }.
Step types (only these): ${STEP_TYPES.join(', ')}.
- {"type":"goto","url": address on the profile host; value placeholders allowed}
- {"type":"waitFor","selector": ...,"timeoutMs": optional integer 100 to 30000}
- {"type":"fill","selector": ...,"value": text; value placeholders allowed}
- {"type":"click","selector": ...}
The steps must contain a click and must END with the click that submits the content.
verify (required): { urlGlob, selector, textIncludes, errorSelector; all optional but at least one of urlGlob, selector or textIncludes is required }. urlGlob: URL pattern of the page shown after success, with {id} capturing the new item's id. selector: element that exists after success. textIncludes: text the page shows after success (at most 200 characters; value placeholders allowed). errorSelector: visible element whose text means the site rejected the submission.
PLACEHOLDERS use the form {{name}}. In values and addresses (goto.url, fill.value, verify.textIncludes, ownContent.url) the allowed names are: ${values}. Inside selectors (waitFor, fill and click selectors) only ${inSelectors} are allowed, and their values must be plain identifiers. Reader selectors, login selectors and metric selectors take no placeholders. {{text}}, {{title}} and {{link}} are the content to publish, {{parentId}} the id of the comment being answered, {{destination}} the address of the discussion or channel, {{channelUrl}} the channel page, {{target}} the channel address as stored, {{identity}} the signed-in account name.

Only describe what the page content you were given actually shows. If something cannot be determined, leave the optional part out instead of guessing; never invent selectors.`
}

// ───────────────────────────── Summary for the owner ─────────────────────────────

const FIELD_NAMES: [keyof ItemReader, string][] = [
  ['title', 'title'],
  ['author', 'author'],
  ['body', 'text'],
  ['permalink', 'link'],
  ['time', 'time'],
  ['parentId', 'parent comment']
]

function fieldsOf(reader: ItemReader): string {
  const has = FIELD_NAMES.filter(([key]) => reader[key] !== undefined).map(([, name]) => name)
  return has.length > 0 ? `its id, ${has.join(', ')}` : 'only its id'
}

function readerLine(what: string, reader: ItemReader): string {
  return `Reads ${what} from "${reader.itemSelector}" inside "${reader.containerSelector}": ${fieldsOf(reader)}.`
}

function stepWords(step: Step): string {
  switch (step.type) {
    case 'goto':
      return `open ${step.url}`
    case 'waitFor':
      return `wait for "${step.selector}"`
    case 'fill':
      return `type into "${step.selector}"`
    case 'click':
      return `click "${step.selector}"`
  }
}

function flowLine(what: string, flow: PublishFlow): string {
  const recognized: string[] = []
  if (flow.verify.urlGlob) recognized.push(`the address becomes ${flow.verify.urlGlob}`)
  if (flow.verify.selector) recognized.push(`"${flow.verify.selector}" appears`)
  if (flow.verify.textIncludes) recognized.push(`the page shows "${flow.verify.textIncludes}"`)
  const rejection = flow.verify.errorSelector ? `; a rejection is recognized by "${flow.verify.errorSelector}"` : ''
  return `Can publish ${what} in ${flow.steps.length} steps (${flow.steps.map(stepWords).join(', then ')}). Success is recognized when ${recognized.join(' and ')}${rejection}.`
}

/** What a valid profile says, as plain lines for the owner to read before saving it. */
export function summarizeProfile(profile: SiteProfile): string[] {
  const lines: string[] = [`Site: ${profile.name} (${profile.host}, including its subdomains).`]
  lines.push(`Channel pages: ${profile.channelUrls.join(', ')}.`)
  lines.push(`Discussion pages: ${profile.discussionUrls.join(', ')}.`)
  const login = profile.login
  lines.push(
    `Sign-in check: signed in when "${login.loggedInSelector}" is on the page; ` +
      `${login.identitySelector ? `the account name is read from "${login.identitySelector}"` : 'the account name is not read'}; ` +
      `${login.captchaSelector ? `a human check is recognized by "${login.captchaSelector}"` : 'a human check is not recognized'}.` +
      `${profile.loginUrl ? ` Sign-in page: ${profile.loginUrl}.` : ''}`
  )
  lines.push(readerLine('discussions', profile.discussions))
  lines.push(readerLine('comments', profile.comments))
  if (profile.ownContent) {
    const { url, reader } = profile.ownContent
    const gap = reader.time ? '' : ' It shows no time, so an unconfirmed send could not be told from older posts.'
    lines.push(`Looks up the account's own posts at ${url} (reads ${fieldsOf(reader)}) to find out whether a message went out.${gap}`)
  } else lines.push("No page with the account's own posts: an unconfirmed send could not be looked up automatically.")
  const publish = profile.publish
  if (publish?.post) lines.push(flowLine('a new post', publish.post))
  if (publish?.reply) lines.push(flowLine('a reply', publish.reply))
  if (!publish?.post && !publish?.reply) lines.push('Cannot publish anything: no publishing steps are described, so the app only reads this site.')
  else if (!publish.post || !publish.reply) lines.push(`Cannot publish ${publish.post ? 'replies' : 'new posts'}: no steps are described for it.`)
  lines.push(profile.metrics && profile.metrics.length > 0 ? `Metrics: ${profile.metrics.map((m) => m.label).join(', ')}.` : 'No metrics are read.')
  lines.push(profile.rulesUrl ? `Community rules are read from ${profile.rulesUrl}${profile.rulesSelector ? ` ("${profile.rulesSelector}")` : ''}.` : 'No rules page is described: read the rules yourself before enabling sending.')
  return lines
}
