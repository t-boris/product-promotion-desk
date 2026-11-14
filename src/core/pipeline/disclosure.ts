// The disclosure of the author's connection to the product (DEC-010 §3), decided in code.
//
// A login that speaks for a product must not read as an independent user. Until now that was a rule in the prompt and a flag the model
// set about its own text; neither the approval nor the SendGate ever looked. This module reads the TEXT, whoever wrote it (the AI or the
// owner): when it mentions the product it must also say, in the author's own words, that the author is connected with it.
//
// Two decisions, both language-limited and both deliberately simple:
//  - "mentions the product": the title, the text or the link names it. The name is matched as whole words, and a one-word name of five
//    letters or fewer ("Pulse", "Desk") only with its own capitalisation, because such a name is also an ordinary word. The website's host
//    counts too (in the text, or as the host of the link).
//  - "says it is connected": some sentence is a first-person statement of connection (I built it, I work on it, I'm the developer, my app,
//    Disclosure: ...). English, and a small Russian set. A text in another language that mentions the product is refused until the owner
//    adds one such sentence: refusing is the safe side, the sentence is short, and the owner can always write it.
//
// A text that does not mention the product is never touched. The check cannot tell a lie from the truth ("I'm the developer" written by
// someone who is not): it prevents forgetting, which is what happened.

export interface DisclosureContent {
  title?: string | null
  text: string
  link?: string | null
}

export interface DisclosureProduct {
  name: string
  websiteUrl?: string | null
}

