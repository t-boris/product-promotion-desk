import { useState } from 'react'
import type { Finding } from '../../../../shared/types'
import { Button } from '../../ui'
import { FindingThread } from './FindingThread'

/**
 * What the AI read in a post it called worth a reply (it opened the post and read what is said under it): what the post says, what the thread says,
 * whom to answer, and the comment it would leave. All of it is the AI's own words about a stranger's page, shown as plain text (text nodes, never markup).
 * The comment is a proposal: the owner may change it here and copy it; nothing in this pane posts or sends anything.
 */
export function FindingRead({ finding }: { finding: Finding }) {
  const [draft, setDraft] = useState(finding.suggestedComment)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }

  return (
    <div className="finding-read" data-testid="finding-read">
      <div className="finding-ai" data-testid="finding-about">
        <span className="muted small">What the post says</span>
        <p className="finding-ai-text">{finding.about}</p>
      </div>
      <div className="finding-ai" data-testid="finding-thread">
        <span className="muted small">What is said under it</span>
        <p className="finding-ai-text">{finding.thread}</p>
        <FindingThread findingId={finding.id} />
      </div>
      <div className="finding-ai" data-testid="finding-reply-to">
        <span className="muted small">Whom to answer</span>
        <p className="finding-ai-text">{finding.replyTo}</p>
      </div>
      <div className="finding-ai finding-comment" data-testid="finding-comment">
        <span className="muted small">A comment you could leave (the AI’s proposal: change it as you like)</span>
        <textarea
          className="input"
          rows={6}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setCopied(null)
          }}
          aria-label="The comment to leave"
          data-testid="finding-comment-text"
        />
        <div className="row">
          <Button variant="secondary" onClick={() => void copy()} disabled={draft.trim() === ''} data-testid="finding-comment-copy">
            Copy the comment
          </Button>
          {copied === 'yes' && <span className="muted small">Copied. Open the post, paste it and send it yourself.</span>}
          {copied === 'no' && <span className="muted small">Could not copy: select the text and copy it yourself.</span>}
        </div>
      </div>
    </div>
  )
}
