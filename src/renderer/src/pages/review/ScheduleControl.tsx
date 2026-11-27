import { useEffect, useState } from 'react'
import type { IsoTime, Opportunity } from '../../../../shared/types'
import { Button, Field, formatTime } from '../../ui'
import { NO_SLOTS_TITLE, scheduleHint } from './schedule-words'

function toLocalInput(iso: IsoTime | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Planned send time of a post or a reply, on any channel (DEC-053). Scheduling never approves anything: an item goes out at that time only if it was
 * approved before it, and the SendGate checks it again at that moment. "Next free time" takes the first of the channel's posting times that no other
 * item of the channel holds; a channel without posting times says where to add them.
 */
export function ScheduleControl({
  opportunity,
  slots,
  channelHref,
  busy,
  onSchedule,
  onEnqueue
}: {
  opportunity: Opportunity
  slots: number
  channelHref: string
  busy: boolean
  onSchedule: (at: IsoTime | null) => void
  onEnqueue: () => void
}) {
  const [value, setValue] = useState(() => toLocalInput(opportunity.scheduledAt))
  useEffect(() => setValue(toLocalInput(opportunity.scheduledAt)), [opportunity.scheduledAt])
  const changed = value !== toLocalInput(opportunity.scheduledAt)
  const approved = opportunity.state === 'ready'

  return (
    <div className="schedule" data-testid="schedule-control">
      <Field label="Send at" hint={scheduleHint(approved)}>
        <div className="schedule-row">
          <input className="input schedule-input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} data-testid="schedule-input" />
          <Button onClick={() => onSchedule(new Date(value).toISOString())} disabled={busy || !value || !changed || Number.isNaN(new Date(value).getTime())} data-testid="schedule-save">
            Schedule
          </Button>
          <Button onClick={onEnqueue} disabled={busy || slots === 0} title={slots === 0 ? NO_SLOTS_TITLE : undefined} data-testid="schedule-next-slot">
            Next free time
          </Button>
          {opportunity.scheduledAt && (
            <Button variant="quiet" onClick={() => onSchedule(null)} disabled={busy} data-testid="schedule-clear">
              Clear
            </Button>
          )}
        </div>
      </Field>
      {slots === 0 && (
        <div className="muted small" data-testid="schedule-no-slots">
          “Next free time” uses the channel’s posting times. <a href={channelHref}>Add posting times</a>
        </div>
      )}
      {opportunity.scheduledAt && <div className="muted small">Planned for {formatTime(opportunity.scheduledAt)}</div>}
    </div>
  )
}
