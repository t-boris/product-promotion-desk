import { useState, type ReactNode } from 'react'
import type { ProductUpdate } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, Loading, useOpenForm } from '../../ui'
import { NOTES_ABOUT, NOTES_SHARED, NOTE_MAX, SET_ASIDE_WORDS, isSetAside, noteProblem, normalizeNote, shortDate, showNoteCount, splitNotes, unusedLabel } from './mix-card'

/**
 * The owner's notes about what is new in the product: the only thing an "own update" draft is written from. They belong to the product, not
 * to the channel, so every channel of the product reads the same list. "Add a note" opens a one-line form whose "Add" is the screen's filled
 * button while it is open (`useOpenForm`); a note that was not used can be removed; the last few used ones stay as the record.
 */
export function MixNotes({ productId }: { productId: string }) {
  // The core says "changed: channels" for a note added or removed, and for a draft written from one (the note becomes used).
  const notes = useQuery('updates.list', { productId }, ['channels', 'opportunities'])
  const [adding, setAdding] = useState(false)
  const [remove, removing] = useAction((id: string) => call('updates.remove', { id }).then(() => notes.reload()))
  const { open, usable, setAside, used } = splitNotes(notes.data ?? [])

  return (
    <div className="mix-notes" data-testid="mix-notes">
      <div className="mix-notes-head">
        <div className="mix-notes-title">
          <strong data-testid="mix-notes-title">
            Notes: what’s new <span className="muted">({notes.data ? unusedLabel(usable.length, setAside.length) : '…'})</span>
          </strong>
          <Hint>
            {NOTES_ABOUT} {NOTES_SHARED}
          </Hint>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} data-testid="note-add">
            Add a note
          </Button>
        )}
      </div>
      {adding && (
        <NoteForm
          productId={productId}
          onDone={() => {
            setAdding(false)
            notes.reload()
          }}
        />
      )}
      <ErrorNote error={notes.error ?? removing.error} />
      {notes.loading && !notes.data && <Loading what="Loading notes" />}
      {notes.data && open.length === 0 && !adding && (
        <p className="muted small" data-testid="mix-notes-empty">
          No unused note. Tell what is new and the AI can write an update from it.
        </p>
      )}
      {open.length > 0 && (
        <ul className="mix-note-list" data-testid="mix-notes-unused">
          {open.map((note) => (
            <NoteRow key={note.id} note={note}>
              <Button variant="quiet" onClick={() => void remove(note.id)} disabled={removing.busy} aria-label={`Remove note: ${note.text.length > 60 ? `${note.text.slice(0, 60)}…` : note.text}`} data-testid={`note-remove-${note.id}`}>
                Remove
              </Button>
            </NoteRow>
          ))}
        </ul>
      )}
      {used.length > 0 && (
        <div className="mix-notes-used" data-testid="mix-notes-used">
          <span className="field-label">Used</span>
          <ul className="mix-note-list">
            {used.map((note) => (
              <NoteRow key={note.id} note={note}>
                <Badge>Used for a post</Badge>
              </NoteRow>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NoteRow({ note, children }: { note: ProductUpdate; children: ReactNode }) {
  return (
    <li className="mix-note" data-testid={`note-${note.id}`}>
      <span className="mix-note-text">
        <span data-testid="note-text">{note.text}</span>
        <span className="muted small"> · {shortDate(note.createdAt, Date.now())}</span>
        {isSetAside(note) && (
          <span className="hint warn mix-note-aside" data-testid="note-set-aside">
            {SET_ASIDE_WORDS}
          </span>
        )}
      </span>
      <span className="mix-note-action">{children}</span>
    </li>
  )
}

/** One line, "Add" and "Cancel". Enter adds, Escape leaves. The count of characters appears near the limit. */
function NoteForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const addVariant = useOpenForm()
  const [add, state] = useAction(async () => {
    await call('updates.add', { productId, text: normalizeNote(text) })
    onDone()
  })
  const problem = noteProblem(text)

  return (
    <div className="mix-note-form" data-testid="note-form">
      <div className="mix-note-form-line">
        <input
          className="input"
          autoFocus
          value={text}
          maxLength={NOTE_MAX}
          placeholder="What is new? For example: fixed the bug that put the birth time in the wrong place"
          aria-label="A note about what is new"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (problem === null && !state.busy) void add()
            } else if (e.key === 'Escape' && !state.busy) onDone()
          }}
          disabled={state.busy}
          data-testid="note-input"
        />
        <Button variant={addVariant} onClick={() => void add()} disabled={problem !== null || state.busy} data-testid="note-submit">
          {state.busy ? 'Adding…' : 'Add'}
        </Button>
        <Button onClick={onDone} disabled={state.busy} data-testid="note-cancel">
          Cancel
        </Button>
      </div>
      {showNoteCount(text) && (
        <span className="hint" role="status" data-testid="note-count">
          {text.length} of {NOTE_MAX} characters
        </span>
      )}
      <ErrorNote error={state.error} />
    </div>
  )
}
