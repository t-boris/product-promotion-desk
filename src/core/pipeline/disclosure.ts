// The disclosure of the author's connection to the product (DEC-010 §3), decided in code.
//
// A login that speaks for a product must not read as an independent user. Until now that was a rule in the prompt and a flag the model
// set about its own text; neither the approval nor the SendGate ever looked. This module reads the TEXT, whoever wrote it (the AI or the
// owner): when it mentions the product it must also say, in the author's own words, that the author is connected with it.
//
// Three decisions, all language-limited and all deliberately simple:
//  - "mentions the product": the title, the text or the link names it. The name is matched as whole words (written apart, joined or
//    hyphenated: "Natal Mystic", "NatalMystic"), and a one-word name of five letters or fewer ("Pulse", "Desk") only with its own
//    capitalisation, because such a name is also an ordinary word. The website counts too: its host, in the text or as the host of the
//    link. A website on a shared host (github.com/me/tool) counts only with its path, never by the host alone. Invisible format
//    characters (zero-width spaces and joiners, soft hyphens) are removed before anything is read.
//  - "says it is connected": some clause is a first-person statement of connection to the product itself: a label (Disclosure: ...), a
//    role (I'm the developer of it), or an action with the product as its object (I built Natal Mystic, I work on it), or it is the
//    product that "my app" or "it's our product" names. A word that merely appears is not enough: "my site", "my business", "I used it for
//    my project", "I made it work" are what a customer says. English, and a small Russian set. A text in another language that mentions
//    the product is refused until the owner adds one such sentence: refusing is the safe side, the sentence is short, and the owner can
//    always write it.
//  - "denies it": "not affiliated", "no connection", "I'm not the developer", "just a happy user" (and the Russian set). A login that
//    speaks for a product is connected with it by construction, so a denial is never a disclosure and is itself a problem: it is refused
//    when the text mentions the product, and also when it names nobody else ("No affiliation, just a user"). "Not affiliated with
//    Reddit" in a text that does not mention the product is left alone.
//
// A text that does not mention the product and does not deny a connection is never touched. The check cannot tell a lie from the truth
// ("I'm the developer" written by someone who is not, a shortened link that hides the host): it prevents forgetting, which is what
// happened, and the plainest forms of hiding.

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

/** Folds look-alike forms and removes every invisible format character (zero-width space and joiners, BOM, soft hyphen, direction marks). */
const clean = (text: string | null | undefined): string => (text ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '')

// ───────────────────────── the product, in the text ─────────────────────────

/** Hosts that hold many unrelated sites: a website there is told from the others by its path, not by the host. */
const SHARED_HOSTS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'sourceforge.net', 'codeberg.org', 'huggingface.co', 'npmjs.com', 'pypi.org', 'crates.io',
  'play.google.com', 'apps.apple.com', 'itunes.apple.com', 'apps.microsoft.com', 'chromewebstore.google.com', 'chrome.google.com', 'addons.mozilla.org',
  'docs.google.com', 'drive.google.com', 'sites.google.com', 'store.steampowered.com',
  'medium.com', 'notion.so', 'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'reddit.com', 'producthunt.com', 't.me', 'discord.gg', 'discord.com'
])

/** The part of an address that names a site: the host, and for a shared host the path as well. */
interface Site {
  host: string
  path: string[]
}

function parseAddress(value: string | null | undefined): URL | null {
  const text = clean(value).trim()
  if (!text) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
}

const hostOfUrl = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '')
const pathOfUrl = (url: URL): string[] => url.pathname.split('/').filter((s) => s !== '').map((s) => s.toLowerCase())

/** The site the owner gave as the product's website. A shared host without a path names nothing. */
function siteOf(value: string | null | undefined): Site | null {
  const url = parseAddress(value)
  if (!url) return null
  const host = hostOfUrl(url)
  if (host === '') return null
  if (!SHARED_HOSTS.has(host)) return { host, path: [] }
  const path = pathOfUrl(url)
  return path.length > 0 ? { host, path } : null
}

