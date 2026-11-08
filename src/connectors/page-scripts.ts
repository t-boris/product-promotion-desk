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
}

/** Detects a CAPTCHA or a block page in the currently loaded document. Read-only. */
export function gateProbeScript(): string {
  return `(() => {
  const body = document.body;
  const text = (body ? body.innerText : '').toLowerCase();
  const title = document.title || '';
  const short = text.length < 2500; // block pages are short; long pages are normal content that may merely quote these phrases
  const captchaEl = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"], .g-recaptcha, .h-captcha, [data-sitekey], #captcha');
  const captchaText = short && /verify you are (a )?human|prove your humanity|are you a human|complete the captcha|i'm not a robot|checking your browser/.test(text);
  const challengeTitle = /just a moment|attention required|are you a robot/i.test(title);
  const blocked = short && /blocked by network security|whoa there, pardner|too many requests|rate limited/.test(text);
  return { captcha: captchaEl || captchaText || challengeTitle, blocked: blocked, title: title };
})()`
}
