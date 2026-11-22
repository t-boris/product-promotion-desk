// The post editor (DEC-030): a toolbar over the text, the pictures of the post, and the way to make a picture. Three parts that share the
// text box: `usePostEditor` holds what they share, `PostTextBox` is the toolbar and the text, `PostPictures` is the strip under it.

import { useLayoutEffect, useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from 'react'
import type { Attachment, MediaItem } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { ViewableImage } from '../../pictures/ViewableImage'
import { mediaPicture, type ViewerPicture } from '../../pictures/picture-viewer'
import { Badge, Button, ErrorNote, Hint } from '../../ui'
import type { DraftForm } from './DraftEditor'
import { applyMark, imageFilesOf, insertPicture, placedPictures, withoutPicture, type Mark, type Selection } from './editor-marks'
import { MakePicture } from './MakePicture'
import { addImageFiles, useThumb } from './useMedia'

/** What tells one picture of a post from another: its library id, or its file for a post written before the library. */
export const keyOf = (a: Attachment): string => a.mediaId ?? a.path

export const toAttachment = (item: MediaItem): Attachment => ({ name: item.name, path: item.path, mime: item.mime, sha256: item.sha256, mediaId: item.id })

/** The alternative text of a picture in the text: what the owner said it shows, else its name without the extension. */
const altOf = (item: MediaItem): string => (item.description || item.name.replace(/\.[A-Za-z0-9]+$/, '')).slice(0, 80)

export interface PostEditorState {
  textRef: RefObject<HTMLTextAreaElement | null>
  mark: (mark: Mark) => void
  /** Puts a picture of the library into the post; `insert` also places it in the text, at the cursor. */
  attach: (item: MediaItem, insert: boolean) => void
  /** The same for several pictures at once, in order. */
  attachMany: (items: MediaItem[], insert: boolean, at?: { start: number; end: number }) => void
  /** Something the owner did that could not be done, in words, under the pictures. */
  tell: (message: string) => void
  /** Puts the selection on these characters once the next change of the text is on the screen (the part the AI changed). */
  select: (range: { start: number; end: number }) => void
  detach: (attachment: Attachment) => void
  insertAgain: (attachment: Attachment) => void
  /** `skipped`: files that came with them and are not pictures; the owner is told they were left out. */
  addFiles: (files: File[], origin: 'pasted' | 'dropped', skipped?: number) => Promise<void>
  adding: boolean
  notice: string | null
}

export function usePostEditor(form: DraftForm, onChange: Dispatch<SetStateAction<DraftForm>>, productId: string): PostEditorState {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const after = useRef<{ start: number; end: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // A mark moves the selection to where it belongs once the text is on the screen.
  useLayoutEffect(() => {
    const box = textRef.current
    if (box && after.current) {
      box.setSelectionRange(after.current.start, after.current.end)
      box.focus()
      after.current = null
    }
  })

  const caret = (): Selection => {
    const box = textRef.current
    const text = box?.value ?? form.text
    return { text, start: box?.selectionStart ?? text.length, end: box?.selectionEnd ?? text.length }
  }
  const change = (patch: (current: DraftForm) => Partial<DraftForm>): void => onChange((current) => ({ ...current, ...patch(current), markup: 'markdown' }))

  /**
   * Puts pictures of the library into the post, and, with `insert`, into the text at the cursor, one after another: each goes after the one
   * before it, in the order given. All of it is one change of the form, so the cursor read from the text box is read once, not once per picture.
   */
  const attachMany = (items: MediaItem[], insert: boolean, at?: { start: number; end: number }): void => {
    if (items.length === 0) return
    const where = at ?? caret()
    change((current) => {
      let attachments = current.attachments
      let text = current.text
      let cursor = { start: Math.min(where.start, text.length), end: Math.min(where.end, text.length) }
      for (const item of items) {
        if (!attachments.some((a) => a.mediaId === item.id)) attachments = [...attachments, toAttachment(item)]
        if (!insert) continue
        const placed = insertPicture({ text, start: cursor.start, end: cursor.end }, item.id, altOf(item))
        text = placed.text
        cursor = { start: placed.end, end: placed.end }
      }
      if (insert) after.current = cursor
      return { attachments, text }
    })
  }
  const attach = (item: MediaItem, insert: boolean): void => attachMany([item], insert)

  return {
    textRef,
    notice,
    adding,
    mark: (mark) => {
      const next = applyMark(caret(), mark)
      after.current = { start: next.start, end: next.end }
      change(() => ({ text: next.text }))
    },
    attach,
    attachMany,
    tell: (message) => setNotice(message),
    select: (range) => {
      after.current = range
    },
    // A picture is told apart by its library id, or by its file for a post that was written before the library (two of those have no id).
    detach: (attachment) => change((current) => ({ attachments: current.attachments.filter((a) => keyOf(a) !== keyOf(attachment)), text: attachment.mediaId ? withoutPicture(current.text, attachment.mediaId) : current.text })),
    insertAgain: (attachment) => {
      if (!attachment.mediaId) return
      const where = caret()
      change((current) => {
        const placed = insertPicture({ text: current.text, start: Math.min(where.start, current.text.length), end: Math.min(where.end, current.text.length) }, attachment.mediaId as string, attachment.name.replace(/\.[A-Za-z0-9]+$/, ''))
        after.current = { start: placed.start, end: placed.end }
        return { text: placed.text }
      })
    },
    addFiles: async (files, origin, skipped = 0) => {
      if (files.length === 0) return
      // Where the cursor was when the pictures came, not where it is when they have been read and stored.
      const where = caret()
      setAdding(true)
      setNotice(null)
      try {
        const { items, refused } = await addImageFiles(productId, files, origin)
        if (skipped > 0) refused.push(`${skipped} file${skipped === 1 ? ' that is' : 's that are'} not a picture ${skipped === 1 ? 'was' : 'were'} left out.`)
        // Each goes after the one before it, in the order they came.
        attachMany(items, true, where)
        if (refused.length > 0) setNotice(refused.join(' '))
      } finally {
        setAdding(false)
      }
    }
  }
}

const TOOLS: { mark: Mark; label: string; title: string }[] = [
  { mark: 'bold', label: 'B', title: 'Bold (⌘B)' },
  { mark: 'italic', label: 'I', title: 'Italic (⌘I)' },
  { mark: 'strike', label: 'S', title: 'Strikethrough' },
  { mark: 'sup', label: 'x²', title: 'Superscript' },
  { mark: 'heading', label: 'H', title: 'Heading' },
  { mark: 'bullets', label: '•', title: 'Bulleted list' },
  { mark: 'numbers', label: '1.', title: 'Numbered list' },
  { mark: 'quote', label: '❝', title: 'Quote' },
  { mark: 'spoiler', label: 'Spoiler', title: 'Spoiler: hidden until the reader presses it (Reddit)' },
  { mark: 'code', label: '</>', title: 'Code' },
  { mark: 'codeblock', label: '{ }', title: 'Code block' },
  { mark: 'table', label: 'Table', title: 'Table' },
  { mark: 'link', label: 'Link', title: 'Link (⌘K)' }
]

const KEYS: Record<string, Mark> = { b: 'bold', i: 'italic', k: 'link' }

/** The toolbar and the text. A picture on the clipboard, or dropped on the text, goes into the post at the cursor. */
export function PostTextBox({
  id,
  value,
  onChange,
  disabled,
  autoFocus,
  editor,
  onSelection,
  slot
}: {
  id: string
  value: string
  onChange: (text: string) => void
  disabled: boolean
  autoFocus: boolean
  editor: PostEditorState
  /** Told where the selection is (the same start and end when nothing is selected), so a part of the text can be changed by the AI. */
  onSelection?: (start: number, end: number) => void
  /** Something that belongs between the toolbar and the text (the bar that changes a selected part). */
  slot?: ReactNode
}) {
  const [over, setOver] = useState(false)
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const images = imageFilesOf(event.clipboardData.files)
    if (images.length === 0) return
    // A copy from a spreadsheet or a notes app carries the words and a picture of them: the words are what was meant, so they are pasted.
    if (Array.from(event.clipboardData.types).includes('text/plain')) return
    event.preventDefault()
    void editor.addFiles(images, 'pasted')
  }
  const onDrop = (event: DragEvent<HTMLTextAreaElement>): void => {
    const images = imageFilesOf(event.dataTransfer.files)
    setOver(false)
    // A file that is dropped and not taken would open in this window and lose the post that is being written: it is always taken, and refused in words.
    if (event.dataTransfer.files.length > 0) event.preventDefault()
    if (images.length === 0) {
      if (event.dataTransfer.files.length > 0) editor.tell('Only PNG, JPEG, GIF and WebP pictures can be added to a post.')
      return
    }
    void editor.addFiles(images, 'dropped', event.dataTransfer.files.length - images.length)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const mark = event.metaKey || event.ctrlKey ? KEYS[event.key.toLowerCase()] : undefined
    if (!mark || event.altKey) return
    event.preventDefault()
    editor.mark(mark)
  }
  return (
    <div className="post-box">
      <div className="post-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLS.map((tool) => (
          <Button key={tool.mark} variant="ghost" className={`post-tool post-tool-${tool.mark}`} title={tool.title} aria-label={tool.title} disabled={disabled} onClick={() => editor.mark(tool.mark)} data-testid={`mark-${tool.mark}`}>
            {tool.label}
          </Button>
        ))}
      </div>
      {slot}
      <textarea
        ref={editor.textRef}
        id={id}
        className={`input draft-text post-text${over ? ' over' : ''}`}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={12}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (imageFilesOf(e.dataTransfer.items ? Array.from(e.dataTransfer.items).map((i) => i.getAsFile()).filter((f): f is File => f !== null) : e.dataTransfer.files).length > 0 || Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onKeyDown={onKeyDown}
        onSelect={(e) => onSelection?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
        data-testid="draft-text"
      />
    </div>
  )
}

