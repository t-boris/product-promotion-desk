// The plain logic of the Positioning and Audience's words steps of Setup (DEC-059), apart from the components so it is tested without the interface.
import { POSITIONING_KEYS, emptyAnswers, type PositioningAnswers, type WordKind } from '../../../../shared/positioning'
import type { AudienceWord, PositioningView } from '../../../../shared/types'

/** What the form starts from: the AI's waiting proposal, else what is approved, else nothing. */
export function formStart(view: Pick<PositioningView, 'approved' | 'proposed'>): PositioningAnswers {
  return { ...(view.proposed ?? view.approved ?? emptyAnswers()) }
}

/** Whether the form differs from what is approved (so "Approve" has something to do). */
export function differs(form: PositioningAnswers, approved: PositioningAnswers | null): boolean {
  return approved === null || POSITIONING_KEYS.some((key) => form[key].trim() !== approved[key].trim())
}

/** The entries of one kind, or of all when none is chosen; the most repeated first (the order the core gives). */
export function wordsOfKind(entries: readonly AudienceWord[], kind: WordKind | null): AudienceWord[] {
  return kind === null ? [...entries] : entries.filter((entry) => entry.kind === kind)
}

/** "Said in 3 posts" / "Said in 1 post". */
export function saidIn(count: number): string {
  return `Said in ${count} post${count === 1 ? '' : 's'}`
}
