// The seasonal calendar of a product (DEC-060): the dates worth preparing for, weeks ahead. Astronomical events are computed here (new and full
// moon, the Sun entering a sign, equinoxes and solstices: Meeus, "Astronomical Algorithms", the main terms, good to about a quarter of an hour);
// gift dates are a fixed list of rules; the owner's own dates are theirs. Nothing here is guessed by the AI, and what cannot be computed to
// that precision without an ephemeris (planets' retrogrades) is not offered at all.

export const CALENDAR_KINDS = ['moon', 'zodiac', 'seasons', 'gifts'] as const
export type CalendarKind = (typeof CALENDAR_KINDS)[number]
export const CALENDAR_LABEL: Record<CalendarKind, { title: string; note: string }> = {
  moon: { title: 'Moon phases', note: 'Every new and full moon, computed.' },
  zodiac: { title: 'Sign seasons', note: 'The day the Sun enters each sign of the zodiac, computed.' },
  seasons: { title: 'Equinoxes and solstices', note: 'The four turning points of the year, computed.' },
  gifts: { title: 'Gift dates', note: 'Valentine’s Day, Mother’s Day, Father’s Day, Halloween, Thanksgiving, Black Friday, Christmas and others (the dates used in the United States).' }
}

export interface SeasonalEvent {
  /** Stable for the same event: "moon:full:2026-12-24", "gift:christmas:2026", "own:<id>:2026". */
  key: string
  kind: CalendarKind | 'own'
  name: string
  /** The moment of an astronomical event; local noon of the day for a date. */
  atMs: number
}

const DAY_MS = 86_400_000
const RAD = Math.PI / 180
const sin = (deg: number): number => Math.sin(deg * RAD)
/** Julian Ephemeris Day to milliseconds of the Unix epoch. Dynamical time runs ahead of the clock by about 70 seconds in these years; that is taken off. */
const jdeToMs = (jde: number): number => (jde - 2440587.5) * DAY_MS - 70_000
const msToJd = (ms: number): number => ms / DAY_MS + 2440587.5

/** The moment of the new (phase 0) or full (phase 0.5) moon number `k` counted from the first new moon of 2000 (Meeus, ch. 49, main terms). */
export function moonPhaseMs(k: number, phase: 0 | 0.5): number {
  const kk = k + phase
  const T = kk / 1236.85
  const E = 1 - 0.002516 * T - 0.0000074 * T * T
  const M = 2.5534 + 29.1053567 * kk - 0.0000014 * T * T
  const Mp = 201.5643 + 385.81693528 * kk + 0.0107582 * T * T
  const F = 160.7108 + 390.67050284 * kk - 0.0016118 * T * T
  const O = 124.7746 - 1.56375588 * kk + 0.0020672 * T * T
  let jde = 2451550.09766 + 29.530588861 * kk + 0.00015437 * T * T
  if (phase === 0) {
    jde += -0.4072 * sin(Mp) + 0.17241 * E * sin(M) + 0.01608 * sin(2 * Mp) + 0.01039 * sin(2 * F) + 0.00739 * E * sin(Mp - M) - 0.00514 * E * sin(Mp + M) + 0.00208 * E * E * sin(2 * M) - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M) - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O)
  } else {
    jde += -0.40614 * sin(Mp) + 0.17302 * E * sin(M) + 0.01614 * sin(2 * Mp) + 0.01043 * sin(2 * F) + 0.00734 * E * sin(Mp - M) - 0.00515 * E * sin(Mp + M) + 0.00209 * E * E * sin(2 * M) - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M) - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O)
  }
  return jdeToMs(jde)
}

/** The Sun's apparent longitude in degrees, 0 to 360 (Meeus, ch. 25, low precision: about 0.01 degree). */
export function sunLongitude(ms: number): number {
  const T = (msToJd(ms + 70_000) - 2451545) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M)
  const apparent = L0 + C - 0.00569 - 0.00478 * sin(125.04 - 1934.136 * T)
  return ((apparent % 360) + 360) % 360
}