/** What opens a thumbnail large: the picture, the pictures of the same post, and its place among them. */
interface Viewing {
  picture: ViewerPicture
  group: readonly ViewerPicture[]
  index: number
}

function Thumb({ id, name, viewing }: { id: string | undefined; name: string; viewing?: Viewing }) {
  const url = useThumb(id, 128)
  // A picture of a post written before the library has no copy yet; saving the post makes one.
  if (id === undefined) return <div className="post-thumb"><span className="muted small">Copied when you save</span></div>
  // A thumbnail inside a button (a tile of the library that attaches the picture) is not a second button: it stays a plain picture, and the one that is attached opens large.
  const picture = url ? viewing ? <ViewableImage src={url} alt={name} picture={viewing.picture} group={viewing.group} index={viewing.index} /> : <img src={url} alt={name} /> : null
  return <div className="post-thumb">{picture ?? <span className="muted small">{url === null ? 'Picture removed' : '…'}</span>}</div>
}

/** What opens an attachment large: its picture among the pictures of the post; nothing for one that has no copy in the library yet. */
function viewingOf(a: Attachment, viewable: readonly ViewerPicture[]): Viewing | undefined {
  const index = viewable.findIndex((picture) => picture.key === a.mediaId)
  return index < 0 ? undefined : { picture: viewable[index], group: viewable, index }
}

