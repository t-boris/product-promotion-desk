import { useState, type DragEvent, type HTMLAttributes } from 'react'
import type { FilePurpose } from '../../shared/types'
import { acceptDrop, fileParts, loaderWords, pathsOfDrop, takesMany } from './file-loader'
import { call, useAction, useQuery } from './hooks'
import { Button, ErrorNote } from './ui'
import './file-loader.css'

interface FileLoaderProps {
  purpose: FilePurpose
  /** What the field is called, above the area. */
  label: string
  hint?: string
  /**
   * The path that is chosen, when the screen keeps it (a source): the area then shows its name and folder, and "Change…". Left out when the choice is used at once
   * (a picture): the area stays ready for the next one.
   */
  value?: string
  /** What was chosen or dropped (one path, unless the purpose takes many). */
  onChoose: (paths: string[]) => void
  disabled?: boolean
  testId: string
  /** Only the button, in a place too narrow for an area (the profile's picture): its words are `buttonLabel`; the place itself takes drops (`useFileDrop`). */
  compact?: boolean
  buttonLabel?: string
}

/** What a place that takes a dropped file needs: its handlers, whether a file is over it, and what was left out of the drop in words. */
export function useFileDrop(
  purpose: FilePurpose,
  onChoose: (paths: string[]) => void,
  disabled: boolean
): { over: boolean; notice: string | null; clear: () => void; handlers: Pick<HTMLAttributes<HTMLElement>, 'onDrop' | 'onDragOver' | 'onDragEnter' | 'onDragLeave'> } {
  const [over, setOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    setOver(false)
    // A file that is dropped and not taken would be opened by the window itself: it is always taken, and refused in words.
    if (event.dataTransfer.files.length === 0) return
    event.preventDefault()
    if (disabled) return
    const dropped = pathsOfDrop(Array.from(event.dataTransfer.files), window.ppd?.pathOf)
    const { accepted, notice: told } = acceptDrop(purpose, dropped.paths, dropped.skipped)
    setNotice(told)
    if (accepted.length > 0) onChoose(accepted)
  }
  const onOver = (event: DragEvent<HTMLElement>): void => {
    if (disabled || !Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    setOver(true)
  }
  const onDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
  }
  return { over, notice, clear: () => setNotice(null), handlers: { onDrop, onDragOver: onOver, onDragEnter: onOver, onDragLeave } }
}



/**
 * The one way to give the application a file or a folder (instead of typing its path): a button that opens the system's dialog, and an area a file can be dropped
 * on. Where this build has no dialog (the loopback web mode) the path is typed as before, and the line under it says why.
 */
export function FileLoader({ purpose, label, hint, value, onChoose, disabled = false, testId, compact = false, buttonLabel }: FileLoaderProps) {
  const words = loaderWords(purpose)
  const status = useQuery('media.status', {}, [])
  const hasDialog = status.data?.canPick !== false
  const [typed, setTyped] = useState('')
  const keeps = value !== undefined
  const chosen = keeps && value.trim() !== ''
  const hand = (paths: string[]): void => {
    drop.clear()
    if (paths.length > 0) onChoose(takesMany(purpose) ? paths : paths.slice(0, 1))
  }
  const drop = useFileDrop(purpose, hand, disabled)
  const [choose, choosing] = useAction(async () => {
    hand(await call('files.choose', { purpose }))
  })

  if (!hasDialog) {
    // No dialog here: the path is typed. A screen that keeps the path shows it live; one that uses the choice at once has a button for it.
    return (
      <div className="field" data-testid={testId}>
        {!compact && <span className="field-label">{label}</span>}
        <div className="file-loader-typed">
          <input
            className="input"
            value={keeps ? (value ?? '') : typed}
            disabled={disabled}
            onChange={(e) => (keeps ? onChoose([e.target.value]) : setTyped(e.target.value))}
            aria-label={words.typed}
            placeholder="/Users/you/…"
            data-testid={`${testId}-path`}
          />
          {!keeps && (
            <Button
              onClick={() => {
                onChoose([typed.trim()])
                setTyped('')
              }}
              disabled={disabled || typed.trim() === ''}
              data-testid={`${testId}-use`}
            >
              Use
            </Button>
          )}
        </div>
        <span className="hint">This version cannot open a file dialog here, so the path is typed.</span>
      </div>
    )
  }

  if (compact) {
    return (
      <>
        <Button variant="secondary" onClick={() => void choose()} disabled={disabled || choosing.busy} data-testid={`${testId}-choose`}>
          {choosing.busy ? 'Opening…' : (buttonLabel ?? words.choose)}
        </Button>
        {drop.notice && (
          <span className="hint" role="status" data-testid={`${testId}-notice`}>
            {drop.notice}
          </span>
        )}
        <ErrorNote error={choosing.error} />
      </>
    )
  }

  const parts = chosen ? fileParts(value) : null
  return (
    <div className="field" data-testid={testId}>
      <span className="field-label">{label}</span>
      <div className={`file-loader${drop.over ? ' over' : ''}${chosen ? ' filled' : ''}${disabled ? ' disabled' : ''}`} role="group" aria-label={label} {...drop.handlers} data-testid={`${testId}-area`}>
        {parts ? (
          <div className="file-loader-chosen" title={value}>
            <span className="file-loader-name" data-testid={`${testId}-name`}>
              {parts.name}
            </span>
            {parts.folder && <span className="file-loader-folder">{parts.folder}</span>}
          </div>
        ) : (
          <span className="file-loader-drop">{words.drop}</span>
        )}
        <Button variant="secondary" onClick={() => void choose()} disabled={disabled || choosing.busy} data-testid={`${testId}-choose`}>
          {choosing.busy ? 'Opening…' : chosen ? words.change : (buttonLabel ?? words.choose)}
        </Button>
      </div>
      {hint && <span className="hint">{hint}</span>}
      {drop.notice && (
        <span className="hint" role="status" data-testid={`${testId}-notice`}>
          {drop.notice}
        </span>
      )}
      <ErrorNote error={choosing.error} />
    </div>
  )
}
