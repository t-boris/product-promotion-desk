import { useState } from 'react'
import { PASSPORT_SECTIONS, type Claim, type PassportSection, type PassportView } from '../../../../shared/types'
import { Button, Hint } from '../../ui'
import { ClaimForm } from '../products/ClaimForm'
import { ClaimRow } from '../products/ClaimRow'
import { SECTION_HINTS, SECTION_LABELS } from '../products/labels'
import { groupBySection } from '../products/model'
import { sectionLine, startsWithForm, summarizeSection } from './passport-summary'

/** One section of the passport: a closed summary tile, or, after "Edit", the section's editor in its place. */
function SectionTile({ section, view, claims, editing, onEdit, onDone }: { section: PassportSection; view: PassportView; claims: Claim[]; editing: boolean; onEdit: () => void; onDone: () => void }) {
  const summary = summarizeSection(section, claims)
  const label = SECTION_LABELS[section]
  // "Edit" on a section with no statement opens the new-statement form at once: there is nothing to edit yet.
  const [adding, setAdding] = useState(false)
  const edit = (): void => {
    setAdding(startsWithForm(summary))
    onEdit()
  }
  const done = (): void => {
    setAdding(false)
    onDone()
  }

  return (
    <section className={`card passport-tile${editing ? ' open' : ''}`} aria-label={label} data-testid={`section-${section}`}>
      <header className="passport-tile-head">
        <h3>{label}</h3>
        <div className="passport-tile-actions">
          {editing && (
            <Button variant="quiet" className="accent" onClick={() => setAdding(true)} disabled={adding} aria-label={`Add statement to ${label}`} data-testid={`add-claim-${section}`}>
              + Add statement
            </Button>
          )}
          <Button variant="quiet" className="accent" onClick={editing ? done : edit} aria-expanded={editing} aria-label={editing ? `Close the editor of ${label}` : `Edit ${label}`} data-testid={`edit-section-${section}`}>
            {editing ? 'Done' : 'Edit'}
          </Button>
        </div>
      </header>
      {editing ? (
        <div className="passport-editor">
          <Hint>{SECTION_HINTS[section]}</Hint>
          <div className="rows claim-list">
            {claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} all={view.claims} productId={view.product.id} />
            ))}
          </div>
          {adding && <ClaimForm productId={view.product.id} section={section} onDone={() => setAdding(false)} />}
        </div>
      ) : (
        <>
          <p className="passport-tile-line">
            <span className={`dot ${summary.tone}`} aria-hidden="true" />
            <span data-testid={`section-line-${section}`}>{sectionLine(summary)}</span>
          </p>
          {summary.preview.length === 0 ? (
            <Hint>{SECTION_HINTS[section]}</Hint>
          ) : (
            <ul className="passport-preview" data-testid={`section-preview-${section}`}>
              {summary.preview.map((item) => (
                <li key={item.id}>
                  {item.mark && <span className="passport-mark">{item.mark}</span>}
                  {item.text}
                </li>
              ))}
              {summary.more > 0 && <li className="passport-more">+ {summary.more} more</li>}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/**
 * The eight sections of the passport as a two-column summary (DEC-037, phase C4): each tile says what the section holds, and "Edit" opens
 * the section's editor (its statements with every control they had, and the new-statement form) over the width of both columns, in place.
 * Several editors may be open at once; every tile keeps its place in the reading order, so a half-typed statement is not lost when another opens.
 */
export function PassportSections({ view }: { view: PassportView }) {
  const [open, setOpen] = useState<PassportSection[]>([])
  const grouped = groupBySection(view.claims)
  return (
    <div className="passport-sections" data-testid="passport-sections">
      {PASSPORT_SECTIONS.map((section) => (
        <SectionTile
          key={section}
          section={section}
          view={view}
          claims={grouped[section]}
          editing={open.includes(section)}
          onEdit={() => setOpen((list) => (list.includes(section) ? list : [...list, section]))}
          onDone={() => setOpen((list) => list.filter((item) => item !== section))}
        />
      ))}
    </div>
  )
}
