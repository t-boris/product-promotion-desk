import { describe, expect, it } from 'vitest'
import { AWAKE_LEAD_BATTERY_MS, AWAKE_LEAD_MAINS_MS, awakeDecision, type AwakeFacts } from './keep-awake'

const now = Date.parse('2026-12-01T10:00:00.000Z')
const at = (minutes: number): string => new Date(now + minutes * 60_000).toISOString()
const facts = (patch: Partial<AwakeFacts> = {}): AwakeFacts => ({ enabled: true, paused: false, onBattery: false, sending: false, dueTimes: [], graceMs: 6 * 3_600_000, nowMs: now, ...patch })

describe('keeping the Mac awake for the schedule', () => {
  it('does nothing with no approved item waiting, or with the switch off', () => {
    expect(awakeDecision(facts())).toEqual({ hold: false, forMs: null })
    expect(awakeDecision(facts({ enabled: false, dueTimes: [at(5)], sending: true }))).toEqual({ hold: false, forMs: null })
  })

  it('holds from twelve hours before an item on mains power, and only fifteen minutes before on battery', () => {
    expect(awakeDecision(facts({ dueTimes: [at(11 * 60)] }))).toEqual({ hold: true, forMs: now + 11 * 3_600_000 })
    expect(awakeDecision(facts({ dueTimes: [at(13 * 60)] })).hold).toBe(false)
    expect(awakeDecision(facts({ onBattery: true, dueTimes: [at(11 * 60)] })).hold).toBe(false)
    expect(awakeDecision(facts({ onBattery: true, dueTimes: [at(14)] })).hold).toBe(true)
    expect(AWAKE_LEAD_MAINS_MS).toBeGreaterThan(AWAKE_LEAD_BATTERY_MS)
  })

  it('keeps holding for an item that is late but may still go out, and lets go when it is too late', () => {
    expect(awakeDecision(facts({ dueTimes: [at(-5 * 60)] })).hold).toBe(true)
    expect(awakeDecision(facts({ dueTimes: [at(-7 * 60)] })).hold).toBe(false)
  })

  it('names the earliest item it waits for, and ignores a time that is not a date', () => {
    expect(awakeDecision(facts({ dueTimes: [at(120), 'soon', at(30)] }))).toEqual({ hold: true, forMs: now + 30 * 60_000 })
  })

  it('holds while something is being sent, even when automation is paused; a pause lets a waiting item go', () => {
    expect(awakeDecision(facts({ sending: true, paused: true }))).toEqual({ hold: true, forMs: null })
    expect(awakeDecision(facts({ paused: true, dueTimes: [at(5)] })).hold).toBe(false)
  })
})
