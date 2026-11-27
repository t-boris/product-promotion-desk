import { useState } from 'react'
import type { PostingSlot } from '../../../../shared/schedule'
import type { Channel } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Hint, useOpenForm } from '../../ui'
import { DAY_CHOICES, POSTING_TIMES_HINT, addTimes, removeTime, sameSlots, timesLine, weekRows } from './posting-times'

/**
 * The posting times of a channel (DEC-053): days of the week and times of day, in this Mac's time. They only choose a time for "Next free time";
 * nothing is sent because a time exists. The form keeps the owner's edits as unsaved state and "Save posting times" is the screen's filled button
 * only while it differs from what is saved (`useOpenForm`, like "Save settings").
 */
export function PostingTimesCard({ channel }: { channel: Channel }) {
  const saved = channel.settings.postingSlots
  const [slots, setSlots] = useState<PostingSlot[]>(saved)
  const [days, setDays] = useState<number[]>([])
  const [time, setTime] = useState('10:00')
  const [addError, setAddError] = useState<string | null>(null)
  const [save, state] = useAction((postingSlots: PostingSlot[]) => call('channels.updateSettings', { channelId: channel.id, settings: { postingSlots } }))
  const dirty = !sameSlots(slots, saved)
  const saveVariant = useOpenForm(dirty)
  const rows = weekRows(slots)

  const toggleDay = (weekday: number): void => setDays((chosen) => (chosen.includes(weekday) ? chosen.filter((d) => d !== weekday) : [...chosen, weekday]))
  const add = (): void => {
    const result = addTimes(slots, days, time)
    setAddError(result.ok ? null : result.error)
    if (result.ok) setSlots(result.slots)
  }

  return (
    <Card title="Posting times">
      <Hint>{POSTING_TIMES_HINT}</Hint>
      <div className="posting-times" data-testid="posting-times">
        {rows.length === 0 ? (
          <div className="muted" data-testid="posting-times-empty">
            {timesLine(0)}
          </div>
        ) : (
          rows.map((row) => (
            <div className="posting-times-row" key={row.weekday}>
              <span className="posting-times-day">{row.name}</span>
              <span className="posting-times-list">
                {row.times.map((t) => (
                  <span className="posting-time" key={t.minute}>
                    {t.label}
                    <button type="button" className="posting-time-remove" aria-label={`Remove ${row.name} ${t.label}`} title={`Remove ${row.name} ${t.label}`} onClick={() => setSlots(removeTime(slots, row.weekday, t.minute))}>
                      ×
                    </button>
                  </span>
                ))}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="posting-times-add">
        <div className="posting-times-days" role="group" aria-label="Days">
          {DAY_CHOICES.map((day) => (
            <label className="check" key={day.weekday} title={day.name}>
              <input type="checkbox" checked={days.includes(day.weekday)} onChange={() => toggleDay(day.weekday)} data-testid={`posting-day-${day.weekday}`} />
              {day.short}
            </label>
          ))}
        </div>
        <input className="input posting-times-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time of day" data-testid="posting-time-input" />
        <Button onClick={add} data-testid="posting-time-add">
          Add
        </Button>
      </div>
      <ErrorNote error={addError ?? state.error} />
      <div className="row">
        <Button variant={saveVariant} onClick={() => void save(slots)} disabled={!dirty || state.busy} data-testid="posting-times-save">
          {state.busy ? 'Saving…' : 'Save posting times'}
        </Button>
        {dirty && (
          <Button onClick={() => setSlots(saved)} data-testid="posting-times-reset">
            Discard changes
          </Button>
        )}
        {rows.length > 0 && <span className="muted small">{timesLine(slots.length)}</span>}
      </div>
    </Card>
  )
}
