// The page as the AI sees it (DEC-017): every element a person could use, labelled "e12", plus what the site says. The idea and most of
// the script come from MarkView's browser snapshot (the tool the owner already works with): a label per element, so the AI points at
// "e12" instead of inventing a selector, and the application can refuse any label that is not on the page.
//
// The page text and the element names are UNTRUSTED (a site can write anything). They only ever go to a tool-free engine, fenced as
// data, and the engine's answer is checked against this snapshot before anything is done.

export const SNAPSHOT_MAX_ELEMENTS = 160
/** A list that is open shows all its options (a year list has a hundred): the first of them are enough. */
const MAX_OPTION_ELEMENTS = 70
const MAX_NAME = 80
const MAX_NEAR = 120
const MAX_VALUE = 60
const MAX_OPTIONS = 40
const MAX_TEXT = 2500
const MAX_ALERTS = 8
const MAX_HREF = 500
/** The pictures of a page that are listed: only the ones big enough to be a picture of a post (not an avatar or an icon), the ones on the screen first. */
const MAX_PICTURES = 12
/** The most posts whose numbers one snapshot lists. */
const MAX_STATS = 40
const STAT_MAX = 100_000_000
const MIN_PICTURE_WIDTH = 120
const MIN_PICTURE_HEIGHT = 90
const MAX_PICTURE_URL = 600
const MAX_PICTURE_ALT = 120

export interface SnapshotElement {
  /** "e12": the label the page carries in data-ppd-ref. */
  ref: string
  /** "input:text", "input:password", "select", "button", "link", "checkbox", "combobox", "option", "textarea", "textbox" (an editable element), ... */
  role: string
  name: string
  /** What a non-password field holds. Never set for a password field. */
  value?: string
  checked?: boolean
  disabled?: boolean
  required?: boolean
  /** The options of a plain list. */
  options?: string[]
  /** Where a link goes (path, or host for another site). */
  to?: string
  /** The whole address of a link, as the page has it (any scheme: the reader decides what it accepts). Absent for a longer one. Only the watch mission reads it (DEC-042). */
  href?: string
  /** Pressing it submits its form natively: a submit button of a form, an input of type submit or image. */
  submits?: boolean
  /** The form the element is in (the nearest form or role=form around it, shadow roots crossed), numbered by this look only: two elements of one look share it when they share the form. Absent when it is in none. */
  form?: number
  /** The thing (a comment or a post, Reddit's `data-fullname` like t1_abc) the element sits under, as the site marks it: the nearest marked ancestor. Absent when the page marks none. */
  parent?: string
  /** The element is not on the screen now (above or below the part of the page that shows): scroll to it, or click it, which scrolls by itself. */
  offscreen?: boolean
  /** For a file input: what the page says around it (the label and the heading of the dialog or form it is in), so a profile photo input is not taken for the one of a post. */
  near?: string
}

/** What a site says about one post in its own markup: how many comments it has and its score. Either may be missing. */
export interface SnapshotStat {
  href: string
  replies: number | null
  score: number | null
}

/** A picture the page shows: where the site has it (an https address) and what the page says it shows. Only the watch and research missions are shown these. */
export interface SnapshotPicture {
  src: string
  alt: string
  width: number
  height: number
  /** The picture is not on the screen now (above or below the part of the page that shows). */
  offscreen?: boolean
}

export interface PageSnapshot {
  url: string
  title: string
  text: string
  /** Visible messages the site shows for a problem or a state. */
  alerts: string[]
  /** A visible human check (CAPTCHA) on the page, described; empty when there is none. */
  humanCheck: string
  elements: SnapshotElement[]
  /** The pictures the page shows, the ones on the screen first. Absent when there are none (or the page did not say). */
  pictures?: SnapshotPicture[]
  /** The numbers the page shows for the posts on it (comments and score), where the site puts them in its markup. Absent when there are none. */
  stats?: SnapshotStat[]
  /** How far the page is scrolled (the document, not a box inside it): where the screen is on it. Absent when the page did not say. */
  scroll?: { top: number; max: number }
}

