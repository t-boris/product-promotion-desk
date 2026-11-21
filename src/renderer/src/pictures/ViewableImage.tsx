import { useRef, useState, type ImgHTMLAttributes, type KeyboardEvent } from 'react'
import { PictureViewer } from './PictureViewer'
import type { ViewerPicture } from './picture-viewer'

/**
 * A picture of the application that opens large when it is pressed: the same `<img>` as before (its class, its size, its place), plus the viewer. It is reachable from the
 * keyboard (Tab to it, Enter or Space), and the focus comes back to it when the viewer closes. `group` is every picture of the same place (the pictures of one post), so
 * the viewer can walk through them; `index` is this one's place in it. With `keyboard={false}` it is a press of the mouse only: for a picture that sits inside a button (a
 * row of a list), where a second button would be wrong; the same picture is one press away in the pane the row opens.
 */
export function ViewableImage({
  picture,
  group,
  index = 0,
  keyboard = true,
  className = '',
  alt,
  ...img
}: ImgHTMLAttributes<HTMLImageElement> & { picture: ViewerPicture; group?: readonly ViewerPicture[]; index?: number; keyboard?: boolean }) {
  const [open, setOpen] = useState(false)
  const element = useRef<HTMLImageElement>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLImageElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(true)
  }
  return (
    <>
      <img
        {...img}
        ref={element}
        alt={alt}
        className={`${className} viewable`.trim()}
        role={keyboard ? 'button' : undefined}
        tabIndex={keyboard ? 0 : undefined}
        aria-label={keyboard ? `View larger: ${picture.alt}` : undefined}
        title={keyboard ? 'View larger' : undefined}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        onKeyDown={keyboard ? onKeyDown : undefined}
      />
      {open && (
        <PictureViewer
          pictures={group ?? [picture]}
          start={index}
          onClose={() => {
            setOpen(false)
            // The focus goes back to the picture that was pressed, once the viewer is gone.
            if (keyboard) requestAnimationFrame(() => element.current?.focus())
          }}
        />
      )}
    </>
  )
}
