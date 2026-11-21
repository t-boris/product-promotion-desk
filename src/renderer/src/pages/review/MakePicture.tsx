import { useState } from 'react'
import type { MediaItem, MediaShape } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { AiTextField } from '../../assist/AiField'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction, useQuery } from '../../hooks'
import { ViewableImage } from '../../pictures/ViewableImage'
import { mediaPicture } from '../../pictures/picture-viewer'
import { Button, ErrorNote, Hint, SegmentedControl } from '../../ui'
import { useThumb } from './useMedia'

const SHAPES: { value: MediaShape; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'wide', label: 'Wide' },
  { value: 'tall', label: 'Tall' }
]

function Candidate({ item, onUse }: { item: MediaItem; onUse: (item: MediaItem) => void }) {
  const url = useThumb(item.id, 240)
  return (
    <div className="post-picture candidate" data-testid="picture-candidate">
      <div className="post-thumb large">{url ? <ViewableImage src={url} alt={item.description || item.name} picture={mediaPicture(item)} /> : <span className="muted small">{url === null ? 'Picture removed' : '…'}</span>}</div>
      <div className="post-picture-actions">
        <Button onClick={() => onUse(item)} data-testid="picture-use">
          Use this one
        </Button>
      </div>
    </div>
  )
}

/**
 * The AI makes a picture from a description (DEC-030). The description is the owner's: the AI proposes a start from the post, the owner
 * edits it, and only then is an image asked for. Every press makes a new picture; none replaces another, so the owner can compare.
 */
export function MakePicture({
  productId,
  title,
  text,
  onUse,
  onClose,
  description: held,
  onDescription
}: {
  productId: string
  title: string
  text: string
  onUse: (item: MediaItem) => void
  onClose: () => void
  /** The description, when the screen that holds this panel keeps it (the quick-post composer, whose AI help proposes one): then it is the screen's, and `onDescription` is how it changes. */
  description?: string
  onDescription?: (description: string) => void
}) {
  const status = useQuery('media.status', { checkEngine: true }, [])
  const [own, setOwn] = useState('')
  const description = held ?? own
  const setDescription = (next: string): void => (onDescription ? onDescription(next) : setOwn(next))
  const [shape, setShape] = useState<MediaShape>('square')
  const [candidates, setCandidates] = useState<MediaItem[]>([])
  const { blocked } = useAssistBlock({ engineReady: false })
  const canMake = status.data?.canMake === true
  const [make, making] = useAction(async () => {
    const item = await call('media.make', { productId, description: description.trim(), shape })
    setCandidates((all) => [item, ...all])
  })
  const around = JSON.stringify([title, text.slice(0, 600)])
  return (
    <div className="make-picture" data-testid="make-picture">
      <div className="post-pictures-head">
        <span className="post-pictures-title">Make a picture</span>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
      {status.data && !canMake && <Hint tone="warn" data-testid="make-reason">{status.data.makeReason ?? 'No engine with an image tool is ready.'}</Hint>}
      <AiTextField
        label="What the picture shows"
        hint="Describe it as you would to an illustrator: the subject, the place, the style, the mood. The AI can propose a start from your post; you change it before a picture is made."
        value={description}
        onChange={setDescription}
        ask={async ({ current, instruction }) =>
          (
            await call('assist.refine', {
              field: 'picture.description',
              productId,
              current,
              instruction,
              around: [
                { label: 'Post title', text: title },
                { label: 'Post text', text }
              ]
            })
          ).text
        }
        blocked={blocked}
        disabled={making.busy}
        around={around}
        testId="picture-description"
      >
        {(id) => <textarea id={id} className="input" rows={3} value={description} disabled={making.busy} onChange={(e) => setDescription(e.target.value)} data-testid="picture-description-input" />}
      </AiTextField>
      <div className="post-pictures-head">
        <SegmentedControl label="Shape" name="picture-shape" options={SHAPES} value={shape} onChange={setShape} disabled={making.busy} testIdPrefix="shape-" />
        <Button onClick={() => void make()} disabled={making.busy || !canMake || description.trim() === ''} data-testid="picture-make">
          {making.busy ? 'Making…' : candidates.length > 0 ? 'Make another' : 'Make a picture'}
        </Button>
      </div>
      <AiProgressPanel subject={productId} />
      <ErrorNote error={making.error} />
      {candidates.length > 0 && (
        <div className="post-thumbs" data-testid="picture-candidates">
          {candidates.map((item) => (
            <Candidate key={item.id} item={item} onUse={onUse} />
          ))}
        </div>
      )}
    </div>
  )
}
