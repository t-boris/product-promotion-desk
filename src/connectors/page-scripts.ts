// Builders for the small scripts connectors run inside a page through BrowserPage.read().
// They return plain strings: the only dynamic parts are JSON-encoded values, never concatenated code.

export interface FetchResult {
  /** HTTP status, or 0 when the request itself failed (network error). */
  status: number
  /** Parsed JSON body, or null when the body was not JSON. */
  json: unknown
  /** Start of the body when it was not JSON, or the network error message. */
  text: string
}

/**
 * Same-origin JSON GET executed inside the logged-in page, so the account's cookies apply.
 * Only site-relative paths are accepted: a bug in a connector can therefore never send the session
 * cookies to another origin.
 */
export function fetchJsonScript(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /\s/.test(path)) {
    throw new Error(`Refusing to fetch a non site-relative path: ${path}`)
  }
  return `(async () => {
  try {
    const res = await fetch(${JSON.stringify(path)}, { credentials: 'include', headers: { Accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    return { status: res.status, json: json, text: json === null ? text.slice(0, 300) : '' };
  } catch (e) {
    return { status: 0, json: null, text: String((e && e.message) || e) };
  }
})()`
}

export interface GateProbe {
  captcha: boolean
  /** The site is throttling or blocking this client (not a login problem). */
  blocked: boolean
  title: string
  /** What made `captcha` true, in words for the owner ("" when it is false): a visible frame, the page text or the page title. */
  signal: string
}

/**
 * Detects a CAPTCHA or a block page in the currently loaded document. Read-only.
 *
 * A challenge frame counts only when a person can see it. Sites keep an invisible one (reCAPTCHA Enterprise, its small
 * badge, Turnstile) on every ordinary page, and its presence alone is not a wall: Reddit's front page has one while it
 * shows the normal feed.
 */
export function gateProbeScript(): string {
  return `(() => {
  const body = document.body;
  const text = (body ? body.innerText : '').toLowerCase();
  const title = document.title || '';
  const short = text.length < 2500; // block pages are short; long pages are normal content that may merely quote these phrases
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };
  const frame = [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"], .g-recaptcha, .h-captcha, [data-sitekey], #captcha')]
    .find((el) => shown(el) && !(el.closest && el.closest('.grecaptcha-badge')));
  const captchaText = short && /verify you are (a )?human|prove your humanity|are you a human|complete the captcha|i'm not a robot|checking your browser/.test(text);
  const challengeTitle = /just a moment|attention required|are you a robot/i.test(title);
  const blocked = short && /blocked by network security|whoa there, pardner|too many requests|rate limited/.test(text);
  const where = frame ? String((frame.getAttribute && frame.getAttribute('src')) || frame.className || frame.id || frame.tagName).replace(/^https?:\\/\\//, '').slice(0, 70) : '';
  const signal = frame ? 'a visible check on the page (' + where + ')'
    : captchaText ? 'the page asks to verify that you are human'
    : challengeTitle ? 'the page title is a check page (' + title.slice(0, 40) + ')'
    : '';
  return { captcha: signal !== '', blocked: blocked, title: title, signal: signal };
})()`
}
