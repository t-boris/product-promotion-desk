import { useEffect, useId, useReducer, useRef, useState } from 'react'
import type { Channel, MixKind, MixKindCard } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, Card, ErrorNote, Hint, Loading, useOpenForm } from '../../ui'
import { MixNotes } from './MixNotes'
import {
  DAYS_PROBLEM,
  KIND_WORDS,
  REPLIES_TITLE,
  applyProposal,
  canUndoProposal,
  daysProblem,
  draftsOnlyLine,
  formDirty,
  formFromCard,
  formSignature,
  formValid,
  kindStatus,
  proposalNote,
  proposeBlock,
  repliesLine,
  rowChanged,
  settingsFromForm,
  statusLine,
  withRow,
  type MixForm,
  type Proposal
} from './mix-card'

/** Draws the card again every minute, so "Next draft" turns into "at the next check" when its time comes, without a reload of the page. */
function useMinuteTick(): void {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(tick, 60_000)
    return () => clearInterval(timer)
  }, [])
}

/**
 * The content mix of a channel (DEC-033): which kinds of own post the AI may prepare DRAFTS of here, and how often. It prepares drafts and
 * nothing else; every one waits for the owner's Approve. "Replies to threads" is what the monitor does and is a line, not a setting.
 *
 * The form starts from the saved mix (`mix.get`) and keeps the owner's edits and the AI's proposal as unsaved state; "Save mix" is the
 * screen's filled button only while it differs from the saved one (`useOpenForm`, like "Save settings"). The card re-reads itself when
 * the core says something changed (a draft prepared by the job, a note used), so a reload of the page is never needed.
 */