/** The moment the Sun reaches `degrees` of longitude, searched between two moments that bracket it. */
function sunReaches(degrees: number, fromMs: number, toMs: number): number {
  const off = (ms: number): number => ((sunLongitude(ms) - degrees + 540) % 360) - 180
  let lo = fromMs
  let hi = toMs
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (off(mid) < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const
const TURNS: Record<number, string> = { 0: 'March equinox', 90: 'June solstice', 180: 'September equinox', 270: 'December solstice' }

const two = (n: number): string => String(n).padStart(2, '0')
/** The local date of a moment: 2026-12-24. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
const noon = (year: number, month: number, day: number): number => new Date(year, month - 1, day, 12).getTime()
/** The `n`-th (1-based) given weekday (0 Sunday) of a month. */
const nthWeekday = (year: number, month: number, weekday: number, n: number): number => {
  const first = new Date(year, month - 1, 1).getDay()
  return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1)
}
/** Easter Sunday of the western churches (the anonymous Gregorian computus). */
export function easter(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  return { month, day: ((h + l - 7 * m + 114) % 31) + 1 }
}

/** The gift dates of a year, as rules: a fixed day, or the n-th weekday of a month. */
export function giftDates(year: number): { id: string; name: string; month: number; day: number }[] {
  const thanksgiving = nthWeekday(year, 11, 4, 4)
  const blackFriday = new Date(year, 10, thanksgiving + 1)
  const cyberMonday = new Date(year, 10, thanksgiving + 4)
  const e = easter(year)
  return [
    { id: 'new-year', name: 'New Year’s Day', month: 1, day: 1 },
    { id: 'valentines', name: 'Valentine’s Day', month: 2, day: 14 },
    { id: 'womens-day', name: 'International Women’s Day', month: 3, day: 8 },
    { id: 'easter', name: 'Easter', month: e.month, day: e.day },
    { id: 'mothers-day', name: 'Mother’s Day', month: 5, day: nthWeekday(year, 5, 0, 2) },
    { id: 'fathers-day', name: 'Father’s Day', month: 6, day: nthWeekday(year, 6, 0, 3) },
    { id: 'halloween', name: 'Halloween', month: 10, day: 31 },
    { id: 'thanksgiving', name: 'Thanksgiving', month: 11, day: thanksgiving },
    { id: 'black-friday', name: 'Black Friday', month: blackFriday.getMonth() + 1, day: blackFriday.getDate() },
    { id: 'cyber-monday', name: 'Cyber Monday', month: cyberMonday.getMonth() + 1, day: cyberMonday.getDate() },
    { id: 'christmas', name: 'Christmas', month: 12, day: 25 }
  ]
}

/** A date of the owner's own: every year on that day, or once in the year given. */
export interface OwnDate {
  id: string
  name: string
  month: number
  day: number
  /** Null: every year. */
  year: number | null
}

/** The events of the chosen calendars and the owner's own dates from `fromMs` up to (not including) `toMs`, the soonest first. */
export function eventsBetween(kinds: readonly CalendarKind[], own: readonly OwnDate[], fromMs: number, toMs: number): SeasonalEvent[] {
  const events: SeasonalEvent[] = []
  if (kinds.includes('moon')) {
    const k0 = Math.floor(((msToJd(fromMs) - 2451550.09766) / 29.530588861) - 1)
    for (let k = k0; ; k++) {
      const newMoon = moonPhaseMs(k, 0)
      if (newMoon >= toMs + DAY_MS) break
      events.push({ key: `moon:new:${localDay(newMoon)}`, kind: 'moon', name: 'New Moon', atMs: newMoon })
      const full = moonPhaseMs(k, 0.5)
      events.push({ key: `moon:full:${localDay(full)}`, kind: 'moon', name: 'Full Moon', atMs: full })
    }
  }
  if (kinds.includes('zodiac') || kinds.includes('seasons')) {
    // The Sun moves about a degree a day: each 30-degree mark is searched in a window around where the mean motion puts it.
    const startLongitude = sunLongitude(fromMs)
    const first = Math.ceil(startLongitude / 30)
    const days = (toMs - fromMs) / DAY_MS
    for (let n = first; (n * 30 - startLongitude) / 0.9856 <= days + 3; n++) {
      const guess = fromMs + ((n * 30 - startLongitude) / 0.9856) * DAY_MS
      const at = sunReaches((n * 30) % 360, guess - 4 * DAY_MS, guess + 4 * DAY_MS)
      const degrees = (n * 30) % 360
      if (kinds.includes('zodiac')) events.push({ key: `zodiac:${SIGNS[degrees / 30]!.toLowerCase()}:${localDay(at)}`, kind: 'zodiac', name: `Sun enters ${SIGNS[degrees / 30]}`, atMs: at })
      if (kinds.includes('seasons') && TURNS[degrees]) events.push({ key: `seasons:${degrees}:${localDay(at)}`, kind: 'seasons', name: TURNS[degrees] as string, atMs: at })
    }
  }
  const years = [new Date(fromMs).getFullYear(), new Date(toMs).getFullYear()]
  for (let year = years[0] as number; year <= (years[1] as number); year++) {
    if (kinds.includes('gifts')) for (const g of giftDates(year)) events.push({ key: `gift:${g.id}:${year}`, kind: 'gifts', name: g.name, atMs: noon(year, g.month, g.day) })
    for (const o of own) if (o.year === null || o.year === year) events.push({ key: `own:${o.id}:${year}`, kind: 'own', name: o.name, atMs: noon(year, o.month, o.day) })
  }
  return events.filter((e) => e.atMs >= fromMs && e.atMs < toMs).sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key))
}

/** How many days ahead of a date a post for it should be ready, by platform: search-like surfaces need weeks, feeds need days. */
export function leadDays(platform: string): number {
  return platform === 'pinterest' ? 35 : platform === 'youtube' ? 14 : 7
}
/** How far ahead the calendar shows dates: six weeks, plus the longest lead, so nothing is first seen when it is already late. */
export const LOOK_AHEAD_DAYS = 42 + 35

/** Whole local days from now to an event (0: today). */
export function daysUntil(atMs: number, nowMs: number): number {
  const day = (ms: number): number => {
    const d = new Date(ms)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS
  }
  return day(atMs) - day(nowMs)
}

/** Whether it is time to prepare for an event on a platform: its lead window is open and the day has not passed. */
export function dueNow(atMs: number, nowMs: number, platform: string): boolean {
  const days = daysUntil(atMs, nowMs)
  return days >= 0 && days <= leadDays(platform)
}
