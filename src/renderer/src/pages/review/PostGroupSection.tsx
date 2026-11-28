import { useCallback, useLayoutEffect, useState } from 'react'
import { platformLabel } from '../../../../shared/post-format'
import type { Id, PostGroupCard, PostGroupOutcome, PostGroupResult, PostVersion } from '../../../../shared/types'
import { call } from '../../hooks'
import { channelHref } from '../../route'
import { Badge, Button, Card, ConfirmAction, ErrorNote, Field, Hint, formatTime, useMainVariant } from '../../ui'
import { LOCKED_STATES } from './labels'
import {
  BUSY_WORD,
  RESULT_LABEL,
  approveAllLabel,
  channelCount,
  groupMain,
  groupRemovalQuestion,
  groupScheduleHint,
  groupScheduleReason,
  groupStamp,
  groupTitle,
  hasWarnings,
  missingSlotChannels,
  openVersions,
  reasonBeside,
  resultsHeadline,
  scheduleAllBlocker,
  scheduleAllLabel,
  sendAllLabel,
  sendBlocker,
  seenOf,
  spreadBlocker,
  spreadPartialNote,
  spreadSlotsLabel,
  startOverQuestion,
  stepBlocker,
  stepLabel,
  versionLabel,
  wayLine,
  type GroupStep,
  type ReportedStep
} from './post-group'
import { removalWords } from './removal-words'
import { ReviewCard } from './ReviewCard'

/** What a step reported, kept with the group as it was when it reported (`groupStamp`): once a version changes the report is about a group that no longer is. */
interface Report {
  step: ReportedStep
  results: PostGroupResult[]
  stamp: string
}

/**
 * "One post, several channels" (DEC-032): the groups of the product, each as a card with its steps and, under it, its versions as ordinary
 * review cards. A group offers its main action ("Approve all" or "Send all now") the way a card does, so the screen keeps one filled button.
 */
export function PostGroupSection({ groups, error, isOwner, onMainAction }: { groups: PostGroupCard[]; error: string | null; isOwner: (id: Id) => boolean; onMainAction: (id: Id, offering: boolean) => void }) {
  if (groups.length === 0 && !error) return null
  return (
    <section className="review-section" data-testid="post-groups">
      <h2>One post, several channels</h2>
      <ErrorNote error={error} />
      <div className="review-list">
        {groups.map((card) => (
          <PostGroupBox key={card.group.id} card={card} primaryAction={isOwner(card.group.id)} onMainAction={onMainAction} />
        ))}
      </div>
    </section>
  )
}