function linkNamesSite(link: string | null | undefined, site: Site | null): boolean {
  const url = parseAddress(link)
  if (!url || !site) return false
  const host = hostOfUrl(url)
  if (site.path.length > 0) {
    const path = pathOfUrl(url)
    return host === site.host && site.path.every((segment, i) => path[i] === segment)
  }
  return host === site.host || host.endsWith(`.${site.host}`)
}

function siteIn(text: string, site: Site | null): boolean {
  if (!site) return false
  if (site.path.length > 0) {
    // github.com/me/tool matches github.com/me/tool and github.com/me/tool/issues, not github.com/me/tool-two or github.com/me/other.
    const where = `${escapeRegExp(site.host)}/${site.path.map(escapeRegExp).join('/')}`
    return new RegExp(`(?<![\\p{L}\\p{N}-])${where}(?![\\p{L}\\p{N}_-])`, 'iu').test(text)
  }
  // A sub-domain or "www." before it is the same site; a letter or hyphen before it (evilnatalmystic.com) or another label after it
  // (natalmystic.com.evil.example) is not. A full stop that ends a sentence is fine.
  return new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(site.host)}(?![\\p{L}\\p{N}-]|\\.[\\p{L}\\p{N}])`, 'iu').test(text)
}

/** "Pulse" and "Desk" are also ordinary words: such a name counts only as written. */
const isCommonWordSized = (name: string): boolean => /^\p{L}{1,5}$/u.test(name)

/** After a name written joined ("natalmystic") a full stop and a label ("natalmystic.com.evil.example") is a host, not the name. */
const NOT_A_HOST_AFTER = '(?![\\p{L}\\p{N}]|\\.[\\p{L}\\p{N}])'

/**
 * The name as patterns. Its words may be written apart or hyphenated ("Natal Mystic", "natal-mystic"), and a name of several words also
 * joined ("NatalMystic"); `build` puts the pattern of the name between what must be before and after it.
 */
function nameForms(name: string, build: (source: string, after: string) => string): RegExp[] {
  const text = clean(name).trim().replace(/\s+/g, ' ')
  if (!text) return []
  const flags = isCommonWordSized(text) ? 'u' : 'iu'
  const parts = text.split(' ').map(escapeRegExp)
  const forms = [build(parts.join('[\\s_-]+'), NOT_LETTER_AFTER)]
  if (parts.length > 1) forms.push(build(parts.join('[_-]*'), NOT_A_HOST_AFTER))
  return forms.map((source) => new RegExp(source, flags))
}

function nameIn(text: string, name: string): boolean {
  return nameForms(name, (source, after) => `${NOT_LETTER_BEFORE}${source}${after}`).some((p) => p.test(text))
}

/** The product as the sentences below look for it. */
interface Product {
  name: string
  site: Site | null
}

const productOf = (product: DisclosureProduct): Product => ({ name: clean(product.name).trim(), site: siteOf(product.websiteUrl) })

const namesProduct = (text: string, product: Product): boolean => nameIn(text, product.name) || siteIn(text, product.site)

/** Whether the title, the text or the link of the content mentions the product. */
export function mentionsProductIn(content: DisclosureContent, product: DisclosureProduct): boolean {
  const p = productOf(product)
  if (linkNamesSite(content.link, p.site)) return true
  return namesProduct([clean(content.title), clean(content.text)].join('\n'), p)
}

/** What follows the product when the text starts with it (its name or its website, after "the" or "this"), or null when it does not. */
function afterProduct(text: string, product: Product): string | null {
  const t = text.trimStart().replace(/^(?:the|this|that|our|my)\s+/i, '')
  for (const pattern of nameForms(product.name, (source, after) => `^${source}${after}`)) {
    const named = pattern.exec(t)
    if (named) return t.slice(named[0].length)
  }
  if (product.site) {
    const where = product.site.path.length > 0 ? `${escapeRegExp(product.site.host)}/${product.site.path.map(escapeRegExp).join('/')}` : escapeRegExp(product.site.host)
    const site = new RegExp(`^(?:https?://)?(?:[\\p{L}\\p{N}-]+\\.)*${where}(?![\\p{L}\\p{N}_-])(?:/\\S*)?`, 'iu').exec(t)
    if (site) return t.slice(site[0].length)
  }
  return null
}

