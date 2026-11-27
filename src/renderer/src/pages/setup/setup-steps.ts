// What the steps of Setup say about themselves (DEC-037, phase C4): the four steps of the vertical stepper, each with its state and one
// short line of what is in it. The state comes from the launch path (`launch-path.ts`) and not from a rule of its own, so the stepper, the
// path on the Inbox and the filled button cannot name different next steps (BUG-064). Pure, so the rules are tested from
// src/main/setup-logic.test.ts without the interface.

import type { AnalysisStatus, PassportView } from '../../../../shared/types'
import { SETUP_TABS, type SetupTab } from '../../route'
import { ANALYSIS_LABELS } from '../products/labels'
import type { LaunchStage, LaunchStageId, LaunchStageState } from '../products/launch-path'
import { summarize, type PassportSummary } from '../products/model'

export const SETUP_STEP_LABEL: Record<SetupTab, string> = { sources: 'Sources', passport: 'Passport', analysis: 'Analysis', positioning: 'Positioning', goal: 'Goal', words: 'Audience’s words' }

/**
 * The launch-path stage a step takes its state from. Analysis has none: it is the AI's way to the passport, and the passport step
 * already holds the path's stage; a second "Next" on the stepper would send the owner two ways. Positioning and the audience's words
 * (DEC-059) are not stages of the path either: nothing waits for them, so they are never "Next".
 */
const STEP_STAGE: Record<SetupTab, LaunchStageId | null> = { sources: 'product', passport: 'passport', analysis: null, positioning: null, goal: 'goal', words: null }

/** Where the positioning stands: nothing written, a proposal of the AI waiting, or approved. */
export type PositioningState = 'none' | 'proposed' | 'approved'

export function positioningSummaryLine(state: PositioningState): { text: string; tone: StepTone } {
  return state === 'approved' ? { text: 'Approved', tone: 'neutral' } : state === 'proposed' ? { text: 'A proposal to review', tone: 'warn' } : { text: 'Not written yet', tone: 'neutral' }
}

export function wordsSummary(words: number): string {
  return words === 0 ? 'Nothing taken yet' : `${words} entr${words === 1 ? 'y' : 'ies'}`
}

/** Words that need the owner's look are amber, a failure is red, everything else is quiet. */
export type StepTone = 'neutral' | 'warn' | 'bad'

export interface SetupStep {
  id: SetupTab
  label: string
  /** Done, the path's next step (current), or not reached yet; the same words as a stage of the launch path. */
  state: LaunchStageState
  /** One line of what is in the step, beside its title. */
  summary: string
  tone: StepTone
}

/** What the summaries are made of, read from the passport view of the product. */
export interface SetupFacts {
  sources: number
  passportApproved: boolean
  passport: PassportSummary
  analysis: AnalysisStatus
  goals: number
  /** Read apart from the passport view; absent while not loaded. */
  positioning?: PositioningState
  words?: number
}

export function setupFacts(view: PassportView): SetupFacts {
  return {
    sources: view.sources.length,
    passportApproved: view.product.activePassportVersionId !== null,
    passport: summarize(view.claims),
    analysis: view.product.analysisStatus,
    goals: view.product.goals.length
  }
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function sourcesSummary(sources: number): string {
  return sources === 0 ? 'No sources yet' : count(sources, 'source')
}

/**
 * The passport in one line. Approved: how many statements it holds, and how many more wait for a look. Not approved: no statements at
 * all, a draft with statements to review, a draft with something approved that only needs the approval, or a draft where nothing is approved.
 */
export function passportSummaryLine(approved: boolean, summary: PassportSummary): { text: string; tone: StepTone } {
  if (approved) {
    return summary.proposed > 0
      ? { text: `Approved · ${summary.proposed} to review`, tone: 'warn' }
      : { text: `Approved · ${count(summary.approved, 'statement')}`, tone: 'neutral' }
  }
  if (summary.total === 0) return { text: 'No passport yet', tone: 'neutral' }
  if (summary.proposed > 0) return { text: `Draft · ${summary.proposed} to review`, tone: 'warn' }
  if (summary.approved > 0) return { text: 'Draft · ready to approve', tone: 'warn' }
  return { text: 'Draft · nothing approved', tone: 'warn' }
}

export function analysisSummaryLine(status: AnalysisStatus): { text: string; tone: StepTone } {
  return { text: ANALYSIS_LABELS[status], tone: status === 'failed' ? 'bad' : status === 'paused' ? 'warn' : 'neutral' }
}

export function goalsSummary(goals: number): string {
  return goals === 0 ? 'No goal yet' : count(goals, 'goal')
}

/** The steps in the order of the stepper. A step whose stage is missing from `stages` is not reached yet. */
export function setupSteps(stages: readonly LaunchStage[], facts: SetupFacts): SetupStep[] {
  const stateOf = (id: SetupTab): LaunchStageState => {
    const stage = STEP_STAGE[id]
    if (id === 'positioning') return facts.positioning === 'approved' ? 'done' : 'todo'
    if (id === 'words') return (facts.words ?? 0) > 0 ? 'done' : 'todo'
    if (stage === null) return facts.analysis === 'complete' ? 'done' : 'todo'
    return stages.find((s) => s.id === stage)?.state ?? 'todo'
  }
  const line = (id: SetupTab): { text: string; tone: StepTone } => {
    switch (id) {
      case 'sources':
        return { text: sourcesSummary(facts.sources), tone: 'neutral' }
      case 'passport':
        return passportSummaryLine(facts.passportApproved, facts.passport)
      case 'analysis':
        return analysisSummaryLine(facts.analysis)
      case 'positioning':
        return positioningSummaryLine(facts.positioning ?? 'none')
      case 'goal':
        return { text: goalsSummary(facts.goals), tone: 'neutral' }
      case 'words':
        return { text: wordsSummary(facts.words ?? 0), tone: 'neutral' }
    }
  }
  return SETUP_TABS.map((id) => ({ id, label: SETUP_STEP_LABEL[id], state: stateOf(id), summary: line(id).text, tone: line(id).tone }))
}
