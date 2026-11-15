// What the owner is told after a post written from the calendar day was saved but its planned time could not be set on some versions
// (the core refuses a time on a channel the app does not read: the AI browser sends only on the owner's own press). Pure, tested from src/main/posts-logic.test.ts.

/** The note after saving `total` versions with a planned time, of which the core refused `refusals` (one sentence each). Undefined when every version took the time. */
export function plannedTimeNote(total: number, refusals: readonly string[]): string | undefined {
  if (refusals.length === 0) return undefined
  const reasons = [...new Set(refusals)].join(' ')
  const set = Math.max(0, total - refusals.length)
  if (set === 0) return `Saved as a draft without the planned time. ${reasons}`
  return `Saved. The planned time is set on ${set} of ${total} versions; the others stay drafts without it. ${reasons}`
}