/** Whether the text ends with the product (its name or its website). */
function endsWithProduct(text: string, product: Product): boolean {
  const t = text.trimEnd().replace(/[.!?…"'”’)\]]+$/u, '')
  if (nameForms(product.name, (source) => `${NOT_LETTER_BEFORE}${source}$`).some((p) => p.test(t))) return true
  return product.site !== null && new RegExp(`${escapeRegExp(product.site.host)}(?:/\\S*)?$`, 'iu').test(t)
}

// ───────────────────────── clauses ─────────────────────────

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?…])\s+|\n+/u).map((s) => s.trim()).filter((s) => s !== '')

/** A clause is the unit of a statement: a comma, a colon (not of a URL), a bracket or "but" ends what a negation or a verb reaches. */
const CLAUSE_BREAK = /[,;()[\]]|:(?!\/\/)|\s(?:but|however|though|although|except|yet|но|однако|хотя|зато)\s/iu
const clausesOf = (sentence: string): string[] => sentence.split(CLAUSE_BREAK).map((c) => c.trim()).filter((c) => c !== '')

function* clausesIn(content: DisclosureContent): Generator<string> {
  for (const piece of [clean(content.title), clean(content.text)]) {
    if (piece.trim() === '') continue
    for (const sentence of sentencesOf(piece)) yield* clausesOf(sentence)
  }
}

/** Every match of a pattern in a text, with what is before and after it. */
function* matchesOf(pattern: RegExp, text: string): Generator<{ head: string; tail: string; match: RegExpExecArray }> {
  const all = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  for (let m = all.exec(text); m !== null; m = all.exec(text)) {
    yield { head: text.slice(0, m.index), tail: text.slice(m.index + m[0].length), match: m }
    if (m[0] === '') all.lastIndex += 1
  }
}

// ───────────────────────── "I do not have anything to do with it" ─────────────────────────

const ROLE_NOUN = 'developers?|devs?|makers?|creators?|founders?|co-?founders?|owners?|builders?|authors?|designers?|engineers?|programmers?|maintainers?'
const CONNECTION_NOUN = 'affiliations?|connections?|relationships?|relations?|ties|associations?|involvement'
const PAST_AND_NOW = 'build|built|make|made|create|created|develop|developed|found|founded|design|designed|write|wrote|own|owned|run|ran|maintain|maintained|launch|launched|start|started'

const FIRST_NOT = String.raw`(?:i|we)(?:['’](?:m|re|ve)\s+(?:not|never)|\s+(?:am|are|was|were|have|had|do|did|does|could|would|can|will)\s+(?:not|never)|\s+(?:are|were|have|had|do|did|does|could|would|should|was|is)n['’]t|\s+can['’]t|\s+won['’]t|\s+ain['’]t|\s+never)`
// Up to four words between the negation and what it denies; not across a pronoun or "sure", which start another thought (I'm not sure I built it).
const BETWEEN = String.raw`(?:\s+(?!(?:i|we|if|whether|sure|that|because|since)\b)\p{L}+){0,4}?`

