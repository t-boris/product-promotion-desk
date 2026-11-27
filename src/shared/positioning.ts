// Positioning (DEC-059): five answers the owner approves before posting, after April Dunford's method. They are the owner's judgement about the
// product's place, not facts of the passport: the AI's drafts take the angle from them and still state only approved statements.

export const POSITIONING_KEYS = ['alternatives', 'unique', 'value', 'audience', 'category'] as const
export type PositioningKey = (typeof POSITIONING_KEYS)[number]
export type PositioningAnswers = Record<PositioningKey, string>

export const POSITIONING_QUESTION: Record<PositioningKey, { title: string; ask: string }> = {
  alternatives: { title: 'Instead of it', ask: 'What would people use or do if this product did not exist?' },
  unique: { title: 'Only here', ask: 'What does it have that those alternatives do not?' },
  value: { title: 'What that gives', ask: 'What does that difference give the person, in their own terms?' },
  audience: { title: 'Who cares most', ask: 'Who cares about that the most, and in what situation?' },
  category: { title: 'What kind of thing it is', ask: 'What would a buyer call it, in the words they would search for?' }
}

export const MAX_POSITIONING_ANSWER = 400

export const emptyAnswers = (): PositioningAnswers => ({ alternatives: '', unique: '', value: '', audience: '', category: '' })

/** True when every one of the five has words. */
export function answersComplete(answers: PositioningAnswers): boolean {
  return POSITIONING_KEYS.every((key) => answers[key].trim() !== '')
}

/** The kinds of the audience's own words the application collects from the Feed. */
export const WORD_KINDS = ['question', 'objection', 'phrase'] as const
export type WordKind = (typeof WORD_KINDS)[number]
export const WORD_KIND_LABEL: Record<WordKind, string> = { question: 'Question', objection: 'Objection', phrase: 'Their words' }
/** Said in this many posts or more, a question or an objection is worth an answer of its own. */
export const REPEATS_FOR_POST = 3
