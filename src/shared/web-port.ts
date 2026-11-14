// The port of the local web access (DEC-006). One rule for the Settings screen, the core that stores it and the server that
// listens on it, so a port that cannot work is never stored and never shown as the one in use (BUG-044).

export const DEFAULT_WEB_PORT = 47615
/** Below this the operating system reserves ports for itself. */
export const WEB_PORT_MIN = 1024
export const WEB_PORT_MAX = 65535
export const WEB_PORT_MESSAGE = `Use a port from ${WEB_PORT_MIN} to ${WEB_PORT_MAX}`

export type WebPortParse = { ok: true; port: number } | { ok: false; message: string }

/** Reads a port typed by the owner: digits only (spaces around are ignored) and from 1024 to 65535. */
export function parseWebPort(text: string): WebPortParse {
  const digits = text.trim()
  if (!/^\d{1,5}$/.test(digits)) return { ok: false, message: WEB_PORT_MESSAGE }
  const port = Number(digits)
  return port >= WEB_PORT_MIN && port <= WEB_PORT_MAX ? { ok: true, port } : { ok: false, message: WEB_PORT_MESSAGE }
}

/** The port the server uses for a stored value: the value itself, or the default when it is not a usable port (an older build stored any number). */
export function usablePort(stored: unknown): number {
  const parsed = parseWebPort(String(stored))
  return parsed.ok ? parsed.port : DEFAULT_WEB_PORT
}