/** What a login of the product cannot say. Each pattern is tested on one clause. */
const DENIALS: RegExp[] = [
  // no affiliation, no connection to it, without any ties, no conflict of interest, no financial interest
  words(String.raw`(?:no|zero|without(?:\s+any)?|not\s+any|nothing)\s+(?:\p{L}+\s+){0,2}?(?:${CONNECTION_NOUN})(?!\s+between)`),
  words(String.raw`no\s+(?:conflicts?\s+of\s+interest|(?:financial|commercial|vested|material)\s+(?:interest|stake))`),
  words(String.raw`(?:affiliation|connection|relationship|conflicts?\s+of\s+interest)\s*:\s*(?:none|no|nil|n/a|nothing)`),
  // not affiliated, not in any way connected with it, never paid by them
  words(String.raw`(?:not|never|n['’]t)\s+(?:\p{L}+\s+){0,3}?(?:affiliated|associated|sponsored|partnered|compensated|employed\s+(?:by|at)|connected\s+(?:to|with)|paid\s+(?:by|to|for))`),
  words(String.raw`(?:un|non-?)affiliated|independent(?:ly)?\s+(?:of|from)|nothing\s+to\s+do\s+with|no\s+relation(?:ship)?\s+(?:to|with)|in\s+no\s+way\s+(?:\p{L}+\s+){0,2}?(?:affiliated|associated|connected|related|sponsored)`),
  // this is not an ad, not a shill, not self-promotion
  words(String.raw`(?:not|isn['’]t)\s+(?:an?\s+)?(?:ad|advert|advertisement|promotion|promo|shill|sponsored(?:\s+(?:post|content))?|self[- ]?promo\w*|shameless\s+(?:plug|promo))`),
  // just a happy user (but "not just a user" is the opposite)
  words(String.raw`(?<!not\s)(?:just|only|simply|merely)\s+(?:an?\s+)?(?:\p{L}+\s+){0,2}?(?:user|customer|client|fan|subscriber)`),
  // I'm not the developer behind it, I haven't built it, we are not part of the team, I don't work for them
  words(
    String.raw`${FIRST_NOT}${BETWEEN}\s+(?:${ROLE_NOUN}|team|staff|employees?|owners?|members?|part\s+of|behind|involved|affiliated|associated|sponsored|work(?:ing)?\s+(?:on|at|for)|(?:${PAST_AND_NOW})\b)`
  ),
  // Russian
  words(
    String.raw`не\s+(?:\p{L}+\s+){0,2}?(?:связан\p{L}*|аффилирован\p{L}*|спонсир\p{L}*|имею\s+отношения|имеем\s+отношения|состою|являюсь|разработчик\p{L}*|создател\p{L}*|автор\p{L}*|основател\p{L}*|владел\p{L}*|сотрудник\p{L}*|работаю|работаем|делал\p{L}*|создавал\p{L}*|писал\p{L}*|реклам\p{L}*)`
  ),
  words(String.raw`(?:нет|без|никакой|никакого|никаких)\s+(?:\p{L}+\s+){0,2}?(?:аффилиаци\p{L}*|связ\p{L}*|отношени\p{L}*)`),
  words(String.raw`ничего\s+общего|независим\p{L}*\s+от|(?<!не\s)(?:просто|обычный|рядовой|простой)\s+(?:\p{L}+\s+){0,2}?(?:пользовател\p{L}*|клиент\p{L}*|фанат\p{L}*)`)
]

/** What a denial is about: another named thing ("not affiliated with Reddit") or nothing in particular. */
const ABOUT_OTHER = /^\s*(?:with|to|of|by|for|from|behind|at|с|со|от|у)\s+(?:the\s+)?\p{Lu}/u

/**
 * 'bare' when some clause denies a connection without naming anything else it is about, 'named' when every denial there is is about
 * something named ("not affiliated with Reddit"), null when there is none.
 */
function denialIn(content: DisclosureContent, product: Product): 'bare' | 'named' | null {
  let found: 'bare' | 'named' | null = null
  for (const clause of clausesIn(content)) {
    for (const pattern of DENIALS) {
      for (const { tail } of matchesOf(pattern, clause)) {
        const other = ABOUT_OTHER.test(tail) && afterProduct(tail.replace(/^\s*\S+\s+/, ''), product) === null
        if (!other) return 'bare'
        found = 'named'
      }
    }
  }
  return found
}

const isDenial = (clause: string): boolean => DENIALS.some((p) => p.test(clause))

// ───────────────────────── "I am connected with it" ─────────────────────────

const FIRST_BE = "(?:i|we)(?:['’]m|['’]re|\\s+am|\\s+are)"
// Up to two words inside a role ("the lead mobile developer"); never a negation.
const SHAPE = '(?:(?!(?:not|never|no)(?![\\p{L}\\p{N}]))\\p{L}+\\s+){0,2}?'
const SHAPE_RU = '(?:(?!(?:не|нет|ни)(?![\\p{L}\\p{N}]))\\p{L}+\\s+){0,2}?'

