import { useEffect, useRef, useState } from 'react'

/**
 * Prose shown in a few lines of the interface font, wrapped at words, that opens in full on request: a text source (BUG-010, QA
 * finding 23) and the product's description in its header (BUG-037). Whether there is more to show is measured, not guessed from a
 * character count: the width of the window decides. The test ids default to the source row's; another place passes its own.
 */
export function ClampedText({ text, lines, testId = 'source-text', toggleTestId = 'source-toggle' }: { text: string; lines: number; testId?: string; toggleTestId?: string }) {
  const box = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = (): void => {
      if (!open) setCut(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open])
  return (
    <>
      <p ref={box} className={`source-text${open ? ' open' : ''}`} style={{ ['--lines' as string]: lines }} data-testid={testId}>
        {text}
      </p>
      {(cut || open) && (
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid={toggleTestId}>
          {open ? 'Show less' : 'Show full text'}
        </button>
      )}
    </>
  )
}
