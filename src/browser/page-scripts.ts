// Scripts the browser service runs inside a page. The only dynamic parts are JSON-encoded literals (selector,
// text), never concatenated code. Selectors are matched through open shadow roots too, because current web UIs
// (including Reddit's) keep their form controls inside them.

const DEEP_QUERY = `
const deepQuery = (selector, root) => {
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) {
      const found = deepQuery(selector, host.shadowRoot);
      if (found) return found;
    }
  }
  return null;
};`

export interface ActionResult {
  ok: boolean
  reason?: string
}

export function existsScript(selector: string): string {
  return `(() => {${DEEP_QUERY}
  return deepQuery(${JSON.stringify(selector)}, document) !== null;
})()`
}

/**
 * Sets the value of an input, textarea or contenteditable the way a page framework expects: focus, native value
 * setter (so React/Vue see the change), then input and change events. Verifies the value afterwards.
 */
export function fillScript(selector: string, text: string): string {
  return `(() => {${DEEP_QUERY}
  const el = deepQuery(${JSON.stringify(selector)}, document);
  if (!el) return { ok: false, reason: 'not_found' };
  if (el.disabled || el.readOnly) return { ok: false, reason: 'disabled' };
  const text = ${JSON.stringify(text)};
  el.scrollIntoView({ block: 'center' });
  el.focus();
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const proto = tag === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === text ? { ok: true } : { ok: false, reason: 'value_rejected' };
  }
  if (el.isContentEditable) {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    const flat = (s) => s.replace(/\\s+/g, ' ').trim();
    return flat(el.textContent || '').includes(flat(text).slice(0, 60)) ? { ok: true } : { ok: false, reason: 'value_rejected' };
  }
  return { ok: false, reason: 'not_editable' };
})()`
}

export function clickScript(selector: string): string {
  return `(() => {${DEEP_QUERY}
  const el = deepQuery(${JSON.stringify(selector)}, document);
  if (!el) return { ok: false, reason: 'not_found' };
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'disabled' };
  el.scrollIntoView({ block: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
  }
  el.click();
  return { ok: true };
})()`
}

/** Evaluates to the file input element itself (for Runtime.evaluate with returnByValue: false). */
export function fileInputScript(selector: string): string {
  return `(() => {${DEEP_QUERY}
  const el = deepQuery(${JSON.stringify(selector)}, document);
  return el && el.tagName === 'INPUT' && el.type === 'file' ? el : null;
})()`
}

/** The same, for a labelled element of the snapshot: the label is checked, so a selector can never get in. */
export function fileInputByRefScript(ref: string): string {
  return `(() => {${DEEP_QUERY}
  const el = deepQuery(${refSelector(ref)}, document);
  return el && el.tagName === 'INPUT' && el.type === 'file' ? el : null;
})()`
}

export function describeFailure(action: string, selector: string, result: ActionResult | null | undefined): Error {
  const reason = result?.reason ?? 'no_result'
  const why: Record<string, string> = {
    not_found: 'the element was not found',
    disabled: 'the element is disabled',
    not_editable: 'the element cannot be edited',
    value_rejected: 'the page did not accept the value',
    no_result: 'the page returned no result'
  }
  return new Error(`Could not ${action} "${selector}": ${why[reason] ?? reason}.`)
}

/**
 * Fills the sign-in form of the page and submits it once (DEC-014). The credentials and the allowed hosts are JSON literals.
 * The page itself checks where it is before touching a field: a top-level https page on one of the hosts, nothing else, so a
 * redirect between the check made by the caller and this script cannot send the password anywhere. It answers with a
 * status only, never with a value.
 *
 * Forms differ: one page may ask for the name and the password together, another asks for the name first and the password
 * on the next step (answered with `next_step`, and the caller runs it again). Fields are recognized by their standard
 * hints (`type`, `autocomplete`, `name`), and open shadow roots are searched too.
 */
