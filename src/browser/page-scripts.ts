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