/** Labels that disclose by themselves. */
const LABELS: RegExp[] = [
  words('disclosure|disclaimer|full disclosure|conflict of interest|self[- ]?promo(?:tion|tional)?|shameless (?:plug|promo)|full transparency|affiliation\\s*:'),
  words(`${FIRST_BE}\\s+(?:\\p{L}+\\s+){0,2}?affiliated`),
  words('раскрытие информации|дисклеймер|аффилиаци[яи]|заинтересованн\\p{L}*|на правах рекламы|это реклама')
]

interface Role {
  pattern: RegExp
  /** The statement is about something: it counts only when that something is the product. */
  object: boolean
}

const ROLES: Role[] = [
  // I'm the developer, we are the team, I'm one of the makers (of it)
  { pattern: words(`${FIRST_BE}\\s+(?:the|one of the|part of the|on the|in the)\\s+${SHAPE}(?:${ROLE_NOUN}|team|staff)`), object: false },
  // I'm a founder of ..., we are developers behind ..., I'm a solo dev
  { pattern: words(`${FIRST_BE}\\s+(?:an?\\s+)?${SHAPE}(?:${ROLE_NOUN}|member)\\s+(?:of|behind|at|for|on)`), object: true },
  { pattern: words(`${FIRST_BE}\\s+(?:an?\\s+)?(?:solo|indie)\\s+(?:${ROLE_NOUN})`), object: false },
  // I'm one of the people behind it
  { pattern: words(`${FIRST_BE}\\s+(?:one of|part of|among)\\s+the\\s+(?:team|people|folks|guys|girls|devs?|developers?|makers?|creators?|founders?)\\s+behind`), object: true },
  // As the founder of ..., as one of the makers behind ...
  { pattern: words(`as\\s+(?:the|one of the)\\s+${SHAPE}(?:${ROLE_NOUN})\\s+(?:of|behind)`), object: true }
]

const ROLES_RU: RegExp[] = [
  words(`я\\s+(?:один из\\s+)?${SHAPE_RU}(?:разработчик\\p{L}*|создател\\p{L}*|автор\\p{L}*|основател\\p{L}*|владел\\p{L}*|дизайнер\\p{L}*|программист\\p{L}*)`),
  words('мы\\s+(?:команда|разработчики|создатели|авторы)')
]

const ACTION_AUX = "(?:['’](?:ve|d)|\\s+(?:have|had))?"
const ACTION_ADVERB = '(?:(?:just|recently|also|originally|personally|actually|myself|ourselves)\\s+)?'
/** A first-person action; it discloses only when its object is the product (it names it, or says "it", "this", "the app"). */
const ACTIONS: RegExp[] = [
  words(
    `(?:i|we)${ACTION_AUX}\\s+${ACTION_ADVERB}(?:built|made|created|developed|founded|co-?founded|launched|designed|wrote|written|started|coded|programmed|maintain|build|make|create|develop|design|code|work(?:s|ed)?\\s+(?:on|at|for))`
  ),
  words("(?:i|we)(?:['’](?:m|re)|\\s+(?:am|are))\\s+(?:(?:currently|now|still|also|actively)\\s+)?(?:working\\s+(?:on|at|for)|building|developing|maintaining)")
]
const ACTIONS_RU: RegExp = words(
  '(?:я|мы)\\s+(?:(?:сам|сама|сами|недавно|тоже)\\s+)?(?:разработал[аи]?|создал[аи]?|сделал[аи]?|запустил[аи]?|основал[аи]?|написал[аи]?|делаю|делаем|создаю|создаём|создаем|разрабатываю|разрабатываем|работаю(?:\\s+(?:над|в|на))?|работаем(?:\\s+(?:над|в|на))?)'
)

