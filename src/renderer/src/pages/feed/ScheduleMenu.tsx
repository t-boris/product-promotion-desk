import { useState } from 'react'
import { Button, MenuItem, usePopover } from '../../ui'
import { Icon } from '../../icons'
import { localInputValue, pickedTime, scheduleChoices, type ScheduleChoice } from './reply-composer'

/**
 * "Schedule ▾" of the reply window: three times the owner can take with one press (in an hour, this evening, tomorrow morning) and "Pick a time…" for any
 * other. A press on a time calls `onPick` with it and closes the menu; nothing is decided here beyond that. The times are worked out when the menu opens,
 * so "this evening" is never offered after seven.
 */
export function ScheduleMenu({
  label,
  disabled,
  onPick,
  variant = 'secondary',
  testId
}: {
  label: string
  disabled?: boolean
  onPick: (at: string) => void
  variant?: 'secondary' | 'quiet'
  testId: string
}) {
  const { open, setOpen, box } = usePopover()
  const [choices, setChoices] = useState<ScheduleChoice[]>([])
  const [picking, setPicking] = useState(false)
  const [value, setValue] = useState('')
  const [now, setNow] = useState(() => new Date())

  const toggle = (): void => {
    if (!open) {
      const at = new Date()
      setNow(at)
      setChoices(scheduleChoices(at))
      setPicking(false)
      setValue('')
    }
    setOpen(!open)
  }
  const take = (at: string): void => {
    setOpen(false)
    onPick(at)
  }
  const picked = pickedTime(value, now)

  return (
    <div className="menu" ref={box}>
      <Button variant={variant} aria-haspopup="menu" aria-expanded={open} onClick={toggle} disabled={disabled} data-testid={testId}>
        {label}
        <Icon name="chevronDown" small />
      </Button>
      {open && (
        <div className="menu-pop reply-schedule-pop" role="menu" data-testid={`${testId}-menu`}>
          {choices.map((choice) => (
            <MenuItem key={choice.id} onClick={() => take(choice.at)} data-testid={`${testId}-${choice.id}`}>
              {choice.label}
            </MenuItem>
          ))}
          {!picking ? (
            <MenuItem onClick={() => setPicking(true)} data-testid={`${testId}-pick`}>
              Pick a time…
            </MenuItem>
          ) : (
            <div className="reply-schedule-pick" data-testid={`${testId}-picker`}>
              <input
                className="input"
                type="datetime-local"
                value={value}
                min={localInputValue(now)}
                aria-label="The time to send at"
                onChange={(e) => setValue(e.target.value)}
                data-testid={`${testId}-input`}
              />
              {value !== '' && !picked.ok && <span className="muted small">{picked.message}</span>}
              <Button variant="primary" disabled={!picked.ok} onClick={() => picked.ok && take(picked.at)} data-testid={`${testId}-go`}>
                Schedule
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
