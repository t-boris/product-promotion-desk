import { useMemo } from 'react'
import { Button, IconButton } from '../../ui'
import { STATE_LABEL } from './PostsList'
import { calendarEntries, canWriteOn, monthGrid, monthTitle, shiftMonth, type CalendarDay, type YearMonth } from './posts-calendar'
import type { PostRow } from './posts-filter'
import { shortTime } from './short-time'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** A cell shows this many posts; the rest are said as a count, and all of them are in the day's list below the grid. */
const PER_CELL = 2

/** "Nov 12" for a day key of the grid. */
function dayName(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * The month of planned and sent posts (DEC-037, phase B): a post is on the day it goes out or went out, in the viewer's own day, and the
 * faint lines are the days the content mix would prepare a draft. A day is chosen by pressing it; the chosen day lists its posts under the
 * grid and, when nothing is on it and it is not past, offers "Write one myself" for that date.
 */
export function PostsCalendar({
  rows,
  month,
  onMonth,
  today,
  offsetMinutes,
  rhythm,
  dates,
  day,
  onDay,
  onOpen,
  onWrite
}: {
  rows: PostRow[]
  month: YearMonth
  onMonth: (month: YearMonth) => void
  /** The viewer's today, "YYYY-MM-DD". */
  today: string
  offsetMinutes: number
  /** The content mix's due days by day, with the names of the kinds. */
  rhythm: ReadonlyMap<string, string[]>
  /** The names of the product's dates ahead, by day (DEC-060). */
  dates: ReadonlyMap<string, string[]>
  day: string | null
  onDay: (date: string) => void
  /** Show a post in the list view. */
  onOpen: (rowId: string) => void
  /** Start a post planned for this day. */
  onWrite: (date: string) => void
}) {
  const weeks = useMemo(() => monthGrid(month, calendarEntries(rows), today, offsetMinutes, 0, rhythm), [rows, month, today, offsetMinutes, rhythm])
  const chosen: CalendarDay | undefined = weeks.flat().find((cell) => cell.date === day)
  const [thisYear, thisMonth] = today.split('-').map(Number)
  const onThisMonth = month.year === thisYear && month.month === thisMonth - 1

  return (
    <div className="posts-calendar" data-testid="posts-calendar">
      <div className="posts-cal-head">
        <IconButton icon="chevronRight" label="Previous month" className="flip" onClick={() => onMonth(shiftMonth(month, -1))} data-testid="calendar-prev" />
        <h2 className="posts-cal-title" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <IconButton icon="chevronRight" label="Next month" onClick={() => onMonth(shiftMonth(month, 1))} data-testid="calendar-next" />
        <Button onClick={() => onMonth({ year: thisYear, month: thisMonth - 1 })} disabled={onThisMonth} data-testid="calendar-today">
          Today
        </Button>
      </div>
      <div className="posts-cal-grid" role="grid" aria-label={monthTitle(month)}>
        <div className="posts-cal-week posts-cal-weekdays" role="row">
          {WEEKDAYS.map((name) => (
            <span key={name} role="columnheader" className="posts-cal-weekday">
              {name}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].date} className="posts-cal-week" role="row">
            {week.map((cell) => {
              const shown = cell.entries.slice(0, PER_CELL)
              const more = cell.entries.length - shown.length
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={cell.date === day}
                  aria-current={cell.isToday ? 'date' : undefined}
                  className={`posts-cal-day${cell.inMonth ? '' : ' outside'}${cell.isPast ? ' past' : ''}${cell.isToday ? ' today' : ''}${cell.date === day ? ' chosen' : ''}`}
                  onClick={() => onDay(cell.date)}
                  data-testid={`calendar-day-${cell.date}`}
                >
                  <span className="posts-cal-num">{Number(cell.date.slice(8))}</span>
                  {shown.map((entry) => (
                    <span key={entry.id} className={`posts-cal-entry ${entry.kind}`} title={`${entry.title} · ${entry.target}`}>
                      {entry.target}
                    </span>
                  ))}
                  {more > 0 && <span className="posts-cal-more">+{more} more</span>}
                  {(dates.get(cell.date) ?? []).length > 0 && (
                    <span className="posts-cal-date" title={(dates.get(cell.date) ?? []).join(', ')}>
                      {(dates.get(cell.date) ?? []).join(', ')}
                    </span>
                  )}
                  {cell.rhythm.length > 0 && (
                    <span className="posts-cal-rhythm" title={`The content mix would prepare: ${cell.rhythm.join(', ')}`}>
                      {cell.rhythm.join(', ')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {chosen && (
        <section className="posts-cal-day-panel" aria-label={dayName(chosen.date)} data-testid="calendar-day-panel">
          <h3>{dayName(chosen.date)}</h3>
          {chosen.entries.length === 0 ? <p className="muted">Nothing is planned or sent on this day.</p> : null}
          <ul className="posts-cal-agenda">
            {chosen.entries.map((entry) => (
              <li key={entry.id}>
                <span className="posts-cal-agenda-time">{shortTime(entry.at)}</span>
                <span className="posts-cal-agenda-text">
                  <strong>{entry.title}</strong> · {entry.target} · {STATE_LABEL[entry.state]}
                </span>
                <Button variant="quiet" className="accent" onClick={() => onOpen(entry.rowId)} data-testid={`calendar-open-${entry.id}`}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
          {chosen.rhythm.length > 0 && <p className="muted">The content mix would prepare a draft this day: {chosen.rhythm.join(', ')}.</p>}
          {canWriteOn(chosen) && (
            <Button onClick={() => onWrite(chosen.date)} data-testid="calendar-write">
              Write one myself
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