const GENERIC_NOUN = 'apps?|applications?|tools?|products?|sites?|websites?|services?|projects?|platforms?|software|games?|extensions?|plugins?|librar(?:y|ies)|startups?|compan(?:y|ies)'
const GENERIC_OBJECT = new RegExp(`^(?:(?:the|this|that)\\s+(?:\\p{L}+\\s+)?(?:${GENERIC_NOUN})|it|this|that|them)${NOT_LETTER_AFTER}`, 'iu')
const GENERIC_OBJECT_RU = /^(?:этот|эту|это|этого|этим|этом|его|её|ее|ним|нём|нем|им)(?![\p{L}\p{N}])(?:\s+(?:приложени[ея]|продукт|сервис|проект|сайт))?/iu
// What may follow the object of "I built it" for the sentence to still be about the object itself ("I built it in a weekend",
// "I made it because ..."), and what may not ("I made it WORK in five minutes": it is something else that was made).
const THEN_ENDS = new RegExp(
  `^(?:$|[.!?…)"'”’\\]—–]|['’]s${NOT_LETTER_AFTER}|(?:i|we|you|they|he|she|it|my|our|and|but|so|because|since|in|on|at|with|for|from|over|during|using|after|before|as|to|by|when|while|until|of|last|a|an|the|myself|ourselves|alone|solo|together|originally|recently|just|also|ago|years?|months?|weeks?|days?|two|three|four|five|six|seven|eight|nine|ten|\\d+|${GENERIC_NOUN})${NOT_LETTER_AFTER})`,
  'iu'
)

/** The product used as a tool or a material ("built my site using Natal Mystic"): then "it", "this site" are what was built with it. */
const AS_A_TOOL = /(?:using|with|via|through|on top of|around|based on|powered by|thanks to|in|from|используя|с помощью|через|на основе|на базе)\s+/giu
function usedAsATool(clause: string, product: Product): boolean {
  for (const { tail } of matchesOf(AS_A_TOOL, clause)) if (afterProduct(tail, product) !== null) return true
  return false
}

/** Whether `rest`, what follows a verb or a role, starts with the product itself and goes on as a statement about it. */
function objectIsProduct(rest: string, product: Product, clause: string): boolean {
  const named = afterProduct(rest, product)
  if (named !== null) return THEN_ENDS.test(named.trimStart())
  const generic = GENERIC_OBJECT.exec(rest.trimStart())
  return generic !== null && THEN_ENDS.test(rest.trimStart().slice(generic[0].length).trimStart()) && !usedAsATool(clause, product)
}

function objectIsProductRu(rest: string, product: Product, clause: string): boolean {
  if (afterProduct(rest, product) !== null) return true
  return GENERIC_OBJECT_RU.test(rest.trimStart()) && !usedAsATool(clause, product)
}

