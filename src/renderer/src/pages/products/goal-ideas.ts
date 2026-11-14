// The goal form and the AI's goal ideas, as plain logic (lesson 101): what a goal's fields are, how an idea fills them, and what the AI
// is shown of the other fields when it writes or improves one. Pure, so it is tested without the screen.

import type { GoalIdea } from '../../../../shared/types'

export interface GoalFields {
  targetAction: string
  /** One metric per line. */
  metrics: string
  notes: string
}

/** An idea fills the target action and the metrics. The AI's reason is shown with the idea and is not kept: the notes stay the owner's. */
export function fieldsFromIdea(idea: GoalIdea): GoalFields {
  return { targetAction: idea.targetAction, metrics: idea.successMetrics.join('\n'), notes: '' }
}

/** True when the owner has written anything in the form. */
export function hasText(fields: GoalFields): boolean {
  return fields.targetAction.trim() !== '' || fields.metrics.trim() !== '' || fields.notes.trim() !== ''
}

const LABELS: Record<keyof GoalFields, string> = { targetAction: 'Target action', metrics: 'Success metrics', notes: 'Notes' }

/** What the owner wrote in the other fields of the form, so the AI fits the field it works on into the goal. */
export function around(fields: GoalFields, skip: keyof GoalFields): { label: string; text: string }[] {
  return (Object.keys(LABELS) as (keyof GoalFields)[]).filter((key) => key !== skip && fields[key].trim() !== '').map((key) => ({ label: LABELS[key], text: fields[key] }))
}
