import { useState } from 'react'
import type { LogLevel } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Badge, EmptyState, ErrorNote, Loading, formatTime } from '../../ui'
import { LEVEL_TONE } from './labels'

/** Log lines written by the application, with a level filter. */
export function EventsTab() {
  const [level, setLevel] = useState<LogLevel | ''>('')
  const events = useQuery('logs.list', { limit: 300, level: level || undefined }, ['logs'])

  return (
    <div className="stack" data-testid="events-tab">
      <div className="row">
        <label className="row small" htmlFor="log-level-filter">
          Level
        </label>
        <select id="log-level-filter" className="input" style={{ width: 'auto' }} value={level} onChange={(e) => setLevel(e.target.value as LogLevel | '')} data-testid="log-level-filter">
          <option value="">All</option>
          <option value="info">Info</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
      </div>
      <ErrorNote error={events.error} />
      {events.loading && !events.data && <Loading what="Loading events" />}
      {events.data?.length === 0 && <EmptyState title="No events">{level ? 'No events at this level.' : 'Nothing has been logged yet.'}</EmptyState>}
      {events.data && events.data.length > 0 && (
        <table className="table" data-testid="events-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Source</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {events.data.map((event) => (
              <tr key={event.id} data-testid={`event-${event.id}`}>
                <td>{formatTime(event.ts)}</td>
                <td>
                  <Badge tone={LEVEL_TONE[event.level]}>{event.level}</Badge>
                </td>
                <td>{event.source}</td>
                <td style={{ wordBreak: 'break-word' }}>{event.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
