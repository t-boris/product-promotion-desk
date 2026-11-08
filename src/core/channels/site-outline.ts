// Reading a site for a profile draft (DEC-009). Everything here is READ-ONLY: a page script that describes the
// structure of the loaded document, and plain functions that check what it returned. The page content is
// UNTRUSTED: it is bounded, stripped of control characters, and only ever handed on as text for the AI to read.

import { ApiError } from '../../shared/api'

/** Most characters of outline kept per page. */
export const OUTLINE_MAX_CHARS = 20_000
const LINE_MAX_CHARS = 300

/**
 * A script for BrowserPage.read(): lists the elements of the page as indented lines
 * `tag#id.class[role=..][aria-label=..][type=..][href=/path]["short text"]`, without scripts and styles, collapsing
 * runs of identical siblings (a list of 40 topics shows two and "38 more like"). Form values are never read.
 */
export function outlineScript(): string {
  return `(() => {
  const MAX = ${OUTLINE_MAX_CHARS};
  const LINE = ${LINE_MAX_CHARS};
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'LINK', 'META', 'HEAD', 'IFRAME', 'CANVAS', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'BR', 'HR']);
  const lines = [];
  let size = 0;
  const clip = (value, n) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim().slice(0, n);
  const classes = (el) => (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 4);
  const signature = (el) => el.tagName + '|' + classes(el).join('.') + '|' + (el.getAttribute('role') || '');
  const emit = (depth, text) => {
    if (size >= MAX) return;
    const line = '  '.repeat(Math.min(depth, 14)) + text.slice(0, LINE);
    lines.push(line);
    size += line.length + 1;
  };
  const pathOf = (href) => {
    try { return new URL(href, document.baseURI || location.href).pathname.slice(0, 80); } catch (e) { return ''; }
  };
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    let out = tag;
    let marked = false;
    if (el.id) { out += '#' + clip(el.id, 40); marked = true; }
    const cls = classes(el);
    if (cls.length) { out += '.' + cls.map((c) => clip(c, 30)).join('.'); marked = true; }
    for (const name of ['role', 'aria-label', 'type', 'name', 'placeholder']) {
      const value = el.getAttribute(name);
      if (value) { out += '[' + name + '=' + clip(value, 40) + ']'; marked = true; }
    }
    const href = el.getAttribute('href');
    if (href) { out += '[href=' + pathOf(href) + ']'; marked = true; }
    for (const attr of Array.from(el.attributes || []).filter((a) => /^data-/.test(a.name)).slice(0, 4)) {
      out += '[' + clip(attr.name, 40) + '=' + clip(attr.value, 24) + ']';
      marked = true;
    }
    const field = tag === 'input' || tag === 'textarea' || tag === 'select';
    const own = field ? '' : clip(Array.from(el.childNodes || []).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '), 80);
    if (own) out += ' "' + own + '"';
    return { text: out, show: marked || own !== '' };
  };
  const walk = (el, depth) => {
    if (size >= MAX || depth > 24) return;
    if (SKIP.has(String(el.tagName).toUpperCase()) || el.hidden || el.getAttribute('aria-hidden') === 'true') return;
    const info = describe(el);
    let next = depth;
    if (info.show) { emit(depth, info.text); next = depth + 1; }
    const kids = Array.from(el.children || []);
    let i = 0;
    while (i < kids.length && size < MAX) {
      let j = i;
      while (j < kids.length && signature(kids[j]) === signature(kids[i])) j += 1;
      const shown = Math.min(j - i, 2);
      for (let k = i; k < i + shown; k += 1) walk(kids[k], next);
      if (j - i > shown) emit(next, '… ' + (j - i - shown) + ' more like ' + describe(kids[i]).text.split(' "')[0]);
      i = j;
    }
  };
  if (document.body) walk(document.body, 0);
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 400).map((a) => ({ href: String(a.href || ''), text: clip(a.textContent, 80) }));
  return { title: clip(document.title, 200), outline: lines.join('\\n'), links: links };
})()`
}