export function signInScript(form: { username: string; password: string; hosts: string[] }): string {
  return `(() => {
  const hosts = ${JSON.stringify(form.hosts)};
  const username = ${JSON.stringify(form.username)};
  const password = ${JSON.stringify(form.password)};
  if (window.top !== window || location.protocol !== 'https:') return { status: 'wrong_host' };
  const host = location.hostname.toLowerCase();
  if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return { status: 'wrong_host' };

  const all = (selector, root) => {
    const found = [...root.querySelectorAll(selector)];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...all(selector, el.shadowRoot));
    return found;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const usable = (el) => shown(el) && !el.disabled && !el.readOnly;
  const set = (el, value) => {
    el.scrollIntoView({ block: 'center' });
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === value;
  };

  if (all('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="arkoselabs"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, [data-sitekey]', document).some(shown)) {
    return { status: 'captcha' };
  }

  const inputs = all('input', document).filter(usable);
  const pass = inputs.find((i) => i.type === 'password');
  const textual = (i) => ['text', 'email', 'tel', ''].includes(i.type) && !/search|query|captcha|otp|code|zip|postal/i.test((i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || ''));
  const named = (i) => /username|email|login|user|identifier|phone/i.test((i.autocomplete || '') + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' + i.type);
  let candidates = inputs.filter(textual);
  if (pass) {
    const scope = pass.form ? candidates.filter((i) => i.form === pass.form) : candidates;
    candidates = scope.filter((i) => i.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  const user = candidates.find(named) || candidates[candidates.length - 1];

  const submit = (container) => {
    // A form the browser itself would refuse to send (a required or malformed field) is left to the owner.
    if (container && container.checkValidity && !container.checkValidity()) return false;
    const buttons = all('button, input[type=submit], [role=button]', container || document).filter(usable);
    const label = (b) => ((b.innerText || b.value || b.getAttribute('aria-label') || '') + '').trim();
    const wanted = buttons.find((b) => b.type === 'submit' && !/google|apple|facebook|microsoft|forgot|sign ?up|register|create/i.test(label(b)))
      || buttons.find((b) => /^(log ?in|sign ?in|continue|next|submit)\\b/i.test(label(b)) && !/google|apple|facebook|microsoft/i.test(label(b)));
    if (wanted) {
      wanted.click();
    } else if (container && container.requestSubmit) {
      container.requestSubmit();
    } else {
      return false;
    }
    return true;
  };

  if (!pass) {
    if (!user || !named(user)) return { status: 'no_form' };
    if (!set(user, username)) return { status: 'no_form' };
    return { status: submit(user.form) ? 'next_step' : 'no_form' };
  }
  if (user && !set(user, username)) return { status: 'no_form' };
  if (!set(pass, password)) return { status: 'no_form' };
  return { status: submit(pass.form) ? 'submitted' : 'no_form' };
})()`
}

export interface PageReading {
  title: string
  /** The start of the readable text. */
  text: string
  /** Visible messages the site shows for a problem or a state. */
  alerts: string[]
}

/**
 * Reads what a person can read on the page: the title, the start of the text and the messages a site shows for a problem or a state
 * (alerts, live regions, error blocks). Read-only, and it never touches the value of a form field, so a typed password is not in it.
 */
export function pageReadingScript(): string {
  return `(() => {
  /* page-reading */
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
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const seen = new Set();
  const alerts = [];
  for (const el of all('[role=alert],[role=status],[aria-live=assertive],[aria-live=polite],[data-error],[class*=error i],[id*=error i]', document)) {
    if (alerts.length >= 8) break;
    if (!shown(el)) continue;
    const text = clean(el.innerText).slice(0, 200);
    if (text.length < 3 || seen.has(text)) continue;
    seen.add(text);
    alerts.push(text);
  }
  return { title: clean(document.title).slice(0, 120), text: clean(document.body ? document.body.innerText : '').slice(0, 1500), alerts: alerts };
})()`
}

