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
const MAX_VALUE = 60
const MAX_OPTIONS = 40
const MAX_TEXT = 2500
const MAX_ALERTS = 8

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
  /** Pressing it submits its form natively: a submit button of a form, an input of type submit or image. */
  submits?: boolean
  /** The form the element is in (the nearest form or role=form around it, shadow roots crossed), numbered by this look only: two elements of one look share it when they share the form. Absent when it is in none. */
  form?: number
  /** The thing (a comment or a post, Reddit's `data-fullname` like t1_abc) the element sits under, as the site marks it: the nearest marked ancestor. Absent when the page marks none. */
  parent?: string
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
  for (const el of all(selector, document)) {
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
      try { const u = new URL(el.getAttribute('href'), location.href); item.to = u.host === location.host ? u.pathname.slice(0, 40) : u.host; } catch (e) { /* not a link we can describe */ }
    }
    if (type === 'checkbox' || type === 'radio' || roleAttr === 'checkbox' || roleAttr === 'radio' || roleAttr === 'switch') item.checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
    else if ((tag === 'input' || tag === 'textarea') && type !== 'password' && type !== 'submit' && type !== 'button' && el.value) item.value = clean(el.value, ${MAX_VALUE});
    else if (tag === 'select') item.value = clean(el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent : '', ${MAX_VALUE});
    if (roleAttr === 'combobox' && tag !== 'input') { const held = clean(el.innerText, ${MAX_VALUE}); if (held && held !== name) item.value = held.replace(name, '').trim() || held; }
    if (tag === 'select') item.options = [...el.options].slice(0, ${MAX_OPTIONS}).map((o) => clean(o.textContent, 40)).filter((t) => t !== '');
    if (((tag === 'button' && el.type === 'submit' && el.form) || (tag === 'input' && (type === 'submit' || type === 'image')))) item.submits = true;
    const place = placeOf(el);
    if (place.form !== null) item.form = place.form;
    if (place.parent !== null) item.parent = place.parent;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (el.required || el.getAttribute('aria-required') === 'true') item.required = true;
    elements.push(item);
  }
  window.__ppdRefCounter = counter;

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
  return { url: location.href, title: clean(document.title, 120), text: text, alerts: alerts, humanCheck: humanCheck, elements: elements };
})()`
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

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
    if (e.submits === true) element.submits = true
    if (typeof e.form === 'number' && Number.isInteger(e.form) && e.form >= 1 && e.form <= 999) element.form = e.form
    if (typeof e.parent === 'string' && /^t\d_[a-z0-9]{1,13}$/.test(e.parent)) element.parent = e.parent
    elements.push(element)
  }
  return {
    url: str(page.url, 300),
    title: str(page.title, 120),
    text: str(page.text, MAX_TEXT),
    alerts: Array.isArray(page.alerts) ? page.alerts.slice(0, MAX_ALERTS).map((a) => str(a, 200)).filter((a) => a !== '') : [],
    humanCheck: str(page.humanCheck, 120),
    elements
  }
}

/** One line per element, the way MarkView lists them: `[e12] input:text "First name" value="Natal" (required)`. */
export function renderElements(snapshot: PageSnapshot): string {
  if (snapshot.elements.length === 0) return '(nothing to use on this page)'
  return snapshot.elements
    .map((e) => {
      let line = `[${e.ref}] ${e.role} "${e.name}"`
      if (e.to) line += ` -> ${e.to}`
      if (e.checked !== undefined) line += e.checked ? ' [checked]' : ' [unchecked]'
      if (e.value) line += ` value="${e.value}"`
      if (e.options && e.options.length > 0) line += ` options: ${e.options.join(' | ')}`
      if (e.required) line += ' (required)'
      if (e.disabled) line += ' (disabled)'
      return line
    })
    .join('\n')
}
