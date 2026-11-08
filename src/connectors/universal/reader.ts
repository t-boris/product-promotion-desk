// Page scripts for reading with a profile. The script body is fixed code; the profile only supplies JSON data
// (selectors, attribute names, limits) that is interpolated as a JSON literal. Nothing from a profile is ever
// evaluated as code.

import type { FieldSpec, ItemReader } from './profile'

export interface RawItem {
  id: string
  title: string
  author: string
  body: string
  permalink: string
  time: string
  parentId: string
}

const ITEM_FIELDS = ['id', 'title', 'author', 'body', 'permalink', 'time', 'parentId'] as const

export function extractItemsScript(reader: ItemReader, limit: number): string {
  const fields: Record<string, FieldSpec | null> = {}
  for (const name of ITEM_FIELDS) fields[name] = reader[name] ?? null
  const config = { itemSelector: reader.itemSelector, fields, limit }
  return `((cfg) => {
  const pick = (root, spec) => {
    if (!spec) return '';
    const el = spec.selector ? root.querySelector(spec.selector) : root;
    if (!el) return '';
    const value = spec.attr ? el.getAttribute(spec.attr) : el.textContent;
    return (value || '').trim();
  };
  const absolute = (href) => { try { return new URL(href, location.href).href; } catch (e) { return ''; } };
  return Array.from(document.querySelectorAll(cfg.itemSelector)).slice(0, cfg.limit).map((el) => {
    const out = {};
    for (const name of Object.keys(cfg.fields)) out[name] = pick(el, cfg.fields[name]);
    out.permalink = out.permalink ? absolute(out.permalink) : '';
    return out;
  });
})(${JSON.stringify(config)})`
}

export function loginProbeScript(login: { loggedInSelector: string; identitySelector?: string; captchaSelector?: string }): string {
  return `((cfg) => {
  const loggedIn = !!document.querySelector(cfg.loggedInSelector);
  const idEl = cfg.identitySelector ? document.querySelector(cfg.identitySelector) : null;
  const captcha = !!(cfg.captchaSelector && document.querySelector(cfg.captchaSelector));
  return { loggedIn: loggedIn, identity: idEl ? (idEl.textContent || '').trim().slice(0, 100) : '', captcha: captcha };
})(${JSON.stringify(login)})`
}

/** Text of the first element matching `selector` (optionally one attribute), or null. */
export function elementTextScript(selector: string, attr?: string): string {
  return `((cfg) => {
  const el = document.querySelector(cfg.selector);
  if (!el) return null;
  const value = cfg.attr ? el.getAttribute(cfg.attr) : el.textContent;
  return (value || '').trim().slice(0, 20000);
})(${JSON.stringify({ selector, attr: attr ?? null })})`
}

export function pageTextScript(): string {
  return `(document.body ? document.body.innerText : '').slice(0, 200000)`
}

/** Visible text of elements matching `selector`; used to spot a rejection message after a submission. */
export function visibleTextScript(selector: string): string {
  return `((cfg) => Array.from(document.querySelectorAll(cfg.selector))
  .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
  .map((el) => (el.textContent || '').trim().slice(0, 200))
  .filter(Boolean))(${JSON.stringify({ selector })})`
}

/** Parses "1.2k", "3,400" or "12 members" into a number; null if no number is present. */
export function parseCount(text: string | null): number | null {
  if (!text) return null
  const match = /(\d[\d.,]*)\s*([kKmM])?/.exec(text)
  if (!match) return null
  const base = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const factor = match[2] ? (match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1
  return Math.round(base * factor)
}
