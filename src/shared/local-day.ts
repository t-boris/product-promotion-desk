// The local day a moment falls on, from the viewer's offset from UTC. The core builds the Overview's days with it and the charts
// place readings on the same days, so both must agree to the minute: one function, here.

const DAY_MS = 86_400_000

/** The local day (as the offset in minutes east of UTC puts it) a moment falls on, `YYYY-MM-DD`. */
export function localDay(at: Date | string | number, offsetMinutes: number): string {
  const ms = (at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at) + offsetMinutes * 60_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Every day from `first` to `last` inclusive, `YYYY-MM-DD`, oldest first. Empty when either is not a day or `last` is before `first`. */
export function dayRange(first: string, last: string): string[] {
  const a = Date.parse(`${first}T00:00:00.000Z`)
  const b = Date.parse(`${last}T00:00:00.000Z`)
  // Nothing runs when `last` is before `first`, or when either is not a day (a comparison with NaN is false).
  const days: string[] = []
  for (let ms = a; ms <= b; ms += DAY_MS) days.push(new Date(ms).toISOString().slice(0, 10))
  return days
}
