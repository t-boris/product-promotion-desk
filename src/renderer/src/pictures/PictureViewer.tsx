import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call, useAction, useQuery } from '../hooks'
import { Button, ErrorNote } from '../ui'
import { VIEWER_SIDE, canStep, fitSize, groupLabel, infoLine, nextFocus, savedLine, stepIndex, type PictureSource, type ViewerPicture } from './picture-viewer'
import './picture-viewer.css'

/**
 * The large copy of a picture, as a data address: `undefined` while it is made, `null` when it cannot be (the file is gone, or the system cannot read it).
 * A stored picture is asked for by its id with the longest side the viewer shows; a drawn one is the address it already is.
 */
function useLargeCopy(source: PictureSource): string | null | undefined {
  const media = useQuery('media.thumb', { id: source.kind === 'media' ? source.id : '', side: VIEWER_SIDE }, [], { skip: source.kind !== 'media' })
  const finding = useQuery('findings.picture', { id: source.kind === 'finding' ? source.id : '', side: VIEWER_SIDE }, [], { skip: source.kind !== 'finding' })
  const profile = useQuery('profiles.picture', { id: source.kind === 'profile' ? source.id : '' }, [], { skip: source.kind !== 'profile' })
  if (source.kind === 'drawn') return source.dataUrl
  const asked = source.kind === 'media' ? media : source.kind === 'finding' ? finding : profile
  if (asked.error) return null
  return asked.data === undefined ? undefined : (asked.data?.dataUrl ?? null)
}

/** The Save dialog for a picture, through the call of the place it is kept in. The path it was saved to, or null when the dialog was closed. */
async function saveOf(picture: ViewerPicture): Promise<{ path: string } | null> {
  const { source } = picture
  switch (source.kind) {
    case 'media':
      return call('media.save', { id: source.id })
    case 'finding':
      return call('findings.savePicture', { id: source.id })
    case 'profile':
      return call('profiles.savePicture', { id: source.id })
    case 'drawn':
      return call('pictures.saveDataUrl', { dataUrl: source.dataUrl, name: picture.name })
  }
}

/**
 * A picture shown large over the window, with Download. Fitted to the window and never cropped; a small picture is enlarged to fill the room, up to four times its size. Esc, a press on the dark area or Close
 * closes it; when the picture belongs to a group the arrow keys (and Previous / Next) walk through it, from the first to the last. The focus stays inside while it is
 * open. Download opens the system's Save dialog and writes the original file; closing that dialog changes nothing.
 */
export function PictureViewer({ pictures, start = 0, onClose }: { pictures: readonly ViewerPicture[]; start?: number; onClose: () => void }) {
  // Over the whole window, outside the page it was opened from: what is pressed here is not pressed on the card or the row behind it.
  return createPortal(<ViewerSheet pictures={pictures} start={start} onClose={onClose} />, document.body)
}

