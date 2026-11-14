// The decisions of the AI controls that need no screen: which action a field offers, what an idea panel remembers so the next idea
// is a new one, and when "Undo" is still honest. Pure, so they are tested without the interface (lesson 101).

/** An empty field is written by the AI; a filled one is improved, steered by the owner's wish. */
export function fieldAction(value: string): { kind: 'write' | 'improve'; label: string } {
  return value.trim() === '' ? { kind: 'write', label: 'Suggest with AI' } : { kind: 'improve', label: 'Improve with AI' }
}

/** What the AI last put into a field, and what was there before it. */
export interface AppliedText {
  text: string
  before: string
}

/** Undo is offered only while the field still holds exactly what the AI wrote: once the owner types, the text is theirs again. */
export function canUndo(value: string, applied: AppliedText | null): boolean {
  return applied !== null && value === applied.text
}

/** The AI's text is put into a field only if the field still holds what it held when the question was asked: typing meanwhile wins (lesson 84). */
export function canApply(asked: string, now: string): boolean {
  return asked === now
}

/** What happens to an answer that arrives after the owner may have moved on. */
export type AnswerFate = 'apply' | 'typed' | 'draft_changed' | 'locked'

/**
 * Whether the AI's text goes into the field when it arrives. The answer was written and checked against the draft as it was when the question
 * was asked: if the field itself changed, the owner's typing wins; if the rest of the draft it was checked against changed (the other field, the
 * channel it is for), the answer no longer holds and is dropped; if the form is busy saving, the draft row is about to be replaced.
 * `around` is a snapshot of everything but the field that the answer depends on; null when it depends on nothing else.
 */
export function answerFate(asked: { value: string; around: string | null }, now: { value: string; around: string | null; locked: boolean }): AnswerFate {
  if (!canApply(asked.value, now.value)) return 'typed'
  if (asked.around !== now.around) return 'draft_changed'
  if (now.locked) return 'locked'
  return 'apply'
}

/** What the owner is told when an answer was dropped; null when it was applied. */
export function skippedNote(fate: AnswerFate, what: 'text' | 'post' = 'text'): string | null {
  const it = what === 'post' ? 'its post' : 'its text'
  switch (fate) {
    case 'apply':
      return null
    case 'typed':
      return `You changed the ${what === 'post' ? 'title or the text' : 'text'} while the AI was working, so ${it} was not used. Ask again to get it.`
    case 'draft_changed':
      return `The draft changed while the AI was working (the other field or the channel), so ${it} was not used. Ask again to get it.`
    case 'locked':
      return `The draft was being saved while the AI was working, so ${it} was not used. Ask again to get it.`
  }
}

const MAX_AVOID = 20

/** The ideas already shown, newest last, without repeats and bounded; the core asks the AI not to repeat them. */
export function rememberShown(shown: string[], idea: string): string[] {
  const key = idea.trim().toLowerCase()
  if (!key) return shown
  const kept = shown.filter((item) => item.trim().toLowerCase() !== key)
  return [...kept, idea].slice(-MAX_AVOID)
}

/** The button of an idea panel: the first idea is "Suggest", every later one is "Another one". */
export function ideaButtonLabel(options: { asking: boolean; shownBefore: number; ask: string; another: string }): string {
  if (options.asking) return 'Thinking…'
  return options.shownBefore > 0 ? options.another : options.ask
}
