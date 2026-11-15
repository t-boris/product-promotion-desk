import { platformLabel } from '../../../../shared/post-format'
import { Badge, formatTime } from '../../ui'
import { isHttpUrl } from '../review/labels'
import { FINDING_LABEL_WORDS, FINDING_STAGE_WORDS, FIRST_LOOK, findingBarNote, type FindingRow } from './finding-rows'
import '../inbox/inbox.css'
import './feed.css'

/**
 * The right pane for a finding (DEC-040): what the AI judged of one post of a channel. The post (title, channel, author, when it was
 * written), the AI's one line on how it relates to the goal, shown as the AI's own words and as plain text (the line comes from a page the
 * AI read: it is a text node, never markup), and how far the AI looked at it. A finding has nothing to approve or send, so the bar holds one
 * quiet action, "Open post", which opens it in the owner's browser the way every other "open in browser" link does. A post worth a reply is
 * an item of To decide, not here. Keyed by the finding by its parent.
 */
export function FindingDetail({ row }: { row: FindingRow }) {
  const { finding, channelTarget, channelPlatform } = row.card
  const label = row.label ? FINDING_LABEL_WORDS[row.label] : FINDING_STAGE_WORDS[finding.stage]
  return (
    <div className="inbox-detail feed-detail finding-detail" data-testid="finding-detail" data-label={row.label ?? ''} data-stage={finding.stage}>
      <div className="inbox-detail-scroll">
        <div className="review-head inbox-detail-head">
          <div className="review-id">
            <Badge>{label}</Badge>
            {finding.firstLook && <Badge>{FIRST_LOOK}</Badge>}
            <strong data-testid="finding-channel">{channelTarget}</strong>
            <span className="review-account">{platformLabel(channelPlatform)}</span>
          </div>
          <div className="review-when">
            <span data-testid="finding-posted">{finding.postedAt ? `Posted ${formatTime(finding.postedAt)}` : 'Posting time unknown'}</span>
          </div>
        </div>
        <div className="review-body">
          <div className="finding-post">
            <strong className="finding-title" data-testid="finding-title">
              {finding.title.trim() || 'Untitled post'}
            </strong>
            {finding.author && <span className="muted">by {finding.author}</span>}
          </div>
          <div className="finding-ai" data-testid="finding-relation">
            <span className="muted small">The AI’s note on how it relates to your goal</span>
            <p className="finding-ai-text">{finding.relation.trim() || 'The AI gave no reason.'}</p>
          </div>
          <dl className="kv finding-facts">
            <dt>Judged</dt>
            <dd data-testid="finding-stage">{FINDING_STAGE_WORDS[finding.stage]}</dd>
            <dt>Found</dt>
            <dd>{finding.firstLook ? `${formatTime(finding.createdAt)}, by the first look at this channel` : formatTime(finding.createdAt)}</dd>
          </dl>
        </div>
      </div>
      <div className="inbox-bar" data-testid="finding-bar">
        <div className="inbox-bar-settled">
          <span className="review-foot-note">{findingBarNote(row.label)}</span>
          {isHttpUrl(finding.url) ? (
            <a className="btn" href={finding.url} target="_blank" rel="noreferrer" data-testid="finding-open-post">
              Open post
            </a>
          ) : (
            <span className="muted small" data-testid="finding-no-address">
              No address for this post.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
