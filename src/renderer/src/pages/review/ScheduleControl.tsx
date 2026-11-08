import { useEffect, useState } from 'react'
import type { IsoTime, Opportunity } from '../../../../shared/types'
import { Button, Field, formatTime } from '../../ui'

function toLocalInput(iso: IsoTime | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Planned send time for a standalone publication. Scheduling never approves anything: a publication goes out
 * at that time only if it is approved, and the SendGate checks it again at that moment.
 */
export function ScheduleControl({ opportunity, busy, onSchedule }: { opportunity: Opportunity; busy: boolean; onSchedule: (at: IsoTime | null) => void }) {
  const [value, setValue] = useState(() => toLocalInput(opportunity.scheduledAt))
  useEffect(() => setValue(toLocalInput(opportunity.scheduledAt)), [opportunity.scheduledAt])
  const changed = value !== toLocalInput(opportunity.scheduledAt)
  const approved = opportunity.state === 'ready'

  return (
    <div data-testid="schedule-control">
      <Field label="Send at" hint={approved ? 'Approved: it will be sent at this time if the checks still pass.' : 'It is sent at this time only after you approve it.'}>
        <div className="row">
          <input className="input" style={{ maxWidth: 240 }} type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} data-testid="schedule-input" />
          <Button onClick={() => onSchedule(new Date(value).toISOString())} disabled={busy || !value || !changed || Number.isNaN(new Date(value).getTime())} data-testid="schedule-save">
            Schedule
          </Button>
          {opportunity.scheduledAt && (
            <Button onClick={() => onSchedule(null)} disabled={busy} data-testid="schedule-clear">
              Clear
            </Button>
          )}
        </div>
      </Field>
      {opportunity.scheduledAt && <div className="muted small">Planned for {formatTime(opportunity.scheduledAt)}</div>}
    </div>
  )
}