// ───────────────────────────── Sign-up steps (DEC-017) ─────────────────────────────
// The page snapshot (src/core/channels/sign-up-page.ts) labels each interactive element with data-ppd-ref="e12". A step names that
// label, never a selector. The scripts below only find the element and read or set it; the real click and the real keystrokes
// are sent by the browser itself (see ElectronRawPage.pageStep), because a site tells a person's input from a script's.

const REF = /^e\d{1,4}$/

/** The label of a snapshot element as a selector. Throws for anything that is not a label, so a selector can never get in. */
function refSelector(ref: string): string {
  if (!REF.test(ref)) throw new Error(`Not an element label: ${ref}`)
  return JSON.stringify(`[data-ppd-ref="${ref}"]`)
}

const FIND_REF = (ref: string): string => `${DEEP_QUERY}
  const el = deepQuery(${refSelector(ref)}, document);
  if (!el) return { ok: false, reason: 'not_found' };`

export interface LocatedElement {
  ok: boolean
  reason?: 'not_found'
  x?: number
  y?: number
  /** A click at x, y reaches the element (nothing else covers it). */
  hit?: boolean
  /** The centre of the element is on the screen now (inside the window, with a small margin): a person clicks what they can see. */
  inView?: boolean
  /** The size of the window's page area, so a scroll can aim for the middle of it. */
  vw?: number
  vh?: number
  disabled?: boolean
  tag?: string
}

/**
 * Where the element's centre is, without moving the page: a person scrolls with the wheel to what is off the screen (`scrollTo` in the step
 * runner), and only a page that does not scroll that way is made to (`scrollIntoViewScript`).
 */
export function locateScript(ref: string): string {
  return `(() => {${FIND_REF(ref)}
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const vw = window.innerWidth, vh = window.innerHeight;
  const inView = x >= 8 && x <= vw - 8 && y >= 8 && y <= vh - 8;
  // What is on top at the point is found through the shadow roots down to the element the pointer would meet (a dialog drawn in a shadow root answers with
  // its host from the page, and the footer that covers a list in it is only seen from inside), and it must be the element, something inside it or something
  // around it (a label that wraps a radio): a box that merely sits in the same shadow root as the element does not make a click reach it.
  const within = (node, root) => { for (let c = node, n = 0; c && n < 300; n++) { if (c === root) return true; c = c.parentNode || (c.getRootNode && c.getRootNode().host) || null; } return false; };
  let top = inView ? document.elementFromPoint(x, y) : null;
  for (let i = 0; top && top.shadowRoot && i < 12; i++) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
  const hit = !!top && (top === el || within(top, el) || within(el, top));
  return { ok: true, x: x, y: y, hit: hit, inView: inView, vw: vw, vh: vh, disabled: !!el.disabled, tag: el.tagName.toLowerCase() };
})()`
}

/** The last resort for an element the wheel could not bring into view (a scroller the cursor is not over): the browser's own scroll to it. */
export function scrollIntoViewScript(ref: string): string {
  return `(() => {${FIND_REF(ref)}
  el.scrollIntoView({ block: 'center', inline: 'center' });
  return { ok: true };
})()`
}

/** How far the part of the page under a point is scrolled: the nearest scrollable box around that point, else the page itself. */
export function scrollStateScript(x: number, y: number): string {
  return `(() => {
  const scrolls = (n) => { const s = getComputedStyle(n); return /(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1; };
  for (let n = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)}); n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (scrolls(n)) return { ok: true, top: n.scrollTop, max: n.scrollHeight - n.clientHeight, inner: true, vw: window.innerWidth, vh: window.innerHeight };
  }
  const d = document.scrollingElement || document.documentElement;
  return { ok: true, top: d.scrollTop, max: d.scrollHeight - window.innerHeight, inner: false, vw: window.innerWidth, vh: window.innerHeight };
})()`
}