export function ChannelMixCard({ channel, blockedReason }: { channel: Channel; blockedReason: string | null }) {
  const card = useQuery('mix.get', { channelId: channel.id }, ['channels', 'opportunities', 'passport'])
  const data = card.data
  const saved: MixForm | null = data ? formFromCard(data) : null
  const [draft, setDraft] = useState<MixForm | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  // The form starts again from the saved mix whenever that changes (saved here, or changed elsewhere), like the settings form does.
  const signature = saved ? formSignature(saved) : ''
  const [seen, setSeen] = useState(signature)
  if (seen !== signature) {
    setSeen(signature)
    setDraft(null)
    setProposal(null)
  }
  const form = draft ?? saved
  const dirty = saved !== null && form !== null && formDirty(form, saved)
  const valid = form !== null && formValid(form)
  const saveVariant = useOpenForm(dirty)
  useMinuteTick()
  // Read at every draw: the time the core gave is its own clock when it answered, and it is never later than this one.
  const now = Date.now()
  const idBase = useId()
  // The form as it is when the AI answers: the owner may keep editing while it works (it can take a minute or two).
  const latest = useRef({ draft, saved })
  latest.current = { draft, saved }

  const [save, saving] = useAction(async (mix: NonNullable<ReturnType<typeof settingsFromForm>>) => {
    await call('channels.updateSettings', { channelId: channel.id, settings: { mix } })
    card.reload()
  })
  const [propose, proposing] = useAction(() => call('mix.propose', { channelId: channel.id }))
  const proposeReason = proposeBlock(channel.plan, blockedReason)

  async function askForProposal(): Promise<void> {
    const result = await propose()
    const { draft: current, saved: base } = latest.current
    if (!result || !base) return
    // The proposal replaces the form as it is now (nothing was saved or switched on), and "Undo" brings the owner's edits back.
    const applied = applyProposal(current ?? base, result)
    setDraft(applied)
    setProposal({ before: current, applied })
  }

  async function submit(): Promise<void> {
    if (!form) return
    const mix = settingsFromForm(form)
    if (mix) await save(mix)
  }

  const change = (kind: MixKind, patch: Partial<Pick<MixForm[number], 'enabled' | 'days'>>): void => {
    if (form) setDraft(withRow(form, kind, patch))
  }

  return (
    <Card
      title="Content mix"
      className="mix-card"
      actions={
        <Button variant="secondary" icon="sparkles" onClick={() => void askForProposal()} disabled={proposeReason !== null || proposing.busy || saved === null} data-testid="mix-propose">
          {proposing.busy ? 'Thinking…' : 'Let the AI propose a mix'}
        </Button>
      }
    >
      {proposeReason && (
        <Hint tone="warn" data-testid="mix-propose-blocked">
          {proposeReason}
        </Hint>
      )}
      {data?.blocked && (
        <Hint tone="warn" data-testid="mix-blocked">
          {data.blocked}
        </Hint>
      )}
      <ErrorNote error={card.error ?? proposing.error} />
      {!data && !card.error && <Loading what="Loading the content mix" />}
      {data && form && saved && (
        <>
          <div className="mix-rows" data-testid="mix-rows">
            <div className="mix-row mix-replies" data-testid="mix-replies">
              <div className="mix-main">
                <strong className="mix-title">{REPLIES_TITLE}</strong>
                <span className="hint" data-testid="mix-replies-line">
                  {repliesLine(channel)}
                </span>
              </div>
            </div>
            {form.map((row) => {
              const kindCard: MixKindCard = data.kinds.find((k) => k.kind === row.kind) ?? { kind: row.kind, enabled: false, everyDays: 0, lastDraftAt: null, nextAt: null, problem: null }
              const words = KIND_WORDS[row.kind]
              const changed = rowChanged(row, saved.find((s) => s.kind === row.kind))
              const status = kindStatus(kindCard, { now, changed, blocked: data.blocked !== null })
              const problem = daysProblem(row)
              const daysId = `${idBase}-${row.kind}-days`
              return (
                <div className="mix-row" key={row.kind} data-testid={`mix-kind-${row.kind}`}>
                  <label className="mix-kind">
                    <input type="checkbox" checked={row.enabled} onChange={(e) => change(row.kind, { enabled: e.target.checked })} disabled={saving.busy} data-testid={`mix-enabled-${row.kind}`} />
                    <span className="mix-main">
                      <strong className="mix-title">{words.label}</strong>
                      <span className="hint">{words.about}</span>
                    </span>
                  </label>
                  <div className="mix-days">
                    <span className="muted" aria-hidden="true">
                      every
                    </span>
                    <input
                      id={daysId}
                      className="input mix-days-input"
                      inputMode="numeric"
                      value={row.days}
                      onChange={(e) => change(row.kind, { days: e.target.value })}
                      disabled={saving.busy}
                      aria-label={`Days between drafts: ${words.label}`}
                      aria-invalid={problem !== null}
                      aria-describedby={problem ? `${daysId}-problem` : undefined}
                      data-testid={`mix-days-${row.kind}`}
                    />
                    <span className="muted" aria-hidden="true">
                      days
                    </span>
                  </div>
                  <div className="mix-status" data-testid={`mix-status-${row.kind}`}>
                    {problem && (
                      <Hint className="bad" id={`${daysId}-problem`} data-testid={`mix-days-problem-${row.kind}`}>
                        {DAYS_PROBLEM}
                      </Hint>
                    )}
                    {statusLine(status) && (
                      <span className="hint" data-testid={`mix-status-line-${row.kind}`}>
                        {statusLine(status)}
                      </span>
                    )}
                    {status.problem && (
                      <Hint tone="warn" data-testid={`mix-problem-${row.kind}`}>
                        {status.problem}
                      </Hint>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {proposal && (
            <div className="note mix-proposed" role="status" data-testid="mix-proposed">
              <span>{proposalNote(dirty)}</span>
              {canUndoProposal(form, proposal) && (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setDraft(proposal.before)
                    setProposal(null)
                  }}
                  data-testid="mix-proposed-undo"
                >
                  Undo
                </Button>
              )}
            </div>
          )}
          <MixNotes productId={channel.productId} />
          <ErrorNote error={saving.error} />
          <div className="mix-foot">
            <p className="hint mix-foot-note" data-testid="mix-foot-note">
              {draftsOnlyLine(data)}
            </p>
            <div className="row">
              <Button variant={saveVariant} onClick={() => void submit()} disabled={!dirty || !valid || saving.busy} data-testid="mix-save">
                {saving.busy ? 'Saving…' : 'Save mix'}
              </Button>
              {dirty && (
                <Button
                  onClick={() => {
                    setDraft(null)
                    setProposal(null)
                  }}
                  disabled={saving.busy}
                  data-testid="mix-reset"
                >
                  Discard changes
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