/** Read-only except for one thing: it writes data-ppd-ref on the elements it lists, so a later step can find them again. */
export function snapshotScript(): string {
  return `(() => {
  /* agent-snapshot */
  const all = (selector, root) => {
    const found = [...root.querySelectorAll(selector)];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...all(selector, el.shadowRoot));
    return found;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };
  // Where an element sits: the form around it (numbered by this look) and the thing, a comment or a post, that the site marks around it.
  const forms = new Map();
  const above = (n) => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const placeOf = (el) => {
    let form = null;
    let parent = null;
    for (let n = el, hops = 0; n && n.nodeType === 1 && hops < 80; n = above(n), hops++) {
      if (form === null && (n.tagName === 'FORM' || n.getAttribute('role') === 'form')) { if (!forms.has(n)) forms.set(n, forms.size + 1); form = forms.get(n); }
      if (parent === null) { const id = n.getAttribute('data-fullname') || ''; if (/^t\\d_[a-z0-9]{1,13}$/i.test(id)) parent = id.toLowerCase(); }
    }
    return { form: form, parent: parent };
  };
  const clean = (value, max) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
  // A site often repeats the label for screen readers ("Password Password"): the name is the text once.
  const once = (text) => { const w = text.split(' '); const h = w.length / 2; return w.length > 1 && w.length % 2 === 0 && w.slice(0, h).join(' ') === w.slice(h).join(' ') ? w.slice(0, h).join(' ') : text; };
  const selector = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=combobox],[role=option],[contenteditable=true],[onclick]';
  let counter = window.__ppdRefCounter || 0;
  const elements = [];
  let links = 0;
  let options = 0;
  // What a person sees comes first: the elements on the screen, then the rest of the page. A dialog that a site builds at the end of the page
  // would otherwise be cut off by the limit while the page's hundred links before it are all listed.
  const vw = window.innerWidth, vh = window.innerHeight;
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
  const candidates = all(selector, document);
  // An open dialog covers the page behind it: what is in it comes before what is behind it, and a file input comes first wherever it is (a site hides
  // it, with no size and no place on the screen, and a file goes into the input itself).
  const dialogs = all('[role=dialog],[aria-modal=true],dialog[open]', document).filter(shown);
  const inDialog = (el) => dialogs.some((d) => d.contains && d.contains(el));
  const isFile = (el) => el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'file';
  const front = [];
  const visible = [];
  const hidden = [];
  for (const el of candidates) (isFile(el) || (onScreen(el) && inDialog(el)) ? front : onScreen(el) ? visible : hidden).push(el);
  for (const el of [...front, ...visible, ...hidden]) {
    if (elements.length >= ${SNAPSHOT_MAX_ELEMENTS}) break;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    // A site hides its file input behind a nice button: it is listed anyway, because a file goes into the input itself.
    if (!shown(el) && !(tag === 'input' && type === 'file')) continue;
    if (tag === 'input' && type === 'hidden') continue;
    if (tag === 'a' && ++links > 25) continue;
    if (el.getAttribute('role') === 'option' && ++options > ${MAX_OPTION_ELEMENTS}) continue;
    let ref = el.getAttribute('data-ppd-ref');
    if (!ref) { ref = 'e' + (++counter); el.setAttribute('data-ppd-ref', ref); }
    const roleAttr = el.getAttribute('role');
    // A form field keeps its field role even when the site gives it another (an input with role=combobox is still typed into). An editable
    // element (an editor built on a div) is a text box, whatever its tag: the application tells a field from any other element by this.
    const editable = tag !== 'input' && tag !== 'textarea' && el.isContentEditable === true;
    const role = tag === 'input' ? 'input:' + (type || 'text') : tag === 'textarea' || tag === 'select' ? tag : editable && (!roleAttr || roleAttr === 'textbox') ? 'textbox' : roleAttr || (tag === 'a' ? 'link' : tag);
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => { const t = id && document.getElementById(id); return t ? t.innerText : ''; }).join(' ');
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const name = once(clean(el.getAttribute('aria-label') || labelledBy || label || el.innerText || el.placeholder || el.title || el.name || (type === 'submit' || type === 'button' ? el.value : ''), ${MAX_NAME}));
    const item = { ref: ref, role: role, name: name };
    if (tag === 'a') {
      try { const u = new URL(el.getAttribute('href'), location.href); item.to = u.host === location.host ? u.pathname.slice(0, 40) : u.host; if (u.href.length <= ${MAX_HREF}) item.href = u.href; } catch (e) { /* not a link we can describe */ }
    }
    if (type === 'checkbox' || type === 'radio' || roleAttr === 'checkbox' || roleAttr === 'radio' || roleAttr === 'switch') item.checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
    else if ((tag === 'input' || tag === 'textarea') && type !== 'password' && type !== 'submit' && type !== 'button' && el.value) item.value = clean(el.value, ${MAX_VALUE});
    else if (tag === 'select') item.value = clean(el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent : '', ${MAX_VALUE});
    if (roleAttr === 'combobox' && tag !== 'input') { const held = clean(el.innerText, ${MAX_VALUE}); if (held && held !== name) item.value = held.replace(name, '').trim() || held; }
    if (tag === 'select') item.options = [...el.options].slice(0, ${MAX_OPTIONS}).map((o) => clean(o.textContent, 40)).filter((t) => t !== '');
    if (((tag === 'button' && el.type === 'submit' && el.form) || (tag === 'input' && (type === 'submit' || type === 'image')))) item.submits = true;
    // A file input is usually hidden and has no name of its own: what stands around it says what it is for (a post's pictures, a profile photo).
    if (tag === 'input' && type === 'file') {
      // The nearest two containers that say something (a label or a heading): a form with no heading around the input does not hide the dialog around it.
      const says = [];
      for (let n = above(el), hops = 0; n && n.nodeType === 1 && hops < 40 && says.length < 2; n = above(n), hops++) {
        if (!n.matches || !n.matches('[role=dialog],dialog,form,section,[role=region],fieldset')) continue;
        const heading = n.querySelector ? n.querySelector('h1,h2,h3,[role=heading],legend') : null;
        const bit = [n.getAttribute('aria-label'), heading && heading.innerText].filter(Boolean).join(' ');
        if (bit) says.push(bit);
      }
      // What the site named the input in its own code (name, id) is a word of what it is for (profile_pic), and the file it takes is a hint too.
      const code = [el.getAttribute('name'), el.getAttribute('id')].filter((v) => v && /^[A-Za-z][\\w.:-]{2,40}$/.test(v)).join(' ');
      const near = clean([code, ...says, el.title].filter(Boolean).join(' '), ${MAX_NEAR});
      if (near) item.near = near;
    }
    const place = placeOf(el);
    if (place.form !== null) item.form = place.form;
    if (place.parent !== null) item.parent = place.parent;
    if (!onScreen(el) && !(tag === 'input' && type === 'file')) item.offscreen = true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (el.required || el.getAttribute('aria-required') === 'true') item.required = true;
    elements.push(item);
  }
  window.__ppdRefCounter = counter;

  // The pictures a person sees on the page (a post's own pictures, not avatars or icons): where the site has them, so the application can keep a copy.
  const pictures = [];
  const pictureUrls = new Set();
  for (const img of all('img', document)) {
    if (pictures.length >= ${MAX_PICTURES}) break;
    const r = img.getBoundingClientRect();
    if (r.width < ${MIN_PICTURE_WIDTH} || r.height < ${MIN_PICTURE_HEIGHT} || !shown(img)) continue;
    const src = img.currentSrc || img.src || '';
    if (!/^https:\\/\\//i.test(src) || src.length > ${MAX_PICTURE_URL} || pictureUrls.has(src)) continue;
    pictureUrls.add(src);
    pictures.push({ src: src, alt: clean(img.alt || img.getAttribute('aria-label') || '', ${MAX_PICTURE_ALT}), width: Math.round(img.naturalWidth || r.width), height: Math.round(img.naturalHeight || r.height), offscreen: !onScreen(img) });
  }
  pictures.sort((a, b) => Number(a.offscreen) - Number(b.offscreen));

  // What the site itself says about each post it lists: its score and how many comments it has. The count of a post is what the site says, never a guess.
  const stats = [];
  for (const el of all('shreddit-post, div.thing[data-fullname]', document)) {
    if (stats.length >= ${MAX_STATS}) break;
    const link = el.getAttribute('permalink') || el.getAttribute('data-permalink') || '';
    if (link === '') continue;
    let href = '';
    try { href = new URL(link, location.href).href; } catch (e) { continue; }
    const score = el.getAttribute('score') !== null ? el.getAttribute('score') : el.getAttribute('data-score');
    const replies = el.getAttribute('comment-count') !== null ? el.getAttribute('comment-count') : el.getAttribute('data-comments-count');
    stats.push({ href: href, score: score === null ? null : Number(score), replies: replies === null ? null : Number(replies) });
  }

  const seen = new Set();
  const alerts = [];
  for (const el of all('[role=alert],[role=status],[aria-live=assertive],[aria-live=polite],[data-error],[class*=error i],[id*=error i]', document)) {
    if (alerts.length >= ${MAX_ALERTS}) break;
    if (!shown(el)) continue;
    const text = clean(el.innerText, 200);
    if (text.length < 3 || seen.has(text)) continue;
    seen.add(text);
    alerts.push(text);
  }

  let humanCheck = '';
  for (const frame of all('iframe', document)) {
    const src = frame.getAttribute('src') || '';
    if (!/recaptcha|hcaptcha|arkoselabs|funcaptcha|captcha|challenge/i.test(src)) continue;
    if (frame.closest && frame.closest('.grecaptcha-badge')) continue;
    const r = frame.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || !shown(frame)) continue;
    humanCheck = 'a visible check frame (' + clean(src.replace(/^https?:\\/\\//, '').split('/')[0], 40) + ')';
    break;
  }
  const text = clean(document.body ? document.body.innerText : '', ${MAX_TEXT});
  if (humanCheck === '' && text.length < 600 && /verify you are (a )?human|are you a robot|not a robot|security check/i.test(text)) humanCheck = 'the page asks to prove you are human';
  const doc = document.scrollingElement || document.documentElement || { scrollTop: 0, scrollHeight: 0 };
  return { url: location.href, title: clean(document.title, 120), text: text, alerts: alerts, humanCheck: humanCheck, elements: elements, pictures: pictures, stats: stats, scroll: { top: Math.round(doc.scrollTop), max: Math.max(0, Math.round(doc.scrollHeight - window.innerHeight)) } };
})()`
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Where the screen is on the page, when the page said it in numbers. */
function scrollOf(raw: unknown): { scroll?: { top: number; max: number } } {
  if (typeof raw !== 'object' || raw === null) return {}
  const { top, max } = raw as Record<string, unknown>
  if (typeof top !== 'number' || typeof max !== 'number' || !Number.isFinite(top) || !Number.isFinite(max) || top < 0 || max < 0) return {}
  return { scroll: { top: Math.round(top), max: Math.round(max) } }
}

/** Where the screen is on the page, in words for the AI: at the top, somewhere in the middle (with how far), or at the bottom. */
export function describeScroll(snapshot: Pick<PageSnapshot, 'scroll'>): string | null {
  const scroll = snapshot.scroll
  if (!scroll) return null
  if (scroll.max <= 4) return 'The page fits on the screen: there is nothing to scroll to.'
  if (scroll.top <= 4) return 'The screen is at the top of the page. There is more below: scroll down to see it.'
  if (scroll.max - scroll.top <= 4) return 'The screen is at the bottom of the page. There is more above.'
  return `The screen is ${Math.round((scroll.top / scroll.max) * 100)}% of the way down the page. There is more above and below.`
}

/** Checks the shape of what the page returned: it is untrusted, so every field is clamped and anything odd is dropped. */
export function parseSnapshot(raw: unknown): PageSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const page = raw as Record<string, unknown>
  if (!Array.isArray(page.elements)) return null
  const elements: SnapshotElement[] = []
  for (const entry of page.elements.slice(0, SNAPSHOT_MAX_ELEMENTS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.ref !== 'string' || !/^e\d{1,4}$/.test(e.ref) || typeof e.role !== 'string') continue
    const element: SnapshotElement = { ref: e.ref, role: str(e.role, 30), name: str(e.name, MAX_NAME) }
    if (typeof e.value === 'string' && element.role !== 'input:password') element.value = str(e.value, MAX_VALUE)
    if (typeof e.checked === 'boolean') element.checked = e.checked
    if (e.disabled === true) element.disabled = true
    if (e.required === true) element.required = true
    if (Array.isArray(e.options)) element.options = e.options.slice(0, MAX_OPTIONS).map((o) => str(o, 40)).filter((o) => o !== '')
    if (typeof e.to === 'string') element.to = str(e.to, 40)
    if (typeof e.href === 'string' && e.href.length <= MAX_HREF) element.href = e.href.trim()
    if (e.submits === true) element.submits = true
    if (typeof e.form === 'number' && Number.isInteger(e.form) && e.form >= 1 && e.form <= 999) element.form = e.form
    if (typeof e.parent === 'string' && /^t\d_[a-z0-9]{1,13}$/.test(e.parent)) element.parent = e.parent
    if (typeof e.near === 'string' && e.near.trim() !== '') element.near = str(e.near, MAX_NEAR)
    if (e.offscreen === true) element.offscreen = true
    elements.push(element)
  }
  const pictures = picturesOf(page.pictures)
  const stats = statsOf(page.stats)
  return {
    url: str(page.url, 300),
    title: str(page.title, 120),
    text: str(page.text, MAX_TEXT),
    alerts: Array.isArray(page.alerts) ? page.alerts.slice(0, MAX_ALERTS).map((a) => str(a, 200)).filter((a) => a !== '') : [],
    humanCheck: str(page.humanCheck, 120),
    elements,
    ...(pictures.length > 0 ? { pictures } : {}),
    ...(stats.length > 0 ? { stats } : {}),
    ...scrollOf(page.scroll)
  }
}

