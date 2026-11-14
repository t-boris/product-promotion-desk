// The disclosure of the author's connection to the product (DEC-010 §3), decided in code.
//
// A login that speaks for a product must not read as an independent user. Until now that was a rule in the prompt and a flag the model
// set about its own text; neither the approval nor the SendGate ever looked. This module reads the TEXT, whoever wrote it (the AI or the
// owner): when it mentions the product it must also say, in the author's own words, that the author is connected with it.
//
// Three decisions, all language-limited and all deliberately simple:
//  - "mentions the product": the title, the text or the link names it. The name is matched as whole words (written apart, joined,
//    hyphenated or broken with a mark: "Natal Mystic", "NatalMystic", "Natal. Mystic"), after the markup is taken out ("**Natal** Mystic",
//    "[Natal](x) Mystic"), with the look-alike letters of Cyrillic and Greek folded ("Nаtal" with a Cyrillic а), and as it sounds in the
//    other alphabet ("Натал Мистик"). A one-word name of five letters or fewer ("Pulse", "Desk") only with its own capitalisation, because
//    such a name is also an ordinary word. The website counts too: its host, in the text or as the host of the link. A website on a shared
//    host (github.com/me/tool) counts only with its path, never by the host alone. Invisible format characters (zero-width spaces and
//    joiners, soft hyphens) are removed before anything is read. What it does not find: a name with spaces between its letters, leetspeak
//    ("N4tal"), a translation of the name, a shortened link.
//  - "says it is connected": some clause is a first-person statement of connection to the product itself: a role (I'm the developer of
//    it), an action with the product as its object (I built Natal Mystic, I work on it, I run Natal Mystic), "I'm affiliated with it", or
//    it is the product that "my app" or "it's our product" names. A label (Disclosure:, Full transparency:) is not a statement, whatever
//    follows it is read; a word that merely appears is not enough: "my site", "my business", "my app was crashing", "I used it for my
//    project", "I made it work" are what a customer says. "This app" and "it" are the product only when the text has named it (or the link
//    does), not when it is named only later, and not when the clause says it was made with it ("I built this site on Natal Mystic"). A role
//    with nothing said about what it is of ("I'm the developer") counts only when the rest of the clause names nothing else. What somebody
//    else said (a block quote, a quoted first-person sentence) and what is wished or imagined ("I wish I had built it", "if I built it")
//    is not the author's statement. English, and a small Russian set. A text in another language that mentions the product is refused
//    until the owner adds one such sentence: refusing is the safe side, the sentence is short, and the owner can always write it.
//  - "denies it": "not affiliated", "no connection", "I'm not the developer", "just a happy user", "Disclosure: none", "no disclosure
//    needed" (and the Russian set). A login that speaks for a product is connected with it by construction, so a denial is never a
//    disclosure and is itself a problem: it is refused when the text mentions the product, and also when it names nobody else ("No
//    affiliation, just a user"). "Not affiliated with Reddit" in a text that does not mention the product is left alone, and does not
//    count against a statement of the connection; neither does "this is not an ad" next to one (alone it is still refused), nor "I was just
//    a user of other tools".
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

/** Letters of the Cyrillic and Greek alphabets that are drawn like a Latin letter, by that letter. */
const LOOKALIKE: Record<string, string> = Object.fromEntries(
  Object.entries({
    a: 'аα', b: 'вβ', c: 'сϲ', d: 'ԁ', e: 'еεє', h: 'нη', i: 'іιϊ', j: 'ј', k: 'кκ', l: 'ӏ', m: 'м', n: 'ν', o: 'оοσ', p: 'рρ', s: 'ѕ', t: 'тτ', u: 'υ', v: 'ѵ', x: 'хχ', y: 'уγ',
    A: 'АΑ', B: 'ВΒ', C: 'СϹ', E: 'ЕΕ', H: 'НΗ', I: 'ІΙ', J: 'Ј', K: 'КΚ', M: 'МΜ', N: 'Ν', O: 'ОΟ', P: 'РΡ', S: 'Ѕ', T: 'ТΤ', X: 'ХΧ', Y: 'УΥ', Z: 'Ζ'
  }).flatMap(([latin, others]) => [...others].map((other) => [other, latin]))
)
const foldWord = (word: string): string => [...word].map((c) => LOOKALIKE[c] ?? c).join('')

/** Every look-alike letter as the Latin one: for finding a name written with them ("Nаtal" with a Cyrillic а). */
const fold = (text: string): string => text.replace(/[\p{L}\p{M}]+/gu, foldWord)

/** The look-alikes inside a word that also has Latin letters, folded: a word of one alphabet (a Russian word) is left as it is. */
const foldMixed = (text: string): string =>
  text.replace(/[\p{L}\p{M}]+/gu, (word) => (/\p{Script=Latin}/u.test(word) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(word) ? foldWord(word) : word))