/** The viewer itself: the backdrop, the bars and the picture. Apart from the portal so that it can be drawn to markup in a test. */
export function ViewerSheet({ pictures, start = 0, onClose }: { pictures: readonly ViewerPicture[]; start?: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), Math.max(pictures.length - 1, 0)))
  const picture = pictures[index]
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  // The room the picture has: the stage between the bars. The picture is sized to it (`fitSize`), so a small one is enlarged and a large one is fitted.
  const stage = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null)
  const latest = useRef({ index, length: pictures.length, onClose })
  latest.current = { index, length: pictures.length, onClose }
  const large = useLargeCopy(picture.source)
  const shown = large ?? (large === null ? (picture.preview ?? null) : undefined)
  const [download, downloading] = useAction(async () => {
    setSaved(null)
    const result = await saveOf(picture)
    if (result) setSaved(result.path)
  })
  const [reveal, revealing] = useAction(async () => {
    if (saved) await call('pictures.revealSaved', { path: saved })
  })

  useEffect(() => {
    const element = stage.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setRoom({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const size = measured && room ? fitSize(measured, room) : null

  const step = (delta: number): void => {
    setIndex((at) => stepIndex(at, delta, latest.current.length))
    setMeasured(null)
    setSaved(null)
  }

  useEffect(() => {
    root.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      const { length, index: at } = latest.current
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        latest.current.onClose()
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && length > 1) {
        const delta = event.key === 'ArrowLeft' ? -1 : 1
        if (!canStep(at, delta, length)) return
        event.preventDefault()
        event.stopPropagation()
        setIndex(stepIndex(at, delta, length))
        setMeasured(null)
        setSaved(null)
      } else if (event.key === 'Tab') {
        const places = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
        const next = nextFocus(places.length, places.indexOf(document.activeElement as HTMLElement), event.shiftKey)
        event.preventDefault()
        event.stopPropagation()
        if (next >= 0) places[next].focus()
      }
    }
    // Captured: while a picture is large nothing else on the page hears the keys.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const label = groupLabel(index, pictures.length)
  // A press on the dark area (outside the bars and the picture) closes it; a press on the picture or a button does not.
  const closeOnDark = (event: { target: EventTarget; currentTarget: EventTarget }): void => {
    if (event.target === event.currentTarget) onClose()
  }
  // The page below hears nothing of what happens here (a press must not reach the card or the row the picture sits in).
  const quiet = { onClick: (event: { stopPropagation(): void }) => event.stopPropagation(), onKeyDown: (event: { stopPropagation(): void }) => event.stopPropagation() }

  return (
    <div className="picture-viewer-backdrop" onMouseDown={closeOnDark} {...quiet} data-testid="picture-viewer-backdrop">
      <div className="picture-viewer" role="dialog" aria-modal="true" aria-label="Picture viewer" tabIndex={-1} ref={root} data-testid="picture-viewer">
        <div className="picture-viewer-bar">
          <span className="picture-viewer-name" title={infoLine(picture, measured)} data-testid="picture-viewer-name">
            {infoLine(picture, measured)}
          </span>
          <Button variant="primary" onClick={() => void download()} disabled={downloading.busy} data-testid="picture-download">
            Download
          </Button>
          <Button onClick={onClose} data-testid="picture-close">
            Close
          </Button>
        </div>
        <div className="picture-viewer-stage" onMouseDown={closeOnDark} ref={stage} data-testid="picture-viewer-stage">
          {shown ? (
            <img
              src={shown}
              alt={picture.alt}
              style={size ?? undefined}
              onLoad={(event) => setMeasured({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              data-testid="picture-viewer-image"
            />
          ) : (
            <span className="picture-viewer-note" data-testid="picture-viewer-note">
              {shown === null ? 'This picture could not be shown.' : 'Opening the picture…'}
            </span>
          )}
        </div>
        <div className="picture-viewer-foot">
          {label !== null && (
            <div className="picture-viewer-walk" data-testid="picture-viewer-walk">
              <Button onClick={() => step(-1)} disabled={!canStep(index, -1, pictures.length)} data-testid="picture-previous">
                Previous
              </Button>
              <span className="picture-viewer-count" aria-live="polite" data-testid="picture-viewer-count">
                {label}
              </span>
              <Button onClick={() => step(1)} disabled={!canStep(index, 1, pictures.length)} data-testid="picture-next">
                Next
              </Button>
            </div>
          )}
          {saved !== null && (
            <div className="picture-viewer-saved" data-testid="picture-viewer-saved">
              <span className="picture-viewer-saved-line" title={saved}>
                {savedLine(saved)}
              </span>
              <Button variant="quiet" onClick={() => void reveal()} disabled={revealing.busy} data-testid="picture-reveal">
                Show in Finder
              </Button>
            </div>
          )}
          <ErrorNote error={downloading.error ?? revealing.error} />
        </div>
      </div>
    </div>
  )
}
