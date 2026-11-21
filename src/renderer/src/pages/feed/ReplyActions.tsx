import type { ReactNode } from 'react'
import { Button } from '../../ui'
import type { WayOut } from './reply-composer'
import { ScheduleMenu } from './ScheduleMenu'

/**
 * The buttons of the reply window, and the line that says a comment is planned. All of it is the owner's own decision about the exact text above:
 * Send now, Schedule (a time chosen from a short menu, or any other), Edit in full (the card every draft has) and Copy. When a press did not go through
 * the row changes to what can be done about it (`way`): if the community's own rules are the reason, "Send anyway" and "Schedule anyway" (the owner lets
 * them through for this text, knowing what they say); for any other reason the same buttons and the post to open. The window decides what is said and when;
 * this only draws it.
 */
export function ReplyActions({
  way,
  plannedLine,
  working,
  stopped,
  posting,
  onSend,
  onSchedule,
  onCancelPlan,
  onEditFull,
  onCopy,
  onBack,
  copyDisabled,
  openPost
}: {
  way: WayOut | null
  /** "Scheduled for today 7:00 pm", or null when nothing is planned. */
  plannedLine: string | null
  /** Something is being done: nothing else can be pressed meanwhile. */
  working: boolean
  /** Why nothing can be sent or planned now (an empty text when it can). */
  stopped: string
  posting: boolean
  onSend: (anyway: boolean) => void
  onSchedule: (at: string, anyway: boolean) => void
  onCancelPlan: () => void
  onEditFull: () => void
  onCopy: () => void
  onBack: () => void
  copyDisabled: boolean
  /** The way to open the post (shown when something is in the way). */
  openPost: ReactNode
}) {
  const anyway = way === 'anyway'
  const shut = working || stopped !== ''
  return (
    <>
      {plannedLine && (
        <div className="reply-scheduled" data-testid="reply-scheduled">
          <span>{plannedLine}</span>
          <ScheduleMenu label="Change" variant="quiet" disabled={shut} onPick={(at) => onSchedule(at, false)} testId="reply-reschedule" />
          <Button variant="quiet" onClick={onCancelPlan} disabled={working} data-testid="reply-unschedule">
            Cancel
          </Button>
        </div>
      )}
      <div className="row reply-actions" data-testid="reply-actions" data-way={way ?? ''}>
        <Button variant="primary" onClick={() => onSend(anyway)} disabled={shut} data-testid={anyway ? 'reply-send-anyway' : 'reply-send'}>
          {posting ? 'Posting…' : anyway ? 'Send anyway' : 'Send now'}
        </Button>
        {(plannedLine === null || anyway) && (
          <ScheduleMenu label={anyway ? 'Schedule anyway' : 'Schedule'} disabled={shut} onPick={(at) => onSchedule(at, anyway)} testId={anyway ? 'reply-schedule-anyway' : 'reply-schedule'} />
        )}
        {!anyway && (
          <Button variant="secondary" onClick={onEditFull} disabled={shut} data-testid="reply-edit-full">
            Edit in full…
          </Button>
        )}
        <Button variant="secondary" onClick={onCopy} disabled={copyDisabled} data-testid="reply-copy">
          Copy the comment
        </Button>
        {way !== null && openPost}
        {anyway && (
          <Button variant="quiet" onClick={onBack} data-testid="reply-back">
            Back
          </Button>
        )}
      </div>
    </>
  )
}
