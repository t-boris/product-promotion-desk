import { useState } from 'react'
import { CALENDAR_KINDS, CALENDAR_LABEL, type CalendarKind } from '../../../../shared/seasonal'
import type { Product, SeasonalEventView, SeasonalView } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Hint } from '../../ui'
import { MONTHS, inDays, orderedEvents, ownDateLine, prepareFrom, standingOf } from './dates-ahead'

const dayOf = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/**
 * The dates ahead of a product (DEC-060): the calendars the owner follows (computed moon phases, sign seasons, turning points of the year, gift
 * dates), the owner's own dates, and for each date the channels it is time to prepare for. "Prepare a post" asks the AI for a draft for one
 * date and one channel; it waits on this screen like any other draft.
 */
export function DatesAhead({ product, view, onPrepared }: { product: Product; view: SeasonalView; onPrepared: (opportunityId: string) => void }) {
  const [setKinds, settingKinds] = useAction((kinds: CalendarKind[]) => call('seasonal.setKinds', { productId: product.id, kinds }))
  const [adding, setAdding] = useState(false)
  const toggle = (kind: CalendarKind): void => void setKinds(view.kinds.includes(kind) ? view.kinds.filter((k) => k !== kind) : [...view.kinds, kind])
  const events = orderedEvents(view.events)
  const nothingChosen = view.kinds.length === 0 && view.own.length === 0
  return (
    <Card title="Dates ahead" actions={<Button onClick={() => setAdding(!adding)} data-testid="dates-add-open">{adding ? 'Close' : 'Add a date of my own'}</Button>}>
      <Hint>Dates worth a post, shown eleven weeks ahead. A search-like place such as Pinterest needs a post five weeks before the date, a video two weeks, a feed one week. The application computes or lists the dates; the AI writes a draft only when you press “Prepare a post”.</Hint>
      <div className="dates-kinds" role="group" aria-label="Calendars to follow">
        {CALENDAR_KINDS.map((kind) => (
          <label key={kind} className="dates-kind" title={CALENDAR_LABEL[kind].note}>
            <input type="checkbox" checked={view.kinds.includes(kind)} onChange={() => toggle(kind)} disabled={settingKinds.busy} data-testid={`dates-kind-${kind}`} /> {CALENDAR_LABEL[kind].title}
          </label>
        ))}
      </div>
      {adding && <AddDate productId={product.id} onDone={() => setAdding(false)} />}
      {view.own.length > 0 && (
        <ul className="dates-own" data-testid="dates-own">
          {view.own.map((date) => (
            <OwnDateRow key={date.id} id={date.id} line={`${date.name} · ${ownDateLine(date)}`} />
          ))}
        </ul>
      )}
      {nothingChosen ? (
        <p className="muted" data-testid="dates-empty">Choose a calendar to follow or add a date of your own.</p>
      ) : events.length === 0 ? (
        <p className="muted" data-testid="dates-empty">No date in the next eleven weeks.</p>
      ) : (
        <ul className="dates-list" data-testid="dates-list">
          {events.map((event) => (
            <EventRow key={event.key} productId={product.id} event={event} onPrepared={onPrepared} />
          ))}
        </ul>
      )}
      <ErrorNote error={settingKinds.error} />
    </Card>
  )
}

function OwnDateRow({ id, line }: { id: string; line: string }) {
  const [remove, removing] = useAction(() => call('seasonal.removeDate', { id }))
  return (
    <li className="dates-own-row">
      <span>{line}</span>
      <Button onClick={() => void remove()} disabled={removing.busy} data-testid={`dates-own-remove-${id}`}>
        Remove
      </Button>
      <ErrorNote error={removing.error} />
    </li>
  )
}

function AddDate({ productId, onDone }: { productId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [month, setMonth] = useState(1)
  const [day, setDay] = useState(1)
  const [yearly, setYearly] = useState(true)
  const [year, setYear] = useState(new Date().getFullYear())
  const [add, addingState] = useAction(async () => {
    await call('seasonal.addDate', { productId, name, month, day, year: yearly ? null : year })
    onDone()
  })
  return (
    <div className="dates-add" data-testid="dates-add">
      <input className="input" placeholder="What the date is, e.g. Shop birthday" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Name of the date" data-testid="dates-add-name" />
      <select className="input dates-add-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
        {MONTHS.map((label, index) => (
          <option key={label} value={index + 1}>
            {label}
          </option>
        ))}
      </select>
      <input className="input dates-add-num" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Day" />
      <label className="dates-kind">
        <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> Every year
      </label>
      {!yearly && <input className="input dates-add-num" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />}
      <Button variant="primary" onClick={() => void add()} disabled={addingState.busy || name.trim() === ''} data-testid="dates-add-save">
        {addingState.busy ? 'Adding…' : 'Add the date'}
      </Button>
      <ErrorNote error={addingState.error} />
    </div>
  )
}

function EventRow({ productId, event, onPrepared }: { productId: string; event: SeasonalEventView; onPrepared: (opportunityId: string) => void }) {
  const standing = standingOf(event)
  const [skip, skipping] = useAction(() => call('seasonal.skip', { productId, eventKey: event.key, skipped: !event.skipped }))
  const [busyChannel, setBusyChannel] = useState<string | null>(null)
  const [prepare, preparing] = useAction(async (channelId: string) => {
    setBusyChannel(channelId)
    try {
      const card = await call('seasonal.prepare', { productId, eventKey: event.key, channelId })
      onPrepared(card.opportunity.id)
    } finally {
      setBusyChannel(null)
    }
  })
  return (
    <li className={`dates-row${event.skipped ? ' skipped' : ''}`} data-testid={`date-${event.key}`}>
      <div className="dates-row-head">
        <span className="dates-name">{event.name}</span>
        <span className="muted">
          {dayOf(event.at)} · {inDays(event.days)}
        </span>
        {standing === 'due' && <Badge tone="warn">Time to prepare</Badge>}
        {standing === 'prepared' && <Badge tone="good">Prepared</Badge>}
        {standing === 'skipped' && <Badge>Skipped</Badge>}
        <Button onClick={() => void skip()} disabled={skipping.busy} data-testid={`date-skip-${event.key}`}>
          {event.skipped ? 'Bring back' : 'Skip this date'}
        </Button>
      </div>
      {!event.skipped && event.channels.length > 0 && (
        <ul className="dates-channels">
          {event.channels.map((channel) => (
            <li key={channel.channelId} className="dates-channel">
              <span>{channel.target}</span>
              {channel.opportunityId ? (
                <button type="button" className="link-btn" onClick={() => onPrepared(channel.opportunityId as string)}>
                  Open the prepared post
                </button>
              ) : (
                <>
                  <span className="muted">prepare {prepareFrom(event.days, channel.leadDays)}</span>
                  <Button onClick={() => void prepare(channel.channelId)} disabled={preparing.busy} data-testid={`date-prepare-${event.key}-${channel.channelId}`}>
                    {busyChannel === channel.channelId ? 'Preparing…' : 'Prepare a post'}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!event.skipped && event.channels.length === 0 && <p className="muted">No active channel to prepare for.</p>}
      <ErrorNote error={preparing.error ?? skipping.error} />
    </li>
  )
}