export function PostGroupBox({ card, primaryAction, onMainAction }: { card: PostGroupCard; primaryAction: boolean; onMainAction: (id: Id, offering: boolean) => void }) {
  const { group, versions } = card
  const [work, setWork] = useState<{ step: GroupStep | null; error: string | null }>({ step: null, error: null })
  const [report, setReport] = useState<Report | null>(null)
  const [unsavedIds, setUnsavedIds] = useState<ReadonlySet<Id>>(() => new Set())
  const [scheduleAt, setScheduleAt] = useState('')
  const resting = useMainVariant()

  const main = groupMain(versions)
  const offers = main !== null
  useLayoutEffect(() => {
    onMainAction(group.id, offers)
    return () => onMainAction(group.id, false)
  }, [group.id, offers, onMainAction])

  // The versions are ordinary cards that own their editors; each says when it holds changes that are not saved.
  const onDirty = useCallback((id: Id, on: boolean) => {
    setUnsavedIds((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const working = work.step !== null
  const state = { working, unsaved: versions.filter((v) => unsavedIds.has(v.card.opportunity.id)).map((v) => versionLabel(v.card)) }
  const approveBlock = stepBlocker(state)
  const sendBlock = sendBlocker(versions, state)
  const scheduleBlock = scheduleAllBlocker(versions, state, scheduleAt)
  const spreadBlock = spreadBlocker(versions, state)
  const scheduleReason = groupScheduleReason(scheduleBlock, spreadBlock)
  const missingSlots = missingSlotChannels(versions)
  const partialSlotsNote = spreadPartialNote(versions)
  const reason = reasonBeside(approveBlock, sendBlock)
  const open = openVersions(versions)
  const filled = primaryAction && resting === 'primary'
  // The group deletes as a post does: the same word.
  const removal = removalWords('standalone').label
  const stamp = groupStamp(versions)

  /** One step of the group: its words while it runs, its report when it is done, its refusal when it failed. The rest of the screen stays usable. */
  async function run(step: GroupStep, doStep: () => Promise<PostGroupOutcome | null>): Promise<void> {
    setWork({ step, error: null })
    setReport(null)
    try {
      const outcome = await doStep()
      if (outcome && step !== 'remove') setReport({ step, results: outcome.results, stamp: groupStamp(outcome.card.versions) })
      setWork({ step: null, error: null })
    } catch (e) {
      setWork({ step: null, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const adapt = (): Promise<void> => run('adapt', () => call('postGroups.adapt', { id: group.id }))
  const startOver = (opportunityId: Id): Promise<void> => run('adapt', () => call('postGroups.adapt', { id: group.id, opportunityIds: [opportunityId], force: true }))
  // What the owner approves or schedules is what is on the screen: the draft of each version as these cards show it.
  const approve = (): Promise<void> => run('approve', () => call('postGroups.approve', { id: group.id, seen: seenOf(versions) }))
  const scheduleAll = (): Promise<void> => run('schedule', () => call('postGroups.schedule', { id: group.id, at: new Date(scheduleAt).toISOString(), seen: seenOf(versions) }))
  const spreadSlots = (): Promise<void> => run('spread', () => call('postGroups.enqueue', { id: group.id, seen: seenOf(versions) }))
  const send = (): Promise<void> => run('send', () => call('postGroups.sendAll', { id: group.id }))
  const remove = (): Promise<void> =>
    run('remove', async () => {
      await call('postGroups.remove', { id: group.id })
      return null
    })

  const approveButton = (
    <Button variant={main === 'approve' && filled ? 'primary' : 'secondary'} onClick={() => void approve()} disabled={working || approveBlock !== null} data-testid="group-approve">
      {work.step === 'approve' ? BUSY_WORD.approve : approveAllLabel(versions)}
    </Button>
  )
  const sendButton = (
    <Button variant={main === 'send' && filled ? 'primary' : 'secondary'} onClick={() => void send()} disabled={working || sendBlock !== null} data-testid="group-send">
      {work.step === 'send' ? BUSY_WORD.send : sendAllLabel(versions)}
    </Button>
  )

  return (
    <div className="post-group" data-testid={`post-group-${group.id}`}>
      <Card className="post-group-card">
        <div className="post-group-head">
          <div className="post-group-title">
            <strong data-testid="group-title">{groupTitle(group)}</strong>
            <Badge tone="info">{channelCount(versions.length)}</Badge>
          </div>
          <span className="post-group-when">{formatTime(group.createdAt)}</span>
        </div>
        <div className="review-body">
          {work.step !== null && (
            <p className="hint strong group-step" role="status" data-testid="group-step">
              {stepLabel(work.step, versions)}
            </p>
          )}
          <ErrorNote error={work.error} />
          {report?.stamp === stamp && <GroupReport report={report} />}
          {main === null ? (
            <Hint data-testid="group-done">Nothing is left to approve or send here.</Hint>
          ) : (
            <>
              <div className="schedule group-schedule" data-testid="group-schedule">
                <Field label="Schedule approved versions" hint={groupScheduleHint(versions)}>
                  <div className="schedule-row">
                    <input
                      className="input schedule-input"
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      disabled={working}
                      data-testid="group-schedule-input"
                    />
                    <Button variant="secondary" onClick={() => void scheduleAll()} disabled={working || scheduleBlock !== null} data-testid="group-schedule-all">
                      {work.step === 'schedule' ? BUSY_WORD.schedule : scheduleAllLabel(versions)}
                    </Button>
                    <Button variant="secondary" onClick={() => void spreadSlots()} disabled={working || spreadBlock !== null} data-testid="group-spread-slots">
                      {work.step === 'spread' ? BUSY_WORD.spread : spreadSlotsLabel(versions)}
                    </Button>
                  </div>
                </Field>
                {scheduleReason && (
                  <div className="muted small" data-testid="group-schedule-reason">
                    {scheduleReason}
                  </div>
                )}
                {missingSlots.length > 0 && (
                  <div className="muted small group-missing-slots" data-testid="group-missing-slots">
                    {partialSlotsNote && <span>{partialSlotsNote} </span>}
                    {missingSlots.map((ch, idx) => (
                      <span key={ch.channelId}>
                        {idx > 0 ? ' · ' : ''}
                        <a href={channelHref(ch.channelId, 'settings')}>Add posting times for {ch.label}</a>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="review-actions" data-testid="group-buttons">
                <div className="review-actions-main">
                  {reason && (
                    <span className="muted small" data-testid="group-reason">
                      {reason}
                    </span>
                  )}
                  <Button variant="secondary" icon="sparkles" onClick={() => void adapt()} disabled={working || approveBlock !== null} data-testid="group-adapt">
                    {work.step === 'adapt' ? BUSY_WORD.adapt : 'Adapt with AI'}
                  </Button>
                  {main === 'approve' ? (
                    <>
                      {sendButton}
                      {approveButton}
                    </>
                  ) : (
                    sendButton
                  )}
                </div>
                {open.length > 0 && (
                  <div className="review-actions-side">
                    <ConfirmAction label={removal} variant="quiet" className="danger" question={groupRemovalQuestion} confirmLabel={removal} onConfirm={remove} disabled={working} testId="group-delete" confirmTestId="group-delete-confirm" />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
      <div className="post-group-versions">
        {versions.map((version) => (
          <ReviewCard
            key={version.card.opportunity.id}
            card={version.card}
            collapsible
            defaultOpen={version.card.opportunity.state !== 'confirmed'}
            onDirty={onDirty}
            frozen={working}
            tags={<VersionTags version={version} />}
            notes={<VersionNotes version={version} disabled={working} onStartOver={() => void startOver(version.card.opportunity.id)} />}
          />
        ))}
      </div>
    </div>
  )
}

function GroupReport({ report }: { report: Report }) {
  return (
    <div className={`note ${hasWarnings(report.results) ? 'warn' : 'good'}`} role="status" data-testid="group-results">
      <div className="group-results-body">
        <strong>{resultsHeadline(report.step, report.results)}</strong>
        <ul className="group-results-list">
          {report.results.map((r) => (
            <li key={r.opportunityId} data-status={r.status} data-testid={`group-result-${r.opportunityId}`}>
              <strong>{r.channelLabel}</strong>
              <span className={`group-result-status ${r.status}`}>{RESULT_LABEL[r.status]}</span>
              <span className="group-result-reason">{r.scheduledAt ? `Scheduled for ${formatTime(r.scheduledAt)}.` : r.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** The platform of the version and whether the owner changed it by hand. */
function VersionTags({ version }: { version: PostVersion }) {
  return (
    <>
      <Badge>{platformLabel(version.card.channelPlatform)}</Badge>
      {version.edited && <Badge tone="info">Edited by you</Badge>}
    </>
  )
}

/**
 * What the owner reads with the version before deciding: how it goes out, and what the platform will refuse. A version that is out has
 * neither. One the owner changed by hand is left alone by "Adapt with AI"; "Start over" asks the AI again for this one (after asking first).
 */
function VersionNotes({ version, disabled, onStartOver }: { version: PostVersion; disabled: boolean; onStartOver: () => void }) {
  if (LOCKED_STATES.includes(version.card.opportunity.state)) return null
  return (
    <div className="version-notes" data-testid="version-notes">
      <p className="hint" data-testid="version-way">
        {wayLine(version.way)}
      </p>
      {version.problems.map((problem) => (
        <p key={problem} className="hint warn" data-testid="version-problem">
          {problem}
        </p>
      ))}
      {version.edited && (
        <div className="version-edited">
          <span className="hint">You changed this version by hand, so “Adapt with AI” leaves it as it is.</span>
          <ConfirmAction
            label="Start over with the AI"
            icon="sparkles"
            variant="secondary"
            question={startOverQuestion}
            confirmLabel="Replace my changes"
            onConfirm={onStartOver}
            disabled={disabled}
            testId="version-start-over"
            confirmTestId="version-start-over-confirm"
          />
        </div>
      )}
    </div>
  )
}
