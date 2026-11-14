import { useState } from 'react'
import type { Channel } from '../../../../shared/types'
import { AiField } from '../../assist/AiField'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field, useOpenForm } from '../../ui'
import { fromDraft, toDraft, type SettingsDraft } from './form'

/**
 * Language, style, topics, queries, interval, limits, automatic categories, daily summary and notifications. "Save settings" is the filled
 * button only while the form has unsaved changes (then the setup stage's own button steps back to a bezel, see `useOpenForm`). The AI can
 * write or improve the style, the topics and the queries; numbers and switches that decide what goes out stay the owner's choice.
 */
export function SettingsForm({ channel }: { channel: Channel }) {
  const initial = toDraft(channel.settings)
  const [draft, setDraft] = useState<SettingsDraft>(initial)
  const [formError, setFormError] = useState<string | null>(null)
  const [save, state] = useAction((settings: Channel['settings']) => call('channels.updateSettings', { channelId: channel.id, settings }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const saveVariant = useOpenForm(dirty)
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  const { blocked } = useAssistBlock({ productId: channel.productId })
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
        <Field label="Check every (minutes)" hint="At least 5.">
          <input className="input" inputMode="numeric" value={draft.checkIntervalMin} onChange={(e) => set('checkIntervalMin', e.target.value)} data-testid="settings-interval" />
        </Field>
        <div className="wide">
          <AiField label="Style of replies" hint="How the product should sound here, e.g. warm, short, no hype." field="channel.style" channelId={channel.id} value={draft.style} onChange={(text) => set('style', text)} around={around('style')} blocked={blocked} testId="settings-style-ai">
            {(id) => <textarea id={id} className="input short" value={draft.style} onChange={(e) => set('style', e.target.value)} data-testid="settings-style" />}
          </AiField>
        </div>
        <div className="wide form-pair">
          <AiField label="Topics to watch" hint="One per line or separated by commas." field="channel.topics" channelId={channel.id} value={draft.topics} onChange={(text) => set('topics', text)} around={around('topics')} blocked={blocked} testId="settings-topics-ai">
            {(id) => <textarea id={id} className="input short" value={draft.topics} onChange={(e) => set('topics', e.target.value)} data-testid="settings-topics" />}
          </AiField>
          <AiField label="Search queries" hint="One per line or separated by commas." field="channel.queries" channelId={channel.id} value={draft.queries} onChange={(text) => set('queries', text)} around={around('queries')} blocked={blocked} testId="settings-queries-ai">
            {(id) => <textarea id={id} className="input short" value={draft.queries} onChange={(e) => set('queries', e.target.value)} data-testid="settings-queries" />}
          </AiField>
        </div>
        <Field label="Messages per hour (at most)" hint="0 means none.">
          <input className="input" inputMode="numeric" value={draft.perHour} onChange={(e) => set('perHour', e.target.value)} data-testid="settings-per-hour" />
        </Field>
        <Field label="Messages per day (at most)">
          <input className="input" inputMode="numeric" value={draft.perDay} onChange={(e) => set('perDay', e.target.value)} data-testid="settings-per-day" />
        </Field>
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
          <Button onClick={() => setDraft(initial)} data-testid="settings-reset">
            Discard changes
          </Button>
        )}
      </div>
    </Card>
  )
}