export interface PageOutline {
  title: string
  outline: string
  links: { href: string; text: string }[]
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(CONTROL, ' ').slice(0, max) : '')

/** Checks and bounds what the page script returned; anything unexpected yields null (the page is then ignored). */
export function parsePageOutline(raw: unknown): PageOutline | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as { title?: unknown; outline?: unknown; links?: unknown }
  if (typeof value.outline !== 'string') return null
  const outline = value.outline
    .split('\n')
    .map((line) => clean(line, LINE_MAX_CHARS))
    .join('\n')
    .slice(0, OUTLINE_MAX_CHARS)
  const links = Array.isArray(value.links)
    ? value.links.slice(0, 400).flatMap((link: unknown) => {
        const entry = link as { href?: unknown; text?: unknown } | null
        return typeof entry?.href === 'string' ? [{ href: clean(entry.href, 500), text: clean(entry.text, 80) }] : []
      })
    : []
  return { title: clean(value.title, 200), outline, links: links.slice(0, 400) }
}

// ───────────────────────────── Which site, which links ─────────────────────────────

/** The address as a site that can be read: http(s), no credentials, a real public host name (no IP address, no localhost). */
export function publicSite(input: unknown): { url: string; host: string } {
  const text = typeof input === 'string' ? input.trim() : ''
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ApiError('invalid_input', 'Enter the full web address of the site, for example https://forum.example.com/.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ApiError('invalid_input', 'Only http and https addresses can be read.')
  if (url.username || url.password) throw new ApiError('invalid_input', 'Addresses with a user name or password in them are not accepted.')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const labels = host.split('.')
  const last = labels[labels.length - 1]
  if (!host.includes('.') || host.startsWith('[') || host.includes(':') || /^\d+$/.test(last) || host === 'localhost' || last === 'localhost' || last === 'local' || last === 'internal') {
    throw new ApiError('invalid_input', 'Only public websites can be read: an IP address, localhost or a private network name is not accepted.')
  }
  url.hash = ''
  return { url: url.href, host }
}

/** True when two hosts are the same site (equal, or one is a subdomain of the other, as with www). */
export function sameSite(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)
}

/** Links that could change something (or end the session) just by being opened, and files that are not pages. */
const RISKY = /log\s*-?out|sign\s*-?out|signoff|delete|remove|unsubscribe|unfollow|destroy|deactivate|close[-_ ]?account|\/api\/|\bvote\b|\bflag\b|\breport\b|\bban\b|\bblock\b|[?&](action|do|op)=/i
const FILE = /\.(pdf|zip|gz|jpe?g|png|gif|webp|svg|ico|mp[34]|webm|css|js|json|xml|rss|atom|txt|csv|docx?|xlsx?)(\?|$)/i
const USEFUL: [RegExp, number][] = [
  [/\b(new|submit|create|compose|write|start)\b/i, 3],
  [/\b(thread|topic|discussion|forum|community|board|category|categories|latest|recent|comments?|reply|post|rules|guidelines)s?\b/i, 1]
]

/** Up to `limit` same-site links worth reading next (where the discussions and the compose form are), never risky ones. */
export function chooseLinks(links: { href: string; text: string }[], pageUrl: string, host: string, limit = 2): string[] {
  const here = new URL(pageUrl)
  const scored = new Map<string, number>()
  for (const link of links) {
    let target: URL
    try {
      target = new URL(link.href)
    } catch {
      continue
    }
    if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.username || target.password) continue
    if (!sameSite(target.hostname, host)) continue
    target.hash = ''
    if (target.href === here.href || (target.pathname === here.pathname && target.search === here.search)) continue
    if (target.pathname === '/' || FILE.test(target.pathname) || RISKY.test(`${target.pathname}${target.search}`) || RISKY.test(link.text)) continue
    const score = USEFUL.reduce((sum, [pattern, weight]) => sum + (pattern.test(`${target.pathname} ${link.text}`) ? weight : 0), 0)
    if (score > 0 && !scored.has(target.href)) scored.set(target.href, score)
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([href]) => href)
}
