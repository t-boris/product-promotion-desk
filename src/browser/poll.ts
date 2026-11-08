export interface PollOptions {
  timeoutMs: number
  intervalMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Calls `check` until it returns true or `timeoutMs` passed. Always checks at least once. */
export async function pollUntil(check: () => Promise<boolean>, options: PollOptions): Promise<boolean> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = now()
  for (;;) {
    if (await check()) return true
    const remaining = options.timeoutMs - (now() - started)
    if (remaining <= 0) return false
    await sleep(Math.min(options.intervalMs, remaining))
  }
}

/** Rejects with `message` if `work` takes longer than `timeoutMs`. The work itself is not cancelled. */
export function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}
