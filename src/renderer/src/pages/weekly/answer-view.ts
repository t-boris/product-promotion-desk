// The plain logic of the "What AI answers" card of the Review screen (DEC-061), apart from the component so it is tested without the interface.
import type { AnswerCheckView } from '../../../../shared/types'

/** The questions of the text box: one a line. */
export function linesOf(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

/** Whether the text box holds another list than the kept one (so "Save the questions" has something to do). */
export function questionsChanged(text: string, kept: readonly string[]): boolean {
  const lines = linesOf(text)
  return lines.length !== kept.length || lines.some((line, index) => line !== kept[index])
}

/** "Named in 2 of 10 answers · your site among the sources of 1". */
export function tallyLine(run: { asked: number; named: number; cited: number }): string {
  if (run.asked === 0) return 'No question was answered.'
  return `Named in ${run.named} of ${run.asked} answer${run.asked === 1 ? '' : 's'} · your site among the sources of ${run.cited}`
}

/** The check before the shown one that finished with answers, to compare with; null when there is none. */
export function earlierOf(view: Pick<AnswerCheckView, 'history' | 'shown'>): AnswerCheckView['history'][number] | null {
  if (!view.shown) return null
  const index = view.history.findIndex((h) => h.id === view.shown?.id)
  return view.history.slice(index + 1).find((h) => h.finished && h.asked > 0) ?? null
}

/** "The check before: named in 1 of 10." */
export function earlierLine(earlier: { asked: number; named: number } | null): string | null {
  return earlier ? `The check before: named in ${earlier.named} of ${earlier.asked}.` : null
}