export interface ScrollState {
  ok: boolean
  top?: number
  max?: number
  inner?: boolean
  vw?: number
  vh?: number
}

/** Where the owner's cursor dot is now (null before it was ever shown on this document), and the size of the window. Moves nothing. */
export function cursorAtScript(): string {
  return `(() => { const at = window.__ppdCursorAt || null; return { ok: true, x: at ? at.x : null, y: at ? at.y : null, vw: window.innerWidth, vh: window.innerHeight }; })()`
}

/**
 * The cursor the owner watches: a small dot on the page that follows the real mouse (the real mouse has no pointer on the screen, since the
 * events come from the application), shrinks while pressed and fades when nothing moves it. It takes no events, and says where it was.
 */
export function cursorScript(x: number, y: number, state: 'move' | 'down' | 'up'): string {
  return `(() => {
  let c = document.getElementById('__ppd-cursor');
  if (!c) {
    c = document.createElement('div');
    c.id = '__ppd-cursor';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(225,29,72,.8);box-shadow:0 0 0 3px rgba(255,255,255,.95),0 1px 8px rgba(0,0,0,.5);pointer-events:none;z-index:2147483647;opacity:1;transition:opacity .4s ease;';
    (document.body || document.documentElement).appendChild(c);
  }
  const was = window.__ppdCursorAt || null;
  window.__ppdCursorAt = { x: ${x}, y: ${y} };
  c.style.opacity = '1';
  c.style.transform = 'translate(${x}px,${y}px) scale(${state === 'down' ? 0.6 : 1})';
  ${state === 'up' ? "c.style.boxShadow = '0 0 0 3px rgba(255,255,255,.95),0 0 0 14px rgba(225,29,72,.35)'; setTimeout(() => { c.style.boxShadow = '0 0 0 3px rgba(255,255,255,.95),0 1px 8px rgba(0,0,0,.5)'; }, 240);" : ''}
  if (window.__ppdCursorTimer) clearTimeout(window.__ppdCursorTimer);
  window.__ppdCursorTimer = setTimeout(() => { c.style.opacity = '0'; }, 5000);
  return { ok: true, x: was ? was.x : null, y: was ? was.y : null, vw: window.innerWidth, vh: window.innerHeight };
})()`
}

/** Focuses a field and selects what it holds, so the typing that follows replaces it. */
export function prepareTypingScript(ref: string): string {
  return `(() => {${FIND_REF(ref)}
  if (el.disabled || el.readOnly) return { ok: false, reason: 'disabled' };
  el.focus();
  if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } else if ('value' in el && typeof el.select === 'function') {
    el.select();
  } else {
    return { ok: false, reason: 'not_text' };
  }
  return { ok: true };
})()`
}

/**
 * Asked right before text is typed, after the window was given focus: the cursor is in the element the step named, and the page is still one of
 * `hosts`. Both are decided in the page in one pass, so the text cannot land in another field (a CAPTCHA frame, a field the page moved the focus
 * to) or on another site between the earlier checks and the keystrokes. Fails closed: anything unexpected refuses.
 */
export function typingGuardScript(ref: string, hosts: string[]): string {
  return `(() => {${FIND_REF(ref)}
  const host = location.hostname.toLowerCase();
  if (!${JSON.stringify(hosts)}.some((domain) => host === domain || host.endsWith('.' + domain))) return { ok: false, reason: 'wrong_host', host };
  let focused = document.activeElement;
  while (focused && focused.shadowRoot && focused.shadowRoot.activeElement) focused = focused.shadowRoot.activeElement;
  return focused === el ? { ok: true } : { ok: false, reason: 'not_focused' };
})()`
}

/** Whether the field now holds exactly the text (checked in the page, so the text is never sent back). */
export function typedScript(ref: string, text: string): string {
  return `(() => {${FIND_REF(ref)}
  const held = el.isContentEditable ? el.textContent : String(el.value === undefined ? '' : el.value);
  return { ok: held === ${JSON.stringify(text)} };
})()`
}