/** The numbers a post shows, checked: an https address, whole numbers within reason. The page is untrusted, so anything odd is dropped, and a post with no usable number is not listed. */
function statsOf(raw: unknown): SnapshotStat[] {
  if (!Array.isArray(raw)) return []
  const stats: SnapshotStat[] = []
  const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= STAT_MAX ? value : null)
  for (const entry of raw.slice(0, MAX_STATS)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.href !== 'string' || !/^https:\/\//i.test(e.href) || e.href.length > MAX_HREF) continue
    const replies = whole(e.replies)
    const score = whole(e.score)
    if (replies === null && score === null) continue
    stats.push({ href: e.href, replies, score })
  }
  return stats
}

/** The pictures the page listed, checked: an https address of a sane length, a size, at most `MAX_PICTURES`. The page is untrusted, so anything odd is dropped. */
function picturesOf(raw: unknown): SnapshotPicture[] {
  if (!Array.isArray(raw)) return []
  const pictures: SnapshotPicture[] = []
  for (const entry of raw) {
    if (pictures.length >= MAX_PICTURES) break
    if (typeof entry !== 'object' || entry === null) continue
    const p = entry as Record<string, unknown>
    if (typeof p.src !== 'string' || !p.src.startsWith('https://') || p.src.length > MAX_PICTURE_URL || /\s/.test(p.src)) continue
    const width = typeof p.width === 'number' && Number.isFinite(p.width) ? Math.max(0, Math.round(p.width)) : 0
    const height = typeof p.height === 'number' && Number.isFinite(p.height) ? Math.max(0, Math.round(p.height)) : 0
    pictures.push({ src: p.src, alt: str(p.alt, MAX_PICTURE_ALT), width, height, ...(p.offscreen === true ? { offscreen: true } : {}) })
  }
  return pictures
}