const NOT_LETTER_BEFORE = '(?<![\\p{L}\\p{N}])'
const NOT_LETTER_AFTER = '(?![\\p{L}\\p{N}])'

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A pattern that matches whole words, also for Cyrillic (JavaScript's `\b` knows only ASCII letters). */
const words = (source: string): RegExp => new RegExp(`${NOT_LETTER_BEFORE}(?:${source})${NOT_LETTER_AFTER}`, 'iu')

/** "Pulse" and "Desk" are also ordinary words: such a name counts only as written. */
const isCommonWordSized = (name: string): boolean => /^\p{L}{1,5}$/u.test(name)

function nameIn(text: string, name: string): boolean {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return false
  const source = clean.split(' ').map(escapeRegExp).join('\\s+')
  return new RegExp(`${NOT_LETTER_BEFORE}${source}${NOT_LETTER_AFTER}`, isCommonWordSized(clean) ? 'u' : 'iu').test(text)
}

/** The host of an address, without a leading "www.", or '' when it is not one. */
function hostOf(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  if (!text) return ''
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function hostIn(text: string, host: string): boolean {
  // A sub-domain or "www." before it is the same site; a letter or hyphen before it (evilnatalmystic.com) or another label after it
  // (natalmystic.com.evil.example) is not. A full stop that ends a sentence is fine.
  return host !== '' && new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(host)}(?![\\p{L}\\p{N}-]|\\.[\\p{L}\\p{N}])`, 'iu').test(text)
}

/** Whether a piece of text names the product or its website. */
function namesProduct(text: string, product: DisclosureProduct): boolean {
  return nameIn(text, product.name) || hostIn(text, hostOf(product.websiteUrl))
}

/** Whether the title, the text or the link of the content mentions the product. */
export function mentionsProductIn(content: DisclosureContent, product: DisclosureProduct): boolean {
  const host = hostOf(product.websiteUrl)
  const linkHost = hostOf(content.link)
  if (host !== '' && linkHost !== '' && (linkHost === host || linkHost.endsWith(`.${host}`))) return true
  return namesProduct([content.title ?? '', content.text].join('\n'), product)
}

// ───────────────────────── "I am connected with it" ─────────────────────────

const ROLE_NOUN = 'developers?|devs?|makers?|creators?|founders?|co-?founders?|owners?|builders?|authors?|designers?|engineers?|programmers?|maintainers?'
const FIRST_BE = "(?:i|we)(?:['’]m|['’]re|\\s+am|\\s+are)"
const SHAPE = '(?:\\p{L}+\\s+){0,2}?'

/** Statements that disclose by themselves: a label, or an outright statement of a role. */
const STANDALONE: RegExp[] = [
  words('disclosure|disclaimer|full disclosure|conflict of interest|affiliat(?:ed|ion)|self[- ]?promo(?:tion|tional)?|shameless (?:plug|promo)|full transparency'),
  // I'm the developer, we are the team, I'm one of the makers
  words(`${FIRST_BE}\\s+(?:the|one of the|part of the|on the|in the)\\s+${SHAPE}(?:${ROLE_NOUN}|team|staff)`),
  // I'm a founder of ..., we are developers behind ..., I'm a solo dev
  words(`${FIRST_BE}\\s+(?:an?\\s+)?${SHAPE}(?:${ROLE_NOUN}|member)\\s+(?:of|behind|at|for|on)`),
  words(`${FIRST_BE}\\s+(?:an?\\s+)?(?:solo|indie)\\s+(?:${ROLE_NOUN})`),
  // the team behind it, the dev behind this
  words('the\\s+(?:team|people|person|guy|girl|dev|devs|developers?|makers?|creators?|founders?)\\s+behind'),
  // As the founder of ..., as one of the makers behind ...
  words(`as\\s+(?:the|one of the)\\s+${SHAPE}(?:${ROLE_NOUN})\\s+(?:of|behind)`),
  // my app, our product
  words('(?:my|our)\\s+(?:(?:own|little|small|new|side|first|latest|current)\\s+)?(?:apps?|products?|tools?|projects?|startups?|compan(?:y|ies)|sites?|websites?|services?|platforms?|software|creations?|business|brands?|extensions?|plugins?|librar(?:y|ies)|games?|brainchild)'),
  // Russian
  words('раскрытие информации|дисклеймер|аффилиаци[яи]|заинтересованн\\p{L}*|на правах рекламы|это реклама'),
  words(`я\\s+(?:один из\\s+)?${SHAPE}(?:разработчик\\p{L}*|создател\\p{L}*|автор\\p{L}*|основател\\p{L}*|владел\\p{L}*|дизайнер\\p{L}*|программист\\p{L}*)`),
  words('мы\\s+(?:команда|разработчики|создатели|авторы)'),
  words('(?:мо[йяеи]|мою|наш[аеиу]?|нашу)\\s+(?:\\p{L}+\\s+)?(?:приложени[ея]|продукт|проект|сервис|сайт|стартап|компания|разработка)')
]

/** A first-person action; it discloses only when the sentence is about the product (it names it, or says "it", "this", "our app"). */
const ACTION = words(
  "(?:i|we)(?:['’]ve|['’]d|\\s+have|\\s+had)?\\s+(?:(?:just|recently|also|originally|personally|actually|myself|ourselves)\\s+)?(?:built|made|created|developed|founded|co-?founded|launched|designed|wrote|written|started|coded|programmed|maintain|run|build|make|create|develop|design|code|work(?:s|ed|ing)?\\s+(?:on|at|for)|am working\\s+(?:on|at|for)|are working\\s+(?:on|at|for))"
)
const ACTION_RU = words(
  '(?:я|мы)\\s+(?:(?:сам|сама|сами|недавно|тоже)\\s+)?(?:разработал[аи]?|создал[аи]?|сделал[аи]?|запустил[аи]?|основал[аи]?|написал[аи]?|делаю|делаем|создаю|создаём|создаем|разрабатываю|разрабатываем|работаю(?:\\s+(?:над|в|на))?|работаем(?:\\s+(?:над|в|на))?)'
)
const ABOUT_IT = words("it|its|this|these|that|the\\s+(?:app|tool|product|site|website|service|project|platform|software|game|extension|plugin|library|startup|company)|our|my|это|этот|эту|его|её|ее|наш\\p{L}*|мо\\p{L}{1,3}|приложение|продукт|сервис|проект|сайт")

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?…])\s+|\n+/u).map((s) => s.trim()).filter((s) => s !== '')

/** Whether the text says, in some sentence, that its author is connected with what it talks about. */
export function statesConnection(content: DisclosureContent, product: DisclosureProduct): boolean {
  const pieces = [content.title ?? '', content.text].filter((p) => p.trim() !== '')
  for (const piece of pieces) {
    for (const sentence of sentencesOf(piece)) {
      if (STANDALONE.some((pattern) => pattern.test(sentence))) return true
      if ((ACTION.test(sentence) || ACTION_RU.test(sentence)) && (ABOUT_IT.test(sentence) || namesProduct(sentence, product))) return true
    }
  }
  return false
}

/**
 * Why this content must not be approved or sent, in words for the owner, or null. Null for every text that does not mention the
 * product, and for every text that mentions it and says the author is connected with it.
 */
export function disclosureProblem(content: DisclosureContent, product: DisclosureProduct): string | null {
  if (!mentionsProductIn(content, product)) return null
  if (statesConnection(content, product)) return null
  return `This text mentions "${product.name.trim()}" but does not say that you are connected with it. Add a short statement (for example "Disclosure: I'm the developer of ${product.name.trim()}" or "I work on it"), or take the mention out, then approve it again.`
}