/** The fallback when real typing did not take: the native setter, then input and change, the way a framework expects. */
export function setValueScript(ref: string, text: string): string {
  return `(() => {${FIND_REF(ref)}
  if (el.disabled || el.readOnly) return { ok: false, reason: 'disabled' };
  el.focus();
  const text = ${JSON.stringify(text)};
  if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else if ('value' in el) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    return { ok: false, reason: 'not_text' };
  }
  return { ok: true };
})()`
}

/** Chooses an option of a native list by its text (a whole-text match first, then a start-of-text match). */
export function selectOptionScript(ref: string, text: string): string {
  return `(() => {${FIND_REF(ref)}
  if (!(el instanceof HTMLSelectElement)) return { ok: false, reason: 'not_a_list' };
  if (el.disabled) return { ok: false, reason: 'disabled' };
  const wanted = ${JSON.stringify(text)}.trim().toLowerCase();
  const options = [...el.options];
  const label = (o) => (o.textContent || '').trim().toLowerCase();
  const option = options.find((o) => label(o) === wanted || o.value.toLowerCase() === wanted) || options.find((o) => label(o).startsWith(wanted));
  if (!option) return { ok: false, reason: 'no_such_option' };
  el.focus();
  el.value = option.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`
}

/** The fallback for a click that a real mouse click cannot make (the tab is not drawn, or something covers the element). */
export function scriptClickScript(ref: string): string {
  return `(() => {${FIND_REF(ref)}
  if (el.disabled) return { ok: false, reason: 'disabled' };
  if (el.focus) el.focus();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  el.click();
  return { ok: true };
})()`
}

/** Starts counting the real mouse presses the page receives (a page that is not drawn receives none). Observes only. */
export function mouseWatchScript(): string {
  return `(() => {
  window.__ppdMouse = 0;
  if (!window.__ppdMouseWatched) {
    window.__ppdMouseWatched = true;
    window.addEventListener('mousedown', (event) => { if (event.isTrusted) window.__ppdMouse += 1; }, true);
  }
  return { ok: true };
})()`
}

/** Whether a real mouse press reached the page since `mouseWatchScript`. */
export function mouseSeenScript(): string {
  return `(() => ({ ok: (window.__ppdMouse || 0) > 0 }))()`
}

/**
 * After a custom drop-down was opened: finds the option with this text among the visible options (the list the drop-down controls
 * first), labels it like a snapshot element and says which label it got, so that it can be clicked.
 */
export function markOptionScript(ref: string, text: string): string {
  return `(() => {${FIND_REF(ref)}
  const wanted = ${JSON.stringify(text)}.trim().toLowerCase();
  const visible = (o) => { const r = o.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const controlled = el.getAttribute('aria-controls') ? document.getElementById(el.getAttribute('aria-controls')) : null;
  const pool = (controlled ? [...controlled.querySelectorAll('[role=option]')] : []).filter(visible);
  const options = pool.length > 0 ? pool : [...document.querySelectorAll('[role=option]')].filter(visible);
  if (options.length === 0) return { ok: false, reason: 'no_options' };
  const label = (o) => (o.innerText || o.textContent || '').trim().toLowerCase();
  const option = options.find((o) => label(o) === wanted) || options.find((o) => label(o).startsWith(wanted));
  if (!option) return { ok: false, reason: 'no_such_option', options: options.slice(0, 12).map((o) => (o.innerText || '').trim().slice(0, 30)) };
  let mark = option.getAttribute('data-ppd-ref');
  if (!mark) { window.__ppdRefCounter = (window.__ppdRefCounter || 0) + 1; mark = 'e' + window.__ppdRefCounter; option.setAttribute('data-ppd-ref', mark); }
  return { ok: true, ref: mark };
})()`
}
