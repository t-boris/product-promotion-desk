// When the Mac is kept from sleeping for the sake of the schedule (DEC-054), as plain arithmetic: main asks every minute and holds or
// releases the system's sleep blocker by the answer.

/** On mains power the Mac is kept awake this long before an approved item's time: an evening post still finds the Mac awake after a day away from it. */
export const AWAKE_LEAD_MAINS_MS = 12 * 60 * 60 * 1000
/** On battery only the last minutes before the time are covered, so a schedule does not drain a closed bag. */
export const AWAKE_LEAD_BATTERY_MS = 15 * 60 * 1000

export interface AwakeFacts {
  /** The owner's switch. */
  enabled: boolean
  /** Automation is paused: nothing goes out by itself, so nothing is waited for. */
  paused: boolean
  onBattery: boolean
  /** Something is being sent right now (a mission may run for minutes). */
  sending: boolean
  /** The planned times (ISO) of the items that will go out by themselves: approved, not yet sent. */
  dueTimes: readonly string[]
  /** How late an item may still go out by itself, in milliseconds. */
  graceMs: number
  nowMs: number
}

export interface AwakeDecision {
  hold: boolean
  /** The planned time (ms) the Mac is being kept awake for; null when it is not, or when it is only for a send in progress. */
  forMs: number | null
}

/**
 * Whether to keep the Mac from going to sleep now. It is kept awake while something is being sent, and from the lead time before an approved
 * item's planned time until the item has gone out or is too late to go out by itself. A closed lid still puts a laptop to sleep: this only
 * stops the idle sleep.
 */
export function awakeDecision(facts: AwakeFacts): AwakeDecision {
  if (!facts.enabled) return { hold: false, forMs: null }
  if (facts.sending) return { hold: true, forMs: null }
  if (facts.paused) return { hold: false, forMs: null }
  const lead = facts.onBattery ? AWAKE_LEAD_BATTERY_MS : AWAKE_LEAD_MAINS_MS
  const waited = facts.dueTimes
    .map((at) => Date.parse(at))
    .filter((ms) => !Number.isNaN(ms) && ms - lead <= facts.nowMs && facts.nowMs <= ms + facts.graceMs)
    .sort((a, b) => a - b)
  return waited.length > 0 ? { hold: true, forMs: waited[0] as number } : { hold: false, forMs: null }
}