// "my app", "our product": a possessive is the product only when it says so (apposition, copula) or is the subject of a clause that does
// not name the product some other way. "my site", "my business" are never it: they are what a customer has.
const OWN_NOUN = 'apps?|products?|startups?|compan(?:y|ies)|brainchild|creations?|software|platforms?|services?|extensions?|plugins?|librar(?:y|ies)|games?|brands?|projects?'
const OWN_SUBJECT_NOUN = /^(?:apps?|products?|startups?|compan(?:y|ies)|brainchild|creations?|software|platforms?|extensions?|plugins?|brands?)$/i
const POSSESSIVE = words(`(?:my|our)\\s+(?:(?:own|little|small|new|side|first|latest|current|personal)\\s+)?(${OWN_NOUN})`)
const COPULA_BEFORE = /(?:^|[^\p{L}\p{N}])(?:it|this|that)(?:['’]s|\s+is|\s+was|\s+has\s+been)\s*(?:(?:actually|really|just|also|still)\s+)?$/iu
const COPULA_STRIP = /\s*(?:['’]s|\s+is|\s+was|\s+has\s+been|\s+[—–-])\s*(?:(?:actually|really|just|also|still)\s+)?$/iu
const APPOSITION = /^\s*(?:(?:called|named|titled|is|=)\s+)?/iu
const POSSESSIVE_RU = words(
  '(?:мо[йяеёи]|мою|наш[аеиу]?|нашу|наше)\\s+(?:\\p{L}+\\s+)?(приложени[ея]|продукт|проект|сервис|стартап|компания|разработка|игра|расширение|плагин|библиотека)'
)
const SUBJECT_RU = /^(?:приложени[ея]|продукт|стартап|компания|разработка|расширение|плагин)$/i
const COPULA_BEFORE_RU = /(?:^|[^\p{L}\p{N}])(?:это|он|она|оно)\s*[—–-]?\s*(?:это\s*)?$/iu
const COPULA_STRIP_RU = /\s*[—–-]\s*(?:это\s*)?$/u
const APPOSITION_RU = /^\s*(?:(?:под названием|называется|называется)\s+)?/iu

function possessiveNamesProduct(clause: string, product: Product, russian: boolean): boolean {
  const pattern = russian ? POSSESSIVE_RU : POSSESSIVE
  for (const { head, tail, match } of matchesOf(pattern, clause)) {
    // my app Natal Mystic, our product called Natal Mystic, my app is Natal Mystic
    const rest = tail.replace(russian ? APPOSITION_RU : APPOSITION, '')
    if (afterProduct(rest, product) !== null) return true
    // Natal Mystic is my app, it's our product
    const before = head.trimEnd()
    if ((russian ? COPULA_BEFORE_RU : COPULA_BEFORE).test(before)) return true
    if (endsWithProduct(before.replace(russian ? COPULA_STRIP_RU : COPULA_STRIP, ''), product) && before !== before.replace(russian ? COPULA_STRIP_RU : COPULA_STRIP, '')) return true
    // Our product does that too: at the start of a clause, when the clause names the product no other way (My app works with Natal Mystic is a user's).
    const atStart = before.replace(/^(?:and|so|also|well|but|и|а|ну|тоже)\s+/iu, '') === ''
    if (atStart && (russian ? SUBJECT_RU : OWN_SUBJECT_NOUN).test(match[1] ?? '') && !namesProduct(clause, product)) return true
  }
  return false
}

function claimsConnection(clause: string, product: Product): boolean {
  if (LABELS.some((p) => p.test(clause))) return true
  for (const { pattern, object } of ROLES) {
    for (const { tail } of matchesOf(pattern, clause)) {
      if (object) {
        if (objectIsProduct(tail, product, clause)) return true
      } else {
        // "I'm the developer" is about the product; "I'm the developer of a bank" is not.
        const about = /^\s*(?:of|behind|at|for|on|in|from)\s+(.*)$/isu.exec(tail)
        if (about === null || objectIsProduct(about[1] ?? '', product, clause)) return true
      }
    }
  }
  if (ROLES_RU.some((p) => p.test(clause))) return true
  for (const pattern of ACTIONS) {
    for (const { tail } of matchesOf(pattern, clause)) if (objectIsProduct(tail, product, clause)) return true
  }
  for (const { tail } of matchesOf(ACTIONS_RU, clause)) if (objectIsProductRu(tail, product, clause)) return true
  return possessiveNamesProduct(clause, product, false) || possessiveNamesProduct(clause, product, true)
}

/**
 * Whether the text says, in some clause, that its author is connected with the product it talks about. A clause that denies a
 * connection never counts, and a text that denies one anywhere does not state one.
 */
export function statesConnection(content: DisclosureContent, product: DisclosureProduct): boolean {
  const p = productOf(product)
  if (denialIn(content, p) !== null) return false
  for (const clause of clausesIn(content)) {
    if (!isDenial(clause) && claimsConnection(clause, p)) return true
  }
  return false
}

/**
 * Why this content must not be approved or sent, in words for the owner, or null. Null for every text that does not mention the
 * product and does not deny a connection, and for every text that mentions it and says the author is connected with it.
 */
export function disclosureProblem(content: DisclosureContent, product: DisclosureProduct): string | null {
  const p = productOf(product)
  const mentions = mentionsProductIn(content, product)
  const denial = denialIn(content, p)
  if (denial === 'bare' || (denial !== null && mentions)) {
    return `This text says that you are not connected with "${p.name}" ("not affiliated", "no connection", "just a user" and the like). A login that speaks for the product is connected with it, so the text must not say otherwise. Take the denial out${mentions ? ' and add a short statement of the connection (for example "Disclosure: I\'m the developer of ' + p.name + '")' : ''}, then approve it again.`
  }
  if (!mentions) return null
  if (statesConnection(content, product)) return null
  return `This text mentions "${p.name}" but does not say that you are connected with it. Add a short statement (for example "Disclosure: I'm the developer of ${p.name}" or "I work on it"), or take the mention out, then approve it again.`
}
