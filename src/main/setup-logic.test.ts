// The Setup screen's rules (the stepper and the passport summary) live in src/renderer/src/pages/setup/*; the renderer has no test runner
// of its own, and these modules import only pure code, so they are tested from here (DEC-037, phase C4).

import { describe, expect, it } from 'vitest'
import type { AnalysisStatus, Claim, ClaimKind, ClaimStatus, PassportSection, PassportView } from '../shared/types'
import { launchStages, type LaunchFacts } from '../renderer/src/pages/products/launch-path'
import { summarize } from '../renderer/src/pages/products/model'
import { PREVIEW_LIMIT, isSetAside, sectionLine, startsWithForm, summarizeSection } from '../renderer/src/pages/setup/passport-summary'
import { SETUP_STEP_LABEL, analysisSummaryLine, goalsSummary, passportSummaryLine, setupFacts, setupSteps, sourcesSummary, type SetupFacts } from '../renderer/src/pages/setup/setup-steps'
import { SETUP_TABS } from '../renderer/src/route'

function claim(id: string, seed: { section?: PassportSection; kind?: ClaimKind; status?: ClaimStatus; text?: string } = {}): Claim {
  return {
    id,
    lineageId: id,
    passportVersionId: 'v1',
    section: seed.section ?? 'identity',
    text: seed.text ?? `Statement ${id}`,
    kind: seed.kind ?? 'fact',
    status: seed.status ?? 'proposed',
    sources: [],
    verifiedAt: null,
    unconfirmedAvailability: false,
    conflictsWith: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
}

const empty = summarize([])

function facts(seed: Partial<SetupFacts> = {}): SetupFacts {
  return { sources: 1, passportApproved: false, passport: empty, analysis: 'idle', goals: 0, ...seed }
}

const pathFacts = (seed: Partial<LaunchFacts> = {}): LaunchFacts => ({ hasSources: true, passportApproved: false, goals: 0, channels: 0, approvedPublications: 0, ...seed })
const stagesOf = (seed: Partial<LaunchFacts> = {}) => launchStages('p1', pathFacts(seed))

describe('the four steps of Setup', () => {
  it('are Sources, Passport, Analysis and Goal in that order, named as the tabs they open', () => {
    const steps = setupSteps(stagesOf(), facts())
    expect(steps.map((s) => s.id)).toEqual(['sources', 'passport', 'analysis', 'goal'])
    expect(steps.map((s) => s.label)).toEqual(['Sources', 'Passport', 'Analysis', 'Goal'])
    expect(steps.map((s) => s.id)).toEqual([...SETUP_TABS])
    expect(SETUP_STEP_LABEL.analysis).toBe('Analysis')
  })

  it('take Sources, Passport and Goal from the launch path: done, the path\'s next step, or not reached', () => {
    const fresh = setupSteps(stagesOf(), facts())
    expect(fresh.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo'])
    const approved = setupSteps(stagesOf({ passportApproved: true }), facts({ passportApproved: true }))
    expect(approved.map((s) => s.state)).toEqual(['done', 'done', 'todo', 'current'])
    const goalFirst = setupSteps(stagesOf({ goals: 1 }), facts({ goals: 1 }))
    expect(goalFirst.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'done'])
    const noSource = setupSteps(stagesOf({ hasSources: false }), facts({ sources: 0 }))
    expect(noSource.map((s) => s.state)).toEqual(['current', 'todo', 'todo', 'todo'])
  })

  it('never mark Analysis as the next step, so the stepper has one "Next" and it is the passport', () => {
    for (const analysis of ['idle', 'running', 'paused', 'failed'] as const) {
      const steps = setupSteps(stagesOf(), facts({ analysis }))
      expect(steps.find((s) => s.id === 'analysis')?.state).toBe('todo')
      expect(steps.filter((s) => s.state === 'current').map((s) => s.id)).toEqual(['passport'])
    }
  })

  it('mark Analysis done once it is complete, whatever the path says', () => {
    expect(setupSteps(stagesOf(), facts({ analysis: 'complete' })).find((s) => s.id === 'analysis')?.state).toBe('done')
  })

  it('have no step that is the next one once the four are done: the next move is a later stage of the path', () => {
    const steps = setupSteps(stagesOf({ passportApproved: true, goals: 1 }), facts({ passportApproved: true, goals: 1, analysis: 'complete' }))
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('treat a stage missing from the path as not reached', () => {
    expect(setupSteps([], facts()).map((s) => s.state)).toEqual(['todo', 'todo', 'todo', 'todo'])
  })

  it('carry the summary and the tone of each step', () => {
    const steps = setupSteps(stagesOf(), facts({ sources: 2, goals: 3, analysis: 'failed' }))
    expect(steps.map((s) => s.summary)).toEqual(['2 sources', 'No passport yet', 'Analysis failed', '3 goals'])
    expect(steps.map((s) => s.tone)).toEqual(['neutral', 'neutral', 'bad', 'neutral'])
  })
})

describe('what the steps are made of', () => {
  const view = (seed: { sources?: number; active?: string | null; analysis?: AnalysisStatus; goals?: number; claims?: Claim[] }): PassportView =>
    ({
      product: { activePassportVersionId: seed.active === undefined ? null : seed.active, analysisStatus: seed.analysis ?? 'idle', goals: Array.from({ length: seed.goals ?? 0 }, (_, at) => ({ id: `g${at}` })) },
      sources: Array.from({ length: seed.sources ?? 0 }, (_, at) => ({ id: `s${at}` })),
      claims: seed.claims ?? []
    }) as unknown as PassportView

  it('are read from the passport view of the product', () => {
    const facts = setupFacts(view({ sources: 3, active: 'v1', analysis: 'paused', goals: 2, claims: [claim('a', { status: 'approved' }), claim('b')] }))
    expect(facts).toMatchObject({ sources: 3, passportApproved: true, analysis: 'paused', goals: 2 })
    expect(facts.passport).toEqual(summarize([claim('a', { status: 'approved' }), claim('b')]))
  })

  it('say a passport with no approved version is not approved, and an empty product has nothing', () => {
    const facts = setupFacts(view({}))
    expect(facts).toMatchObject({ sources: 0, passportApproved: false, analysis: 'idle', goals: 0 })
    expect(facts.passport.total).toBe(0)
  })
})

describe('the one line of each step', () => {
  it('counts sources and says when there are none', () => {
    expect(sourcesSummary(0)).toBe('No sources yet')
    expect(sourcesSummary(1)).toBe('1 source')
    expect(sourcesSummary(2)).toBe('2 sources')
  })

  it('counts goals and says when there are none', () => {
    expect(goalsSummary(0)).toBe('No goal yet')
    expect(goalsSummary(1)).toBe('1 goal')
    expect(goalsSummary(12)).toBe('12 goals')
  })

  it('says the analysis in the words of the product header, amber while paused and red when it failed', () => {
    const lines: Record<AnalysisStatus, { text: string; tone: string }> = {
      idle: { text: 'Not analyzed', tone: 'neutral' },
      running: { text: 'Analyzing', tone: 'neutral' },
      paused: { text: 'Paused', tone: 'warn' },
      failed: { text: 'Analysis failed', tone: 'bad' },
      complete: { text: 'Analyzed', tone: 'neutral' }
    }
    for (const [status, line] of Object.entries(lines)) expect(analysisSummaryLine(status as AnalysisStatus)).toEqual(line)
  })

  it('says an approved passport with its statements, and amber while some wait for a look', () => {
    const settled = summarize([claim('a', { status: 'approved' }), claim('b', { status: 'approved' })])
    expect(passportSummaryLine(true, settled)).toEqual({ text: 'Approved · 2 statements', tone: 'neutral' })
    expect(passportSummaryLine(true, summarize([claim('a', { status: 'approved' })]))).toEqual({ text: 'Approved · 1 statement', tone: 'neutral' })
    // What the owner set aside does not count among the statements the passport holds.
    expect(passportSummaryLine(true, summarize([claim('a', { status: 'approved' }), claim('b', { status: 'approved' }), claim('c', { status: 'rejected' })]))).toEqual({ text: 'Approved · 2 statements', tone: 'neutral' })
    const waiting = summarize([claim('a', { status: 'approved' }), claim('b'), claim('c')])
    expect(passportSummaryLine(true, waiting)).toEqual({ text: 'Approved · 2 to review', tone: 'warn' })
  })

  it('says a passport that is not approved: none, a draft to review, ready to approve, or nothing approved', () => {
    expect(passportSummaryLine(false, empty)).toEqual({ text: 'No passport yet', tone: 'neutral' })
    expect(passportSummaryLine(false, summarize([claim('a'), claim('b', { status: 'approved' })]))).toEqual({ text: 'Draft · 1 to review', tone: 'warn' })
    expect(passportSummaryLine(false, summarize([claim('a', { status: 'approved' })]))).toEqual({ text: 'Draft · ready to approve', tone: 'warn' })
    expect(passportSummaryLine(false, summarize([claim('a', { status: 'rejected' })]))).toEqual({ text: 'Draft · nothing approved', tone: 'warn' })
  })
})

describe('a closed section of the passport', () => {
  it('counts every statement once, by what the owner has to do with it', () => {
    const claims = [
      claim('a', { status: 'approved' }),
      claim('b', { status: 'approved', kind: 'assumption' }),
      claim('c'),
      claim('d', { kind: 'unknown' }),
      claim('e', { kind: 'contradiction' }),
      claim('f', { status: 'approved', kind: 'contradiction' }),
      claim('g', { status: 'rejected' }),
      claim('h', { status: 'prohibited', kind: 'unknown' }),
      claim('i', { status: 'rejected', kind: 'contradiction' })
    ]
    const summary = summarizeSection('identity', claims)
    expect(summary).toMatchObject({ approved: 2, toReview: 1, unknown: 1, conflicts: 2, setAside: 3, total: 6 })
    expect(summary.approved + summary.toReview + summary.unknown + summary.conflicts + summary.setAside).toBe(claims.length)
  })

  it('takes only the statements of its own section', () => {
    const claims = [claim('a', { section: 'offer', status: 'approved' }), claim('b', { section: 'audience' })]
    expect(summarizeSection('identity', claims).total).toBe(0)
    expect(summarizeSection('offer', claims)).toMatchObject({ section: 'offer', approved: 1, total: 1 })
  })

  it('lists the first three statements in the stored order and counts the rest, leaving out what was set aside', () => {
    const claims = [claim('a', { text: 'One' }), claim('x', { status: 'rejected', text: 'Gone' }), claim('b', { text: 'Two' }), claim('c', { text: 'Three' }), claim('d', { text: 'Four' }), claim('e', { text: 'Five' })]
    const summary = summarizeSection('identity', claims)
    expect(PREVIEW_LIMIT).toBe(3)
    expect(summary.preview.map((p) => p.text)).toEqual(['One', 'Two', 'Three'])
    expect(summary.preview.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(summary.total).toBe(5)
    expect(summary.more).toBe(2)
  })

  it('has nothing more to say when everything is listed', () => {
    const summary = summarizeSection('identity', [claim('a'), claim('b')])
    expect(summary.preview).toHaveLength(2)
    expect(summary.more).toBe(0)
  })

  it('marks a statement that is not a plain fact, with the words of the passport', () => {
    const marks = (kinds: ClaimKind[]): (string | null)[] => summarizeSection('identity', kinds.map((kind, at) => claim(`k${at}`, { kind }))).preview.map((p) => p.mark)
    expect(marks(['fact', 'assumption', 'unknown'])).toEqual([null, 'Assumption', 'Unknown'])
    expect(marks(['contradiction'])).toEqual(['Contradiction'])
  })

  it('is amber while anything waits for the owner, green when all it holds is approved, and quiet when empty', () => {
    expect(summarizeSection('identity', [claim('a', { status: 'approved' }), claim('b')]).tone).toBe('warn')
    expect(summarizeSection('identity', [claim('a', { status: 'approved' }), claim('b', { kind: 'unknown' })]).tone).toBe('warn')
    expect(summarizeSection('identity', [claim('a', { status: 'approved' }), claim('b', { kind: 'contradiction' })]).tone).toBe('warn')
    expect(summarizeSection('identity', [claim('a', { status: 'approved' }), claim('b', { status: 'rejected' })]).tone).toBe('good')
    expect(summarizeSection('identity', [claim('a', { status: 'rejected' })]).tone).toBe('')
    expect(summarizeSection('identity', []).tone).toBe('')
  })

  it('says its counts in one line, in a fixed order', () => {
    const claims = [
      claim('a', { status: 'approved' }),
      claim('b'),
      claim('c', { kind: 'unknown' }),
      claim('d', { kind: 'contradiction' }),
      claim('e', { status: 'rejected' })
    ]
    expect(sectionLine(summarizeSection('identity', claims))).toBe('1 approved · 1 to review · 1 unknown · 1 in conflict · 1 set aside')
    expect(sectionLine(summarizeSection('identity', [claim('a', { status: 'approved' })]))).toBe('1 approved')
    expect(sectionLine(summarizeSection('identity', [claim('a'), claim('b')]))).toBe('2 to review')
    expect(sectionLine(summarizeSection('identity', []))).toBe('Nothing here yet')
  })

  it('keeps a section whose statements were all set aside from reading as empty', () => {
    const summary = summarizeSection('identity', [claim('a', { status: 'rejected' })])
    expect(sectionLine(summary)).toBe('1 set aside')
    expect(summary.total).toBe(0)
  })

  it('opens its editor with the new-statement form only when there is no statement at all', () => {
    expect(startsWithForm(summarizeSection('identity', []))).toBe(true)
    expect(startsWithForm(summarizeSection('identity', [claim('a')]))).toBe(false)
    expect(startsWithForm(summarizeSection('identity', [claim('a', { status: 'rejected' })]))).toBe(false)
    expect(startsWithForm(summarizeSection('identity', [claim('a', { section: 'offer' })]))).toBe(true)
  })

  it('sets aside a rejected or a prohibited statement, and nothing else', () => {
    expect(isSetAside({ status: 'rejected' })).toBe(true)
    expect(isSetAside({ status: 'prohibited' })).toBe(true)
    expect(isSetAside({ status: 'proposed' })).toBe(false)
    expect(isSetAside({ status: 'approved' })).toBe(false)
  })
})