/** Folds look-alike forms and removes every invisible format character (zero-width space and joiners, BOM, soft hyphen, direction marks). */
const clean = (text: string | null | undefined): string => foldMixed((text ?? '').normalize('NFKC').replace(/\p{Cf}/gu, ''))

/** Takes the markup out of a text: link syntax ("[Natal](x) Mystic" is "Natal Mystic"), HTML tags, emphasis and code marks. */
const plain = (text: string): string =>
  text
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/<\/?[a-z][^>\n]*>/gi, '')
    .replace(/[*_~`]+/g, '')

/** A first person inside quotation marks is somebody else's sentence ("Someone said "I built it""), not a statement of the author. */
const QUOTED_SENTENCE = /"[^"\n]{1,300}"|“[^”\n]{1,300}”|«[^»\n]{1,300}»/gu
const FIRST_PERSON = /(?<![\p{L}\p{N}])(?:i|we|i['’](?:m|ve|d)|we['’](?:re|ve)|я|мы)(?![\p{L}\p{N}])/iu

/**
 * A text as the sentences below read it: markup out, what is quoted from somebody else (a block quote, a quoted sentence of a first
 * person) out. What the product's name is looked for in is not this: a mention inside a quote is still a mention.
 */
const prepare = (text: string | null | undefined): string =>
  plain(
    clean(text)
      .split('\n')
      .filter((line) => !/^\s*>/.test(line))
      .join('\n')
      .replace(QUOTED_SENTENCE, (quoted) => (FIRST_PERSON.test(quoted) ? ' ' : quoted))
  )

const CYRILLIC_TO_LATIN: Record<string, string> = Object.fromEntries(
  ['а:a', 'б:b', 'в:v', 'г:g', 'д:d', 'е:e', 'ё:e', 'ж:z', 'з:z', 'и:i', 'й:i', 'к:k', 'л:l', 'м:m', 'н:n', 'о:o', 'п:p', 'р:r', 'с:s', 'т:t', 'у:u', 'ф:f', 'х:h', 'ц:c', 'ч:c', 'ш:s', 'щ:s', 'ы:i', 'э:e', 'ю:u', 'я:a', 'ъ:', 'ь:'].map((pair) => pair.split(':') as [string, string])
)

/** A word as it sounds, roughly, in any of the two alphabets: "Натал Мистик" and "Natal Mystic" are the same two words ("natal mistik"). */
const skeleton = (word: string): string =>
  [...word.toLowerCase()]
    .map((c) => CYRILLIC_TO_LATIN[c] ?? c)
    .join('')
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/[yj]/g, 'i')
    .replace(/c/g, 'k')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
    .replace(/z/g, 's')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1')

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
  // Between the words: spaces, hyphens, and the marks a name is broken with ("Natal. Mystic", "Natal · Mystic", "Natal_Mystic").
  const forms = [build(parts.join('[\\s_.·•|/~+-]{1,3}'), NOT_LETTER_AFTER)]
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

/** The name written in the other alphabet, as it sounds ("Натал Мистик" for "Natal Mystic"): only across the two alphabets, and not for a short name. */
function soundsLikeName(text: string, product: Product): boolean {
  const cyrillic = (value: string): boolean => /\p{Script=Cyrillic}/u.test(value)
  if (product.name === '' || isCommonWordSized(product.name) || cyrillic(text) === cyrillic(product.name)) return false
  const key = (value: string): string => value.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '').map(skeleton).join(' ')
  const wanted = key(product.name)
  return wanted.length >= 5 && new RegExp(`(?:^| )${escapeRegExp(wanted)}(?: |$)`).test(key(text))
}

/**
 * Whether the title, the text or the link of the content mentions the product. The name is looked for as written, with the markup taken
 * out ("**Natal** Mystic", "[Natal](x) Mystic"), with the look-alike letters of other alphabets folded ("Nаtal" with a Cyrillic а), and
 * as it sounds in the other alphabet ("Натал Мистик"). It does not find a name that is spelled with spaces between its letters, in
 * leetspeak ("N4tal"), translated, or hidden behind a shortened link.
 */
export function mentionsProductIn(content: DisclosureContent, product: DisclosureProduct): boolean {
  const p = productOf(product)
  if (linkNamesSite(content.link, p.site)) return true
  const raw = [clean(content.title), clean(content.text)].join('\n')
  const flat = plain(raw)
  return [raw, flat, fold(flat)].some((text) => namesProduct(text, p)) || soundsLikeName(flat, p)
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

/** One clause, with what the text says before it and after it: a mention of the product in another sentence is what a pronoun can lean on. */
interface ClauseAt {
  clause: string
  sentence: string
  before: string
  after: string
}

/** Every sentence of the content as the statements are read (see `prepare`), in order, the title first. */
function sentencesIn(content: DisclosureContent): string[] {
  return [content.title, content.text].flatMap((piece) => (prepare(piece).trim() === '' ? [] : sentencesOf(prepare(piece))))
}

function* clausesIn(content: DisclosureContent): Generator<ClauseAt> {
  const sentences = sentencesIn(content)
  for (const [index, sentence] of sentences.entries()) {
    for (const clause of clausesOf(sentence)) yield { clause, sentence, before: sentences.slice(0, index).join(' '), after: sentences.slice(index + 1).join(' ') }
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
// Up to four words between the negation and what it denies; not across a pronoun, "sure" or a verb of wanting or trying, which start another
// thought (I'm not sure I built it; I didn't want to build another dashboard).
const BETWEEN = String.raw`(?:\s+(?!(?:i|we|if|whether|sure|that|because|since|want|wanted|wish|wished|need|needed|plan|planned|intend|intended|mean|meant|try|tried|like|bother|expect|expected|going|gonna|have|had|to)\b)\p{L}+){0,4}?`

interface Denial {
  pattern: RegExp
  /**
   * A text that says this and also states the connection is fine ("It isn't an ad"): it is a denial of advertising, not of the connection.
   * Without a statement of the connection it is still refused, as before.
   */
  weak?: boolean
  /** What may come before it in the clause for it not to be a denial of the author's connection now ("after being just a user of other tools"). */
  unless?: RegExp
}

/** "Just a user" is what the author was before or is not any more. */
const WAS_A_USER = words('after|before|once|formerly|previously|used\\s+to\\s+be|was|were|been|being|become|became|becoming|started\\s+as|began\\s+as|until|instead\\s+of|rather\\s+than|more\\s+than|no\\s+longer|и\\s+не|раньше|был\\p{L}*|стал\\p{L}*')

/** What a login of the product cannot say. Each pattern is tested on one clause. */
const DENIALS: Denial[] = [
  // no affiliation, no connection to it, without any ties, no conflict of interest, no financial interest
  { pattern: words(String.raw`(?:no|zero|without(?:\s+any)?|not\s+any|nothing)\s+(?:\p{L}+\s+){0,2}?(?:${CONNECTION_NOUN})(?!\s+between)`) },
  { pattern: words(String.raw`no\s+(?:conflicts?\s+of\s+interest|(?:financial|commercial|vested|material)\s+(?:interest|stake))`) },
  // no disclosure needed, nothing to disclose
  { pattern: words(String.raw`no\s+disclosures?\s+(?:is\s+|are\s+)?(?:needed|required|necessary|to\s+make)|nothing\s+to\s+disclose|no\s+(?:need|reason)\s+to\s+disclose|без\s+раскрытия`) },
  // not affiliated, not in any way connected with it, never paid by them
  { pattern: words(String.raw`(?:not|never|n['’]t)\s+(?:\p{L}+\s+){0,3}?(?:affiliated|associated|sponsored|partnered|compensated|employed\s+(?:by|at)|connected\s+(?:to|with)|paid\s+(?:by|to|for))`) },
  { pattern: words(String.raw`(?:un|non-?)affiliated|independent(?:ly)?\s+(?:of|from)|nothing\s+to\s+do\s+with|no\s+relation(?:ship)?\s+(?:to|with)|in\s+no\s+way\s+(?:\p{L}+\s+){0,2}?(?:affiliated|associated|connected|related|sponsored)`) },
  // this is not an ad, not a shill, not self-promotion
  { pattern: words(String.raw`(?:not|isn['’]t)\s+(?:an?\s+)?(?:ad|advert|advertisement|promotion|promo|shill|sponsored(?:\s+(?:post|content))?|self[- ]?promo\w*|shameless\s+(?:plug|promo))`), weak: true },
  // just a happy user (but "not just a user" is the opposite)
  { pattern: words(String.raw`(?<!not\s)(?:just|only|simply|merely)\s+(?:an?\s+)?(?:\p{L}+\s+){0,2}?(?:user|customer|client|fan|subscriber)`), unless: WAS_A_USER },
  // I'm not the developer behind it, I haven't built it, we are not part of the team, I don't work for them
  {
    pattern: words(
      String.raw`${FIRST_NOT}${BETWEEN}\s+(?:${ROLE_NOUN}|team|staff|employees?|owners?|members?|part\s+of|behind|involved|affiliated|associated|sponsored|work(?:ing)?\s+(?:on|at|for)|(?:${PAST_AND_NOW})\b)`
    )
  },
  // Russian
  {
    pattern: words(
      String.raw`не\s+(?:\p{L}+\s+){0,2}?(?:связан\p{L}*|аффилирован\p{L}*|спонсир\p{L}*|имею\s+отношения|имеем\s+отношения|состою|являюсь|разработчик\p{L}*|создател\p{L}*|автор\p{L}*|основател\p{L}*|владел\p{L}*|сотрудник\p{L}*|работаю|работаем|делал\p{L}*|создавал\p{L}*|писал\p{L}*)`
    )
  },
  { pattern: words(String.raw`не\s+(?:\p{L}+\s+){0,2}?реклам\p{L}*`), weak: true },
  { pattern: words(String.raw`(?:нет|без|никакой|никакого|никаких)\s+(?:\p{L}+\s+){0,2}?(?:аффилиаци\p{L}*|связ\p{L}*|отношени\p{L}*)`) },
  { pattern: words(String.raw`ничего\s+общего|независим\p{L}*\s+от`) },
  { pattern: words(String.raw`(?<!не\s)(?:просто|обычный|рядовой|простой)\s+(?:\p{L}+\s+){0,2}?(?:пользовател\p{L}*|клиент\p{L}*|фанат\p{L}*)`), unless: WAS_A_USER }
]

/** A label with its answer: "Disclosure: none", "Conflict of interest: no". The colon splits a sentence into clauses, so these are read on the sentence. */
const LABELLED_DENIALS: RegExp[] = [
  words(String.raw`(?:disclosures?|affiliations?|connections?|relationships?|conflicts?\s+of\s+interest|раскрытие(?:\s+информации)?|аффилиаци\p{L}*)\s*:\s*(?:none|no|nil|n/?a|nothing|not\s+applicable|нет|отсутствует|неприменимо)`)
]

/** What a denial is about: another named thing ("not affiliated with Reddit", "just a user of other tools") or nothing in particular. */
const ABOUT_OTHER = /^\s*(?:with|to|of|by|for|from|behind|at|с|со|от|у)\s+(?:the\s+)?(?:\p{Lu}|(?:other|another|various|many|several|different|older|previous|competing|similar|some)(?![\p{L}\p{N}]))/u

type DenialKind = 'bare' | 'named' | 'weak'

/** What one clause denies: 'bare' (no one in particular), 'named' (something else, "not affiliated with Reddit"), 'weak' (only that it is an ad), or null. */
function denialOfClause(clause: string, product: Product): DenialKind | null {
  let found: DenialKind | null = null
  for (const { pattern, weak, unless } of DENIALS) {
    for (const { head, tail } of matchesOf(pattern, clause)) {
      if (unless && unless.test(head)) continue
      if (weak) {
        found ??= 'weak'
        continue
      }
      const other = ABOUT_OTHER.test(tail) && afterProduct(tail.replace(/^\s*\S+\s+/, ''), product) === null
      if (!other) return 'bare'
      found = found === 'weak' || found === null ? 'named' : found
    }
  }
  return found
}

/**
 * 'bare' when some clause denies a connection without naming anything else it is about, 'named' when every denial there is is about
 * something named ("not affiliated with Reddit", "just a user of other tools"), 'weak' when what there is only denies that the text is an
 * advertisement, null when there is none.
 */
function denialIn(content: DisclosureContent, product: Product): DenialKind | null {
  let found: DenialKind | null = null
  for (const sentence of sentencesIn(content)) if (LABELLED_DENIALS.some((p) => p.test(sentence))) return 'bare'
  for (const { clause } of clausesIn(content)) {
    const kind = denialOfClause(clause, product)
    if (kind === 'bare') return 'bare'
    if (kind === 'named' || (kind === 'weak' && found === null)) found = kind
  }
  return found
}

// ───────────────────────── "I am connected with it" ─────────────────────────

const FIRST_BE = "(?:i|we)(?:['’]m|['’]re|\\s+am|\\s+are|\\s+became|\\s+become|['’]ve\\s+become|\\s+have\\s+become)"
// Up to two words inside a role ("the lead mobile developer"); never a negation.
const SHAPE = '(?:(?!(?:not|never|no)(?![\\p{L}\\p{N}]))\\p{L}+\\s+){0,2}?'
const SHAPE_RU = '(?:(?!(?:не|нет|ни)(?![\\p{L}\\p{N}]))\\p{L}+\\s+){0,2}?'

// A label is not a statement: "Disclosure: none", "Disclosure: I use it daily", "Full transparency: I love it" are labels with something else
// after them, and what is after them is what is read. Nothing here counts for being near one.

interface Role {
  pattern: RegExp
  /** The statement is about something: it counts only when that something is the product. */
  object: boolean
}

/** Up to two words between "have" and the thing had, none of which takes it away: "I have no stake", "hardly any interest", "zero ties". */
const NEGATION_WORD = 'no|not|zero|without|hardly|barely|scarcely|never|none|nothing|little|neither|nor'
const NOT_NEGATED = `(?:(?!(?:${NEGATION_WORD})(?![\\p{L}\\p{N}]))\\p{L}+\\s+){0,2}?`

const CONNECTED_WITH = '(?:connected|affiliated|associated|involved|employed|partnered)\\s+(?:with|to|by|at|in)'

const ROLES: Role[] = [
  // I'm the developer, we are the team, I'm one of the makers (of it)
  { pattern: words(`${FIRST_BE}\\s+(?:the|one of the|part of the|on the|in the)\\s+${SHAPE}(?:${ROLE_NOUN}|team|staff)`), object: false },
  // I'm a founder of ..., we are developers behind ..., I'm a solo dev
  { pattern: words(`${FIRST_BE}\\s+(?:an?\\s+)?${SHAPE}(?:${ROLE_NOUN}|member)\\s+(?:of|behind|at|for|on)`), object: true },
  { pattern: words(`${FIRST_BE}\\s+(?:an?\\s+)?(?:solo|indie)\\s+(?:${ROLE_NOUN})`), object: false },
  // I'm one of the people behind it
  { pattern: words(`${FIRST_BE}\\s+(?:one of|part of|among)\\s+the\\s+(?:team|people|folks|guys|girls|devs?|developers?|makers?|creators?|founders?)\\s+behind`), object: true },
  // As the founder of ..., as one of the makers behind ...
  { pattern: words(`as\\s+(?:the|one of the)\\s+${SHAPE}(?:${ROLE_NOUN})\\s+(?:of|behind)`), object: true },
  // I'm connected with ..., I'm affiliated with ...
  { pattern: words(`${FIRST_BE}\\s+(?:(?:closely|personally|directly|professionally|financially|also|currently|officially)\\s+)?${CONNECTED_WITH}`), object: true },
  // I have a connection with ..., we have a financial interest in ... ("I have no stake in it", "hardly any interest in it" say the opposite)
  { pattern: words(`(?:i|we)\\s+(?:have|hold)\\s+(?:an?\\s+)?${NOT_NEGATED}(?:affiliation|connection|relationship|ties|interest|stake)\\s+(?:with|to|in)`), object: true }
]

const ROLE_RU = words(`я\\s+(?:один из\\s+)?${SHAPE_RU}(?:разработчик\\p{L}*|создател\\p{L}*|автор\\p{L}*|основател\\p{L}*|владел\\p{L}*|дизайнер\\p{L}*|программист\\p{L}*)`)
const TEAM_RU = words('мы\\s+(?:команда|разработчики|создатели|авторы)')
const ROLES_RU_OBJECT: RegExp = words('(?:я|мы)\\s+(?:тесно\\s+|лично\\s+)?(?:связан\\p{L}*|аффилирован\\p{L}*)\\s+с')

const ACTION_AUX = "(?:['’](?:ve|d)|\\s+(?:have|had))?"
const ACTION_ADVERB = '(?:(?:just|recently|also|originally|personally|actually|myself|ourselves)\\s+)?'
/** A first-person action; it discloses only when its object is the product (it names it, or says "it", "this", "the app"). */
const ACTIONS: RegExp[] = [
  words(
    `(?:i|we)${ACTION_AUX}\\s+${ACTION_ADVERB}(?:built|made|created|developed|founded|co-?founded|launched|designed|wrote|written|started|coded|programmed|maintain|build|make|create|develop|design|code|work(?:s|ed)?\\s+(?:on|at|for))`
  ),
  words("(?:i|we)(?:['’](?:m|re)|\\s+(?:am|are))\\s+(?:(?:currently|now|still|also|actively)\\s+)?(?:working\\s+(?:on|at|for)|building|developing|maintaining)")
]
/** Ownership: only of the product by name ("I run Natal Mystic"). "I run it every day" is what a customer says, and "I own it" what anybody says. */
const OWNERSHIP = words(`(?:i|we)${ACTION_AUX}\\s+${ACTION_ADVERB}(?:run|runs|own|owns|co-?own|operate|manage|lead)`)
const ACTIONS_RU: RegExp = words(
  '(?:я|мы)\\s+(?:(?:сам|сама|сами|недавно|тоже)\\s+)?(?:разработал[аи]?|создал[аи]?|сделал[аи]?|запустил[аи]?|основал[аи]?|написал[аи]?|делаю|делаем|создаю|создаём|создаем|разрабатываю|разрабатываем|работаю(?:\\s+(?:над|в|на))?|работаем(?:\\s+(?:над|в|на))?)'
)

/**
 * Words before a statement that make it something other than a fact about the author: a wish, a condition, a plan, a doubt ("I wish I had
 * built it", "if I built it", "I would like to build it"). Read on what is before the statement in its clause.
 */
const HYPOTHETICAL = words(
  'wish(?:ed|es)?|if|imagine|suppose|pretend|dream(?:ed|t|s)?|hope(?:d|s)?|hoping|would|could|might|may|should|plan(?:s|ned|ning)?\\s+to|want(?:s|ed)?\\s+to|like\\s+to|going\\s+to|gonna|someday|one\\s+day|thinking\\s+(?:of|about)|thought\\s+about|as\\s+if|unless|supposed\\s+to|wonder(?:ed|ing)?|whether|ever|если\\s+бы|хотел\\p{L}*|мечта\\p{L}*|жаль|представь\\p{L}*|вдруг'
)

const GENERIC_NOUN = 'apps?|applications?|tools?|products?|sites?|websites?|services?|projects?|platforms?|software|games?|extensions?|plugins?|librar(?:y|ies)|startups?|compan(?:y|ies)'
const GENERIC_OBJECT = new RegExp(`^(?:(?:the|this|that)\\s+(?:\\p{L}+\\s+)?(?:${GENERIC_NOUN})|it|this|that|them)${NOT_LETTER_AFTER}`, 'iu')
const GENERIC_OBJECT_RU = /^(?:этот|эту|это|этого|этим|этом|его|её|ее|ним|нём|нем|им)(?![\p{L}\p{N}])(?:\s+(?:приложени[ея]|продукт|сервис|проект|сайт))?/iu
// What may follow the object of "I built it" for the sentence to still be about the object itself ("I built it in a weekend",
// "I made it because ..."), and what may not ("I made it WORK in five minutes": it is something else that was made). A dash, a bar or a
// bullet after the name is a separator, not a word that goes on with the name ("I built Natal Mystic - a free tool").
const THEN_ENDS = new RegExp(
  `^(?:$|[.!?…)"'”’\\]—–|•·~]|-(?=\\s)|['’]s${NOT_LETTER_AFTER}|(?:i|we|you|they|he|she|it|my|our|and|but|so|because|since|in|on|at|with|for|from|over|during|using|after|before|as|to|by|when|while|until|of|last|a|an|the|myself|ourselves|alone|solo|together|originally|recently|just|also|ago|years?|months?|weeks?|days?|two|three|four|five|six|seven|eight|nine|ten|\\d+|out|back|free|open|public|available|again|first|initially|mostly|entirely|completely|fully|almost|nearly|partly|largely|late|early|today|yesterday|now|then|already|about|around|through|without|within|into|under|upon|via|${GENERIC_NOUN})${NOT_LETTER_AFTER})`,
  'iu'
)
/**
 * After "I run" and "I own" the name must end the statement: a customer says "I run Natal Mystic and love it", "... with Docker", "... from my
 * laptop", "... because it is fast". It ends with the sentence or a separator, with "together" or "alone" that ends it, or goes on with a
 * verb of the one who makes or runs it ("and maintain it"), never with a word that is not a verb of that kind ("and love it", "and Docker").
 */
const OWNER_VERB = 'maintain|build|built|develop|design|writ|wrote|cod|ship|operat|manag|found|creat|launch|mak|made|lead|own|host|sell|fund|publish|deploy|releas|updat|moderat|handl'
const STATEMENT_END = String.raw`(?:$|[.!?…,;:)"'”’\]—–|•·~]|-(?=\s))`
const OWNERSHIP_ENDS = new RegExp(
  `^(?:${STATEMENT_END}|(?:together|alone|solo|myself|ourselves)(?=\\s*${STATEMENT_END})|and\\s+(?:(?:also|then|still)\\s+)?(?:${OWNER_VERB})(?:e|es|ed|ing|s|d)?${NOT_LETTER_AFTER})`,
  'iu'
)

/** The product used as a tool or a material ("built my site using Natal Mystic"): then "it", "this site" are what was built with it. */
const AS_A_TOOL =
  /(?:using|with|via|through|on top of|around|based on|powered by|thanks to|in|from|on|for|at|inside|within|alongside|upon|atop|into|used|используя|с помощью|через|на основе|на базе|на|для|в|во|внутри)\s+/giu
function usedAsATool(clause: string, product: Product): boolean {
  for (const { tail } of matchesOf(AS_A_TOOL, clause)) if (afterProduct(tail, product) !== null) return true
  return false
}

/** Where the product is named, as far as a pronoun can lean on it. */
interface Context {
  /** The product is named in this sentence or before it, or by the link. */
  named: boolean
  /** The product is named only in a later sentence: "I built this app last year. Natal Mystic is great" speaks of something else first. */
  laterOnly: boolean
}

/** Whether `rest`, what follows a verb or a role, starts with the product itself and goes on as a statement about it. */
function objectIsProduct(rest: string, product: Product, clause: string, context: Context): boolean {
  const named = afterProduct(rest, product)
  if (named !== null) return THEN_ENDS.test(named.trimStart())
  const generic = GENERIC_OBJECT.exec(rest.trimStart())
  return generic !== null && THEN_ENDS.test(rest.trimStart().slice(generic[0].length).trimStart()) && !usedAsATool(clause, product) && !context.laterOnly
}

function objectIsProductRu(rest: string, product: Product, clause: string, context: Context): boolean {
  if (afterProduct(rest, product) !== null) return true
  return GENERIC_OBJECT_RU.test(rest.trimStart()) && !usedAsATool(clause, product) && !context.laterOnly
}

/**
 * A role with nothing said about what it is of ("I'm the developer") counts when nothing else in the clause could be what it is of: the
 * rest of the clause is empty or a few words that name no other thing and not the product ("I'm the developer and I'm biased"). "I'm the
 * owner and I love Natal Mystic" and "I'm the founder and CEO of Initech" are about something else, or about nothing the text says.
 */
const OTHER_THING = words('of|at|for|in|on|from|behind|with|to|by|about|над|в|на|из|у|для')
function bareRoleStands(rest: string, product: Product): boolean {
  const t = rest.replace(/^[\s.!?…]+|[\s.!?…]+$/gu, '')
  if (t === '') return true
  return t.split(/\s+/u).length <= 5 && !OTHER_THING.test(t) && !namesProduct(t, product)
}

// "my app", "our product": a possessive is the product only when it says so: apposition ("my app Natal Mystic", "my app is Natal Mystic")
// or copula ("Natal Mystic is my app", "it's our product"). "My app was crashing" is what a customer says, and so is every other clause
// whose subject is a possessive: "my site", "my business", "our product had bugs" are never the product by being near it.
const OWN_NOUN = 'apps?|products?|startups?|compan(?:y|ies)|brainchild|creations?|software|platforms?|services?|extensions?|plugins?|librar(?:y|ies)|games?|brands?|projects?'
const POSSESSIVE = words(`(?:my|our)\\s+(?:(?:own|little|small|new|side|first|latest|current|personal)\\s+)?(${OWN_NOUN})`)
const COPULA_BEFORE = /(?:^|[^\p{L}\p{N}])(?:it|this|that)(?:['’]s|\s+is|\s+was|\s+has\s+been)\s*(?:(?:actually|really|just|also|still)\s+)?$/iu
const COPULA_STRIP = /\s*(?:['’]s|\s+is|\s+was|\s+has\s+been|\s+[—–-])\s*(?:(?:actually|really|just|also|still)\s+)?$/iu
const APPOSITION = /^\s*(?:(?:called|named|titled|is|=)\s+)?/iu
const POSSESSIVE_RU = words(
  '(?:мо[йяеёи]|мою|наш[аеиу]?|нашу|наше)\\s+(?:\\p{L}+\\s+)?(приложени[ея]|продукт|проект|сервис|стартап|компания|разработка|игра|расширение|плагин|библиотека)'
)
const COPULA_BEFORE_RU = /(?:^|[^\p{L}\p{N}])(?:это|он|она|оно)\s*[—–-]?\s*(?:это\s*)?$/iu
const COPULA_STRIP_RU = /\s*[—–-]\s*(?:это\s*)?$/u
const APPOSITION_RU = /^\s*(?:(?:под названием|называется|называется)\s+)?/iu

function possessiveNamesProduct(clause: string, product: Product, russian: boolean): boolean {
  const pattern = russian ? POSSESSIVE_RU : POSSESSIVE
  for (const { head, tail } of matchesOf(pattern, clause)) {
    // my app Natal Mystic, our product called Natal Mystic, my app is Natal Mystic
    const rest = tail.replace(russian ? APPOSITION_RU : APPOSITION, '')
    if (afterProduct(rest, product) !== null) return true
    // Natal Mystic is my app, it's our product
    const before = head.trimEnd()
    if ((russian ? COPULA_BEFORE_RU : COPULA_BEFORE).test(before)) return true
    if (endsWithProduct(before.replace(russian ? COPULA_STRIP_RU : COPULA_STRIP, ''), product) && before !== before.replace(russian ? COPULA_STRIP_RU : COPULA_STRIP, '')) return true
  }
  return false
}

/** What a statement is made of when something before it in its clause makes it a wish or a condition. */
const hypothetical = (head: string): boolean => HYPOTHETICAL.test(head)

function claimsConnection(clause: string, product: Product, context: Context): boolean {
  for (const { pattern, object } of ROLES) {
    for (const { head, tail } of matchesOf(pattern, clause)) {
      if (hypothetical(head)) continue
      if (object) {
        if (objectIsProduct(tail, product, clause, context)) return true
      } else {
        // "I'm the developer" is about the product; "I'm the developer of a bank" is not.
        const about = /^\s*(?:of|behind|at|for|on|in|from)\s+(.*)$/isu.exec(tail)
        if (about === null ? bareRoleStands(tail, product) : objectIsProduct(about[1] ?? '', product, clause, context)) return true
      }
    }
  }
  for (const { head, tail } of matchesOf(ROLES_RU_OBJECT, clause)) if (!hypothetical(head) && objectIsProductRu(tail, product, clause, context)) return true
  for (const { head, tail } of matchesOf(ROLE_RU, clause)) if (!hypothetical(head) && ruRoleStands(tail, product, context, clause)) return true
  for (const { head } of matchesOf(TEAM_RU, clause)) if (!hypothetical(head)) return true
  for (const pattern of ACTIONS) {
    for (const { head, tail } of matchesOf(pattern, clause)) if (!hypothetical(head) && objectIsProduct(tail, product, clause, context)) return true
  }
  for (const { head, tail } of matchesOf(OWNERSHIP, clause)) {
    const named = afterProduct(tail, product)
    if (!hypothetical(head) && named !== null && OWNERSHIP_ENDS.test(named.trimStart())) return true
  }
  for (const { head, tail } of matchesOf(ACTIONS_RU, clause)) if (!hypothetical(head) && objectIsProductRu(tail, product, clause, context)) return true
  return possessiveNamesProduct(clause, product, false) || possessiveNamesProduct(clause, product, true)
}

/** The same for "я разработчик ...": a role with nothing after it, or the product (or "this app") after it. */
function ruRoleStands(rest: string, product: Product, context: Context, clause: string): boolean {
  const t = rest.replace(/^[\s.!?…]+|[\s.!?…]+$/gu, '')
  return t === '' || objectIsProductRu(t, product, clause, context)
}

/** Where the product is named, for the clause of a sentence. */
function contextOf(at: ClauseAt, product: Product, linked: boolean): Context {
  const named = linked || namesProduct(`${at.before} ${at.sentence}`, product)
  return { named, laterOnly: !named && namesProduct(at.after, product) }
}

/**
 * Whether the text says, in some clause, that its author is connected with the product it talks about. A clause that denies a
 * connection never counts, and a text that denies one (not only about advertising, and not only about something else) does not state one.
 */
export function statesConnection(content: DisclosureContent, product: DisclosureProduct): boolean {
  const p = productOf(product)
  if (denialIn(content, p) === 'bare') return false
  const linked = linkNamesSite(content.link, p.site)
  for (const at of clausesIn(content)) {
    if (denialOfClause(at.clause, p) !== 'bare' && claimsConnection(at.clause, p, contextOf(at, p, linked))) return true
  }
  return false
}

/** What is wrong with the connection: the text says there is none, or it names the product and says nothing about one. */
export interface DisclosureVerdict {
  kind: 'denies' | 'unsaid'
  /** In words for the owner. */
  message: string
}

/**
 * Why this content must not be approved or sent, in words for the owner, and which of the two problems it is; null for every text that does
 * not mention the product and does not deny a connection, and for every text that mentions it and says the author is connected with it.
 */
export function disclosureVerdict(content: DisclosureContent, product: DisclosureProduct): DisclosureVerdict | null {
  const p = productOf(product)
  const mentions = mentionsProductIn(content, product)
  const denial = denialIn(content, p)
  const states = statesConnection(content, product)
  const denies = denial === 'bare' || (denial === 'weak' && !states)
  if (denies) {
    return {
      kind: 'denies',
      message: `This text says that you are not connected with "${p.name}" ("not affiliated", "no connection", "just a user" and the like). A login that speaks for the product is connected with it, so the text must not say otherwise. Take the denial out${mentions ? ' and add a short statement of the connection (for example "Disclosure: I\'m the developer of ' + p.name + '")' : ''}, then approve it again.`
    }
  }
  if (!mentions) return null
  if (states) return null
  return {
    kind: 'unsaid',
    message: `This text mentions "${p.name}" but does not say that you are connected with it. Add a short statement (for example "Disclosure: I'm the developer of ${p.name}" or "I work on it"), or take the mention out, then approve it again.`
  }
}

/** The same verdict as plain text: why this content must not be approved or sent, or null. */
export function disclosureProblem(content: DisclosureContent, product: DisclosureProduct): string | null {
  return disclosureVerdict(content, product)?.message ?? null
}
