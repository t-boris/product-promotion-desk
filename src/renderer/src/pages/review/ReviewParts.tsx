import type { ReactNode } from 'react'
import type { OpportunityCard } from '../../../../shared/types'
import { Badge, Button, ErrorNote } from '../../ui'
import { ActionSummary } from './ActionSummary'
import { AlsoPostPanel } from './AlsoPostPanel'
import { DraftEditor } from './DraftEditor'
import { ReviewButtons } from './ReviewButtons'
import { ScheduleControl } from './ScheduleControl'
import { ThreadView } from './ThreadView'
import { CATEGORY_LABEL, DECISION_LABEL, KIND_LABEL, STATE_LABEL, STATE_TONE } from './labels'
import { QuickComposer } from './quick/QuickComposer'
import { QUICK_SLOTS } from './quick/quick-slots'
import { removalWords } from './removal-words'
import type { ReviewItem } from './useReviewItem'
import './review.css'

/** Where the item is and what it is: its state and kind, the product (where products are mixed), the channel and the account it speaks as. */
export function ReviewIdentity({ card, productName, tags }: { card: OpportunityCard; productName?: string; /** Tags after the kind of the item (a version of a group says "Edited by you"). */ tags?: ReactNode }) {
  const opp = card.opportunity
  return (
    <div className="review-id">
      <Badge tone={STATE_TONE[opp.state]}>{opp.state === 'cancelled' && opp.kind === 'standalone' ? removalWords('standalone').list : STATE_LABEL[opp.state]}</Badge>
      <Badge>{KIND_LABEL[opp.kind]}</Badge>
      {opp.category && <Badge>{CATEGORY_LABEL[opp.category]}</Badge>}
      {opp.decision && opp.decision !== 'reply' && <Badge tone="warn">{DECISION_LABEL[opp.decision]}</Badge>}
      {tags}
      {productName && (
        <span className="review-product" data-testid="card-product">
          {productName}
        </span>
      )}
      <strong data-testid="card-channel">{card.channelTarget}</strong>
      <span className="review-account">as {card.accountLabel}</span>
    </div>
  )
}

/**
 * The content of an item that needs a decision: why it is in its state, the conversation, the draft in its editor, a schedule for a
 * post, what was approved or sent, and the "Also post to…" panel. Everything the owner needs to decide, without the buttons: they
 * are `ReviewActionRow`, which a card puts right below and the Inbox pins to the bottom of its detail.
 */
export function ReviewBody({ item, notes }: { item: ReviewItem; /** What the owner should read with the draft before deciding, under it (how a version goes out, what the platform will refuse). */ notes?: ReactNode }) {
  const { card } = item
  const opp = card.opportunity
  const { standalone, locked, working, actions } = item
  return (
    <>
      {(opp.reason || item.hint) && (
        <div className="review-state">
          {opp.reason && (
            <div data-testid="state-reason">
              <strong>{opp.reason}</strong>
            </div>
          )}
          {item.hint && (
            <div className="muted small" data-testid={item.conflict ? 'login-conflict-hint' : 'state-hint'}>
              {item.hint}
            </div>
          )}
        </div>
      )}
      {!standalone && <ThreadView card={card} />}
      {standalone && opp.destination && (
        <div className="muted small">
          Will be posted to <code>{opp.destination}</code>
        </div>
      )}

      {/* The layout follows the type of the draft, never an empty title: a quick post is edited in the composer, everything else in the editor. */}
      {item.quick ? (
        <QuickComposer
          {...QUICK_SLOTS}
          productId={opp.productId}
          channelId={opp.channelId}
          form={item.quick.form}
          onChange={item.quick.setForm}
          platforms={[card.channelPlatform]}
          author={{ name: card.accountLabel, target: card.channelTarget }}
          reads={card.channelReads}
          disabled={locked || working}
          draft={card.draft}
        />
      ) : (
        <DraftEditor
          form={item.form}
          onChange={item.setForm}
          withTitle={standalone}
          disabled={locked || working}
          draft={card.draft}
          ai={locked ? undefined : { opportunityId: opp.id }}
          post={standalone ? { productId: opp.productId, platform: card.channelPlatform, reads: card.channelReads, author: { name: card.accountLabel, target: card.channelTarget } } : undefined}
        />
      )}
      {standalone && !locked && card.channelReads !== false && <ScheduleControl opportunity={opp} busy={working} onSchedule={(at) => void actions.schedule(opp.id, at)} />}

      {notes}
      <ActionSummary card={card} />
      <ErrorNote error={item.error} />
      {item.alsoPost && item.alsoOpen && <AlsoPostPanel card={card} onClose={() => item.setAlsoOpen(false)} />}
    </>
  )
}

/** The buttons of an item, by its state (`ReviewButtons`), with "Also post to…" first in the row where the item allows it. */
export function ReviewActionRow({ item, primaryAction = false, primaryTestId }: { item: ReviewItem; /** This item owns the screen's one filled button. */ primaryAction?: boolean; /** Replaces the test id of the main button (the Inbox names its one filled button). */ primaryTestId?: string }) {
  const { card, actions, dirty, input, working } = item
  return (
    <ReviewButtons
      card={card}
      actions={actions}
      dirty={dirty}
      input={input}
      blocked={item.blocked}
      primaryAction={primaryAction}
      primaryTestId={primaryTestId}
      extra={
        item.alsoPost ? (
          <>
            {dirty && (
              <span className="muted small" data-testid="also-post-reason">
                Save your changes first.
              </span>
            )}
            <Button onClick={() => item.setAlsoOpen(true)} disabled={working || dirty || item.alsoOpen} data-testid="also-post-to">
              Also post to…
            </Button>
          </>
        ) : undefined
      }
    />
  )
}
