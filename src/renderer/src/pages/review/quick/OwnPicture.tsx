import { useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import type { Attachment, MediaItem } from '../../../../../shared/types'
import { pictureRulesText } from '../../../../../shared/post-pictures'
import { call, useAction, useQuery } from '../../../hooks'
import { Badge, Button, ErrorNote, Hint } from '../../../ui'
import { imageFilesOf } from '../editor-marks'
import { MakePicture } from '../MakePicture'
import { toAttachment } from '../PostEditorParts'
import { addImageFiles, useThumb } from '../useMedia'
import { factsOfMedia, pictureCheck, shapeHint } from './picture-check'

/** The picture the owner chose, as a frame the size of a thumbnail. */
function Chosen({ picture }: { picture: Attachment }) {
  const url = useThumb(picture.mediaId, 360)
  return (
    <div className="quick-chosen" data-testid="quick-chosen-picture">
      <div className="quick-chosen-frame">{url ? <img src={url} alt={picture.name} /> : <span className="muted small">{url === null ? 'Picture removed' : '…'}</span>}</div>
      <span className="quick-chosen-name small" title={picture.name}>
        {picture.name}
      </span>
    </div>
  )
}

/**
 * The picture of a quick post when it is not the card: one picture, from the AI ("Make a picture"), from a file, pasted or dropped, or from the
 * library of the product. Choosing one replaces the one before; the card stays as it was in case the owner goes back. What the ticked platforms
 * refuse about the picture is said under it, from the one table the approval reads (`pictureCheck`).
 */
export function OwnPicture({
  productId,
  picture,
  caption,
  platforms,
  disabled,
  onChoose,
  wish,
  onWish,
  extras
}: {
  productId: string
  picture: Attachment | null
  caption: string
  platforms: readonly string[]
  disabled: boolean
  onChoose: (picture: Attachment) => void
  /** The description an illustration is made from, kept by the form (the AI's help proposes one into it). */
  wish: string
  onWish: (wish: string) => void
  extras?: ReactNode
}) {
  const status = useQuery('media.status', {}, [])
  const library = useQuery('media.list', { productId }, ['media'])
  const [making, setMaking] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const canPick = status.data?.canPick === true
  const use = (item: MediaItem): void => {
    onChoose(toAttachment(item))
    setNotice(null)
  }
  const [pick, picking] = useAction(async () => {
    const items = await call('media.pick', { productId })
    if (items.length === 0) return
    use(items[0])
    if (items.length > 1) setNotice('A quick post has one picture: the first of the files you chose is used.')
  })
  const [add, adding] = useAction(async (files: File[], origin: 'pasted' | 'dropped', skipped?: number) => {
    const { items, refused } = await addImageFiles(productId, files, origin)
    if (items.length > 0) use(items[0])
    const told = [...refused]
    if (items.length > 1) told.push('A quick post has one picture: the first was used.')
    if (skipped !== undefined && skipped > 0) told.push(`${skipped} file${skipped === 1 ? ' that is' : 's that are'} not a picture ${skipped === 1 ? 'was' : 'were'} left out.`)
    if (told.length > 0) setNotice(told.join(' '))
  })
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const images = imageFilesOf(event.clipboardData.files)
    if (images.length === 0 || disabled) return
    event.preventDefault()
    void add(images, 'pasted')
  }
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setOver(false)
    // A file that is dropped and not taken would open in this window and lose the post being written: it is always taken, and refused in words.
    if (event.dataTransfer.files.length > 0) event.preventDefault()
    if (disabled) return
    const images = imageFilesOf(event.dataTransfer.files)
    if (images.length === 0) {
      if (event.dataTransfer.files.length > 0) setNotice('Only PNG, JPEG, GIF and WebP pictures can be added to a post.')
      return
    }
    void add(images, 'dropped', event.dataTransfer.files.length - images.length)
  }
  const row = picture?.mediaId ? library.data?.find((item) => item.id === picture.mediaId) : undefined
  const problems = row ? pictureCheck(platforms, factsOfMedia(row)) : []
  const hint = shapeHint(platforms)
  const rules = [...new Set(platforms)].map(pictureRulesText).filter((line): line is string => line !== null)
  const unused = (library.data ?? []).filter((item) => item.id !== picture?.mediaId)

  return (
    <div className="quick-own" data-testid="quick-own-picture">
      <div
        className={`quick-dropzone${over ? ' over' : ''}${picture ? ' filled' : ''}`}
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-label="Picture of the post"
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (!disabled && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        data-testid="quick-dropzone"
      >
        {picture ? (
          <Chosen picture={picture} />
        ) : (
          <span className="muted" data-testid="quick-no-picture">
            No picture chosen yet.
          </span>
        )}
        {!disabled && <span className="muted small">{canPick ? 'Paste a picture (⌘V) or drop it here, or choose a file.' : 'Paste a picture (⌘V) or drop it here.'}</span>}
      </div>
      {!disabled && (
        <div className="quick-own-actions">
          <Button onClick={() => setMaking(!making)} aria-expanded={making} data-testid="quick-make">
            Make a picture…
          </Button>
          {canPick && (
            <Button onClick={() => void pick()} disabled={picking.busy || adding.busy} data-testid="quick-choose">
              Choose a file…
            </Button>
          )}
          {unused.length > 0 && (
            <Button onClick={() => setShowLibrary(!showLibrary)} aria-expanded={showLibrary} data-testid="quick-library">
              From the library ({unused.length})
            </Button>
          )}
        </div>
      )}
      {adding.busy && <Hint>Adding the picture…</Hint>}
      {showLibrary && !disabled && unused.length > 0 && (
        <div className="post-thumbs post-library" data-testid="quick-library-list">
          {unused.map((item) => (
            <LibraryPicture key={item.id} item={item} onUse={() => use(item)} />
          ))}
        </div>
      )}
      {making && !disabled && (
        <MakePicture
          productId={productId}
          title=""
          text={caption}
          description={wish}
          onDescription={onWish}
          onUse={(item) => {
            use(item)
            setMaking(false)
          }}
          onClose={() => setMaking(false)}
        />
      )}
      {hint && <Hint data-testid="quick-shape-hint">{hint}</Hint>}
      {rules.length > 0 && (
        <ul className="quick-rules muted small" data-testid="quick-picture-rules">
          {rules.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <ul className="quick-problems small" data-testid="quick-picture-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {picture && row === undefined && library.data !== undefined && <Badge tone="warn">This picture is not in the library any more.</Badge>}
      <ErrorNote error={picking.error ?? adding.error ?? notice} />
      {extras}
    </div>
  )
}

function LibraryPicture({ item, onUse }: { item: MediaItem; onUse: () => void }) {
  const url = useThumb(item.id, 128)
  return (
    <button type="button" className="post-picture library" onClick={onUse} title={item.description || item.name}>
      <div className="post-thumb">{url ? <img src={url} alt={item.name} /> : <span className="muted small">{url === null ? 'Picture removed' : '…'}</span>}</div>
      <div className="post-picture-name">{item.name}</div>
    </button>
  )
}
