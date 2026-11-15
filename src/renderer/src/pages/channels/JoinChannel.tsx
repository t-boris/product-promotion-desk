import type { Account, Channel } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'
import { AgentRunPanel } from './AgentRunPanel'
import { JOIN_NOTE, joinButton, joinLabel } from './join-control'
import { capabilityOf } from './model'
import './channels.css'

/**
 * "Let the AI join r/x" (DEC-029), on the card of a channel whose platform can tell whether the account joined and whose account has not.
 * The press is the owner's approval: the AI opens the community in the account's browser and presses Join, nothing else (the core holds
 * it to that), and the app itself then reads whether the account is a member; the AI's word is not taken. It is an AI helper, so never
 * the screen's filled button. It renders into the row of actions of the card, which wraps: the button, its reason beside it, the one
 * sentence of what it does, and this channel's own run (progress, Stop) or how it ended, each on the line under.
 */
export function JoinChannel({ channel, account, canJoin }: { channel: Channel; account: Account; canJoin: boolean }) {
  const agent = useQuery('agent.state', { accountId: account.id }, ['accounts'])
  const readiness = useQuery('agent.canStart', { accountId: account.id, kind: 'join', channelId: channel.id }, ['accounts', 'settings', 'channels'])
  const browser = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
  const [join, joining] = useAction(() => call('agent.start', { accountId: account.id, kind: 'join', channelId: channel.id }))
  const [stop, stopping] = useAction(() => call('agent.stop', { accountId: account.id }))
  const run = agent.data ?? null
  const state = joinButton({
    platformCanJoin: canJoin,
    membershipStatus: capabilityOf(channel, 'membership')?.status,
    readiness: readiness.data,
    run,
    channelId: channel.id,
    ownerHolds: browser.data?.holder === 'user'
  })
  if (!state.show && !state.runPanel) return null
  return (
    <>
      {state.show && (
        <>
          <Button
            onClick={() => void join()}
            disabled={!state.enabled || joining.busy}
            aria-describedby={state.reason ? 'channel-join-reason' : undefined}
            data-testid="channel-join"
          >
            {joining.busy ? 'Starting…' : joinLabel(channel.target)}
          </Button>
          {state.reason && (
            <Hint className="row-note" id="channel-join-reason" data-testid="channel-join-reason">
              {state.reason}
            </Hint>
          )}
          <Hint className="join-line" data-testid="channel-join-note">
            {JOIN_NOTE}
          </Hint>
        </>
      )}
      <ErrorNote error={joining.error ?? stopping.error} />
      {state.runPanel && run && (
        <div className="join-line">
          <AgentRunPanel run={run} onStop={() => void stop()} stopping={stopping.busy} testId="channel-join-run" />
        </div>
      )}
    </>
  )
}
