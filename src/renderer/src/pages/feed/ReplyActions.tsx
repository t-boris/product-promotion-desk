import type { ReactNode } from 'react'
import { Button } from '../../ui'
import { ScheduleMenu } from './ScheduleMenu'

/**
 * The buttons of the reply window, and the line that says a comment is planned. All of it is the owner's own decision about the exact text above:
 * Send now, Schedule (a time chosen from a short menu, or any other), Edit in full (the card every draft has) and Copy. When a press did not go through
 * (`byHand`) the post can be opened beside them, to do it by hand. What a community's rules say never stops a press and is never shown here (DEC-050). The window
 * decides what is said and when; this only draws it.
 */
export function ReplyActions({
  byHand,
  plannedLine,
  working,
  stopped,
  posting,
  onSend,
  onSchedule,
  onCancelPlan,
  onEditFull,
  onCopy,
  copyDisabled,
  openPost
}: {
  /** A press did not go through: the post can be opened to do it by hand. */
  byHand: boolean
  /** "Scheduled for today 7:00 pm", or null when nothing is planned. */
  plannedLine: string | null
  /** Something is being done: nothing else can be pressed meanwhile. */
  working: boolean
  /** Why nothing can be sent or planned now (an empty text when it can). */
  stopped: string
  posting: boolean
  onSend: () => void
  onSchedule: (at: string) => void
  onCancelPlan: () => void
  onEditFull: () => void
  onCopy: () => void
  copyDisabled: boolean
  /** The way to open the post (shown when something is in the way). */
  openPost: ReactNode
}) {
  const shut = working || stopped !== ''
  return (
    <>
      {plannedLine && (
        <div className="reply-scheduled" data-testid="reply-scheduled">
          <span>{plannedLine}</span>
          <ScheduleMenu label="Change" variant="quiet" disabled={shut} onPick={onSchedule} testId="reply-reschedule" />
          <Button variant="quiet" onClick={onCancelPlan} disabled={working} data-testid="reply-unschedule">
            Cancel
          </Button>
        </div>
      )}
      <div className="row reply-actions" data-testid="reply-actions" data-by-hand={byHand ? 'yes' : ''}>
        <Button variant="primary" onClick={onSend} disabled={shut} data-testid="reply-send">
          {posting ? 'Posting…' : 'Send now'}
        </Button>
        {plannedLine === null && <ScheduleMenu label="Schedule" disabled={shut} onPick={onSchedule} testId="reply-schedule" />}
        <Button variant="secondary" onClick={onEditFull} disabled={shut} data-testid="reply-edit-full">
          Edit in full…
        </Button>
        <Button variant="secondary" onClick={onCopy} disabled={copyDisabled} data-testid="reply-copy">
          Copy the comment
        </Button>
        {byHand && openPost}
      </div>
    </>
  )
}
