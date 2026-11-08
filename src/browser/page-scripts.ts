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
