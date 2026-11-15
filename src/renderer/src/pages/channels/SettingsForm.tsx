import { useState } from 'react'
import type { Channel } from '../../../../shared/types'
import { AiField } from '../../assist/AiField'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field, useOpenForm } from '../../ui'
import { clockTime, isWatchable } from '../feed/watching-line'
import { CUSTOM_INTERVAL, CUSTOM_INTERVAL_HINT, INTERVAL_HINT, LOOK_BACK_HINT, intervalChoice, intervalChoices, isIntervalPreset, lookBackChoices, lookBackDoneHint, queriesHint } from './check-schedule'
import { fromDraft, toDraft, type SettingsDraft } from './form'

/**
 * Language, style, topics, queries, how often to check and how far back the first look goes (a preset or a number of minutes; DEC-040), limits, automatic
 * categories (a channel the app does not read has no interval, first look, topics, queries or automatic replies; one the AI watches in the browser has all but the
 * automatic replies, which need a connector, DEC-042), daily summary and notifications. "Save settings" is the filled
 * button only while the form has unsaved changes (then the setup stage's own button steps back to a bezel, see `useOpenForm`). The AI can
 * write or improve the style, the topics and the queries; numbers and switches that decide what goes out stay the owner's choice.
 */
export function SettingsForm({ channel }: { channel: Channel }) {
  const initial = toDraft(channel.settings)
  const lookedBackAt = channel.lookedBackAt
  const [draft, setDraft] = useState<SettingsDraft>(initial)
  const [formError, setFormError] = useState<string | null>(null)
  const [save, state] = useAction((settings: Partial<Channel['settings']>) => call('channels.updateSettings', { channelId: channel.id, settings }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const saveVariant = useOpenForm(dirty)
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  // "Custom…" is the owner's choice and stays while they type, even when the minutes typed equal a preset. A stored value that is no preset starts as Custom.
  const [customInterval, setCustomInterval] = useState(!isIntervalPreset(initial.checkIntervalMin))
  const pickInterval = (value: string): void => {
    setCustomInterval(value === CUSTOM_INTERVAL)
    if (value !== CUSTOM_INTERVAL) set('checkIntervalMin', value)
  }
  const { blocked } = useAssistBlock({ productId: channel.productId })
  // What only matters when the app looks at the channel (how often, how far back the first look goes, what to watch) is left out of a channel it neither reads nor watches in the
  // browser (DEC-034, DEC-042), and which replies may go out by themselves is left out of every channel without a connector; the values stay in the draft, so saving never drops them.
  const reads = channel.reads
  const watched = isWatchable(channel)
  /** What is written in the other text fields of the form, so the AI fits the field into the channel's settings. */
  const around = (skip: 'style' | 'topics' | 'queries'): { label: string; text: string }[] =>
    (
      [
        { key: 'style', label: 'Style of replies', text: draft.style },
        { key: 'topics', label: 'Topics to watch', text: draft.topics },
        { key: 'queries', label: 'Search queries', text: draft.queries }
      ] as const
    )
      .filter((item) => item.key !== skip && item.text.trim() !== '')
      .map(({ label, text }) => ({ label, text }))

  async function submit(): Promise<void> {
    const parsed = fromDraft(draft)
    if (!parsed.ok) {
      setFormError(parsed.error)
      return
    }
    setFormError(null)
    await save(parsed.settings)
  }

  return (
    <Card title="Channel settings">
      <div className="form-row">
        <Field label="Languages" hint="Language codes, separated by commas, e.g. en, es.">
          <input className="input" value={draft.languages} onChange={(e) => set('languages', e.target.value)} data-testid="settings-languages" />
        </Field>
        {watched && (
          <Field label="Check every" hint={INTERVAL_HINT}>
            <select className="input" value={intervalChoice(draft.checkIntervalMin, customInterval)} onChange={(e) => pickInterval(e.target.value)} data-testid="settings-interval-choice">
              {intervalChoices().map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {watched && intervalChoice(draft.checkIntervalMin, customInterval) === CUSTOM_INTERVAL && (
          <Field label="Custom (minutes)" hint={CUSTOM_INTERVAL_HINT}>
            <input className="input" inputMode="numeric" value={draft.checkIntervalMin} onChange={(e) => set('checkIntervalMin', e.target.value)} data-testid="settings-interval" />
          </Field>
        )}
        {watched && (
          <Field label="First look" hint={lookedBackAt ? lookBackDoneHint(clockTime(lookedBackAt, { now: new Date() })) : LOOK_BACK_HINT}>
            <select className="input" value={draft.lookBackDays} onChange={(e) => set('lookBackDays', e.target.value)} disabled={lookedBackAt !== null} data-testid="settings-look-back">
              {lookBackChoices(initial.lookBackDays).map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="wide">
          <AiField label={reads ? 'Style of replies' : 'Style of posts'} hint="How the product should sound here, e.g. warm, short, no hype." field="channel.style" channelId={channel.id} value={draft.style} onChange={(text) => set('style', text)} around={around('style')} blocked={blocked} testId="settings-style-ai">
            {(id) => <textarea id={id} className="input short" value={draft.style} onChange={(e) => set('style', e.target.value)} data-testid="settings-style" />}
          </AiField>
        </div>
        {watched && (
          <div className="wide form-pair">
            <AiField label="Topics to watch" hint="One per line or separated by commas." field="channel.topics" channelId={channel.id} value={draft.topics} onChange={(text) => set('topics', text)} around={around('topics')} blocked={blocked} testId="settings-topics-ai">
              {(id) => <textarea id={id} className="input short" value={draft.topics} onChange={(e) => set('topics', e.target.value)} data-testid="settings-topics" />}
            </AiField>
            <AiField label="Search queries" hint={queriesHint(channel)} field="channel.queries" channelId={channel.id} value={draft.queries} onChange={(text) => set('queries', text)} around={around('queries')} blocked={blocked} testId="settings-queries-ai">
              {(id) => <textarea id={id} className="input short" value={draft.queries} onChange={(e) => set('queries', e.target.value)} data-testid="settings-queries" />}
            </AiField>
          </div>
        )}
        <Field label="Messages per hour (at most)" hint="0 means none.">
          <input className="input" inputMode="numeric" value={draft.perHour} onChange={(e) => set('perHour', e.target.value)} data-testid="settings-per-hour" />
        </Field>
        <Field label="Messages per day (at most)">
          <input className="input" inputMode="numeric" value={draft.perDay} onChange={(e) => set('perDay', e.target.value)} data-testid="settings-per-day" />
        </Field>
        {reads && (
          <div className="wide">
            <span className="field-label">Replies that may go out automatically</span>
            <p className="muted small">Used only in automatic mode, and only for simple cases. Everything else still waits for you.</p>
            <label className="check">
              <input type="checkbox" checked={draft.thanks} onChange={(e) => set('thanks', e.target.checked)} data-testid="settings-auto-thanks" />
              Thank-you messages
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.faq} onChange={(e) => set('faq', e.target.checked)} data-testid="settings-auto-faq" />
              Factual questions answered from approved facts
            </label>
          </div>
        )}
        <div>
          <label className="check">
            <input type="checkbox" checked={draft.digestOn} onChange={(e) => set('digestOn', e.target.checked)} data-testid="settings-digest-on" />
            Daily summary
          </label>
          <input className="input" type="time" value={draft.digestTime} disabled={!draft.digestOn} onChange={(e) => set('digestTime', e.target.value)} data-testid="settings-digest-time" />
        </div>
        <div>
          <label className="check">
            <input type="checkbox" checked={draft.notifications} onChange={(e) => set('notifications', e.target.checked)} data-testid="settings-notifications" />
            Notify me about this channel
          </label>
        </div>
      </div>
      <ErrorNote error={formError ?? state.error} />
      <div className="row">
        <Button variant={saveVariant} onClick={() => void submit()} disabled={!dirty || state.busy} data-testid="settings-save">
          {state.busy ? 'Saving…' : 'Save settings'}
        </Button>
        {dirty && (
          <Button
            onClick={() => {
              setDraft(initial)
              setCustomInterval(!isIntervalPreset(initial.checkIntervalMin))
            }}
            data-testid="settings-reset"
          >
            Discard changes
          </Button>
        )}
      </div>
    </Card>
  )
}