/** The pictures as one line each, for the AI: `[p1] 640×480 "what it shows" https://…`. Only a mission that looks at posts is shown them. */
export function renderPictures(snapshot: PageSnapshot): string {
  const pictures = snapshot.pictures ?? []
  if (pictures.length === 0) return ''
  return pictures.map((p, i) => `[p${i + 1}] ${p.width}×${p.height}${p.alt ? ` "${p.alt}"` : ''} ${p.src}${p.offscreen ? ' (off screen)' : ''}`).join('\n')
}

/**
 * One line per element, the way MarkView lists them: `[e12] input:text "First name" value="Natal" (required)`. `wholeLinks` lists a link by its whole
 * address instead of its path cut short (the watch mission records and opens posts by their addresses, DEC-042).
 */
export function renderElements(snapshot: PageSnapshot, wholeLinks = false): string {
  if (snapshot.elements.length === 0) return '(nothing to use on this page)'
  return snapshot.elements
    .map((e) => {
      let line = `[${e.ref}] ${e.role} "${e.name}"`
      if (e.to) line += ` -> ${wholeLinks && e.href ? e.href : e.to}`
      if (e.checked !== undefined) line += e.checked ? ' [checked]' : ' [unchecked]'
      if (e.value) line += ` value="${e.value}"`
      if (e.options && e.options.length > 0) line += ` options: ${e.options.join(' | ')}`
      if (e.near) line += ` in "${e.near}"`
      if (e.offscreen) line += ' (off screen)'
      if (e.required) line += ' (required)'
      if (e.disabled) line += ' (disabled)'
      return line
    })
    .join('\n')
}