/** The pictures of the post, and how to add one: choose files, paste or drop, a picture of the library, or have the AI make one. */
export function PostPictures({ form, productId, disabled, editor }: { form: DraftForm; productId: string; disabled: boolean; editor: PostEditorState }) {
  const status = useQuery('media.status', {}, [])
  const library = useQuery('media.list', { productId }, ['media'])
  const [showLibrary, setShowLibrary] = useState(false)
  const [making, setMaking] = useState(false)
  const placed = new Set(placedPictures(form.text))
  const [pick, picking] = useAction(async () => {
    editor.attachMany(await call('media.pick', { productId }), true)
  })
  const unused = (library.data ?? []).filter((item) => !form.attachments.some((a) => a.mediaId === item.id))
  // The pictures of the post that have a copy in the library open large together, in the order of the post; the size comes from the library when it is known.
  const viewable = form.attachments.flatMap((a) => (a.mediaId ? [mediaPicture({ id: a.mediaId, name: a.name, ...(library.data ?? []).find((item) => item.id === a.mediaId) })] : []))
  const canPick = status.data?.canPick === true
  const error = picking.error ?? editor.notice

  return (
    <div className="post-pictures" data-testid="post-pictures">
      <div className="post-pictures-head">
        <span className="post-pictures-title">Pictures</span>
        {!disabled && (
          <div className="post-pictures-actions">
            {canPick && (
              <Button onClick={() => void pick()} disabled={picking.busy || editor.adding} data-testid="pictures-choose">
                Choose files…
              </Button>
            )}
            <Button onClick={() => setMaking(!making)} aria-expanded={making} data-testid="pictures-make">
              Make a picture…
            </Button>
            {unused.length > 0 && (
              <Button onClick={() => setShowLibrary(!showLibrary)} aria-expanded={showLibrary} data-testid="pictures-library">
                From the library ({unused.length})
              </Button>
            )}
          </div>
        )}
      </div>
      {!disabled && <div className="muted small">{canPick ? 'Paste a picture (⌘V) or drop it on the text, or choose files.' : 'Paste a picture (⌘V) or drop it on the text.'} It is placed in the text where the cursor is.</div>}
      {form.attachments.length > 0 && (
        <div className="post-thumbs" data-testid="draft-attachments">
          {form.attachments.map((a) => (
            <div key={keyOf(a)} className="post-picture">
              <Thumb id={a.mediaId} name={a.name} viewing={viewingOf(a, viewable)} />
              <div className="post-picture-name" title={a.name}>
                {a.name}
              </div>
              <div className="post-picture-actions">
                {a.mediaId && placed.has(a.mediaId) ? <Badge>In the text</Badge> : !disabled && a.mediaId ? <Button variant="quiet" className="accent" onClick={() => editor.insertAgain(a)}>Place in text</Button> : null}
                {!disabled && (
                  <Button variant="quiet" className="danger" onClick={() => editor.detach(a)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showLibrary && !disabled && unused.length > 0 && (
        <div className="post-thumbs post-library" data-testid="pictures-library-list">
          {unused.map((item) => (
            <button key={item.id} type="button" className="post-picture library" onClick={() => editor.attach(item, true)} title={item.description || item.name}>
              <Thumb id={item.id} name={item.name} />
              <div className="post-picture-name">{item.name}</div>
            </button>
          ))}
        </div>
      )}
      {making && !disabled && (
        <MakePicture
          productId={productId}
          title={form.title}
          text={form.text}
          onUse={(item) => {
            editor.attach(item, true)
          }}
          onClose={() => setMaking(false)}
        />
      )}
      {editor.adding && <Hint>Adding the picture…</Hint>}
      <ErrorNote error={error} />
    </div>
  )
}
