import { useEffect, useState } from 'react'
import { MAX_HANDLE, MAX_NOTE, MAX_OWED, MAX_SOURCE, MAX_TESTIMONIAL, MAX_WHERE, PEOPLE_FILTERS, PERMISSIONS, PERMISSION_LABEL, emptyPerson, matchesFilter, personChanged, shownPeople, usableTestimonial, type PeopleFilter, type Person, type PersonFields } from '../../../shared/people'
import type { Product } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint, Loading } from '../ui'
import { peoplePrefillOf } from '../route'
import { ProductScreen } from './ProductScreen'
import './people.css'

const FILTER_LABEL: Record<PeopleFilter, string> = { all: 'All', owed: 'Owed', testimonials: 'Testimonials' }
const fieldsOf = (person: Person): PersonFields => ({ handle: person.handle, platform: person.platform, where: person.where, note: person.note, owed: person.owed, testimonial: person.testimonial, testimonialSource: person.testimonialSource, permission: person.permission })

/**
 * The people met while promoting the current product (DEC-066): who, where, what was said, what is owed, and their words about the product
 * with their permission. The owner's own notes: typed by hand, kept on this computer, never given to the AI and never posted.
 */
export function PeoplePage() {
  return (
    <ProductScreen title="People" subtitle="Who you met, what was said, what you owe" fill nextStage={false}>
      {(product) => <PeopleBody product={product} />}
    </ProductScreen>
  )
}

function PeopleBody({ product }: { product: Product }) {
  const list = useQuery('people.list', { productId: product.id }, ['products'])
  const [filter, setFilter] = useState<PeopleFilter>('all')
  const [query, setQuery] = useState('')
  // The chosen person's id, 'new' for the empty form, null for none.
  const [prefill] = useState(() => peoplePrefillOf(window.location.hash))
  const [chosen, setChosen] = useState<string | null>(prefill ? 'new' : null)
  const people = list.data
  if (!people) return list.error ? <ErrorNote error={list.error} /> : <Loading what="Loading the people" />
  const shown = shownPeople(people, filter, query)
  const person = chosen === 'new' ? null : (people.find((p) => p.id === chosen) ?? null)
  return (
    <div className="people" data-testid="people">
      <div className="people-list">
        <div className="people-bar">
          <Button variant="primary" onClick={() => setChosen('new')} data-testid="people-add">
            Add a person
          </Button>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search people" data-testid="people-search" />
        </div>
        <div className="people-filters" role="group" aria-label="Filter">
          {PEOPLE_FILTERS.map((id) => (
            <Button key={id} variant={filter === id ? 'primary' : 'ghost'} onClick={() => setFilter(id)} data-testid={`people-filter-${id}`}>
              {FILTER_LABEL[id]} {people.filter((p) => matchesFilter(p, id)).length}
            </Button>
          ))}
        </div>
        {people.length === 0 ? (
          <Hint data-testid="people-empty">Nobody yet. Add the first person you talked with: a name is enough to start.</Hint>
        ) : shown.length === 0 ? (
          <Hint>Nobody matches.</Hint>
        ) : (
          <ul className="people-rows" data-testid="people-rows">
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" className={`people-row${p.id === chosen ? ' chosen' : ''}`} aria-current={p.id === chosen} onClick={() => setChosen(p.id)} data-testid={`person-${p.id}`}>
                  <span className="people-handle">{p.handle}</span>
                  <span className="muted">{[p.platform, p.where].filter(Boolean).join(' · ') || 'no place noted'}</span>
                  <span className="people-marks">
                    {p.owed !== '' && <Badge tone="warn">Owed</Badge>}
                    {p.testimonial !== '' && <Badge tone={usableTestimonial(p) ? 'good' : undefined}>{usableTestimonial(p) ? 'Testimonial, permission given' : 'Testimonial'}</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="people-detail">
        {chosen === null || (chosen !== 'new' && !person) ? (
          <Hint>Choose a person, or add one. These are your own notes: the application gives none of them to the AI and posts none of them.</Hint>
        ) : (
          <PersonForm key={chosen} productId={product.id} person={person} start={chosen === 'new' ? prefill : null} onSaved={(id) => setChosen(id)} onGone={() => setChosen(null)} />
        )}
      </div>
    </div>
  )
}

function PersonForm({ productId, person, start, onSaved, onGone }: { productId: string; person: Person | null; /** What a new person's form starts with (a comment in the Feed); nothing is kept until Add. */ start: Partial<PersonFields> | null; onSaved: (id: string) => void; onGone: () => void }) {
  const kept = person ? fieldsOf(person) : emptyPerson()
  const [form, setForm] = useState<PersonFields>(person ? kept : { ...kept, ...start })
  const stamp = person?.updatedAt ?? ''
  useEffect(() => {
    if (person) setForm(fieldsOf(person))
    // The form follows the kept entry when it changes underneath (a save): only its stamp is watched.
  }, [stamp])
  const [save, saving] = useAction(async (fields: PersonFields) => {
    const saved = await call('people.save', { productId, id: person?.id ?? null, ...fields })
    onSaved(saved.id)
  })
  const [remove, removing] = useAction(async () => {
    if (!person) return
    await call('people.remove', { id: person.id })
    onGone()
  })
  const [confirming, setConfirming] = useState(false)
  const busy = saving.busy || removing.busy
  const set = (patch: Partial<PersonFields>): void => setForm((current) => ({ ...current, ...patch }))
  const changed = personChanged(form, kept)
  return (
    <div className="stack" data-testid="person-form">
      <Card title={person ? person.handle : 'A new person'}>
        <div className="people-pair">
          <Field label="Who" hint="A name or a handle, as you know them.">
            <input className="input" value={form.handle} maxLength={MAX_HANDLE} onChange={(e) => set({ handle: e.target.value })} disabled={busy} autoFocus={!person} data-testid="person-handle" />
          </Field>
          <Field label="Platform (optional)">
            <input className="input" value={form.platform} maxLength={40} onChange={(e) => set({ platform: e.target.value })} disabled={busy} placeholder="Reddit, Instagram, a fair…" data-testid="person-platform" />
          </Field>
        </div>
        <Field label="Where you met (optional)">
          <input className="input" value={form.where} maxLength={MAX_WHERE} onChange={(e) => set({ where: e.target.value })} disabled={busy} placeholder="A community, a thread, an event" data-testid="person-where" />
        </Field>
        <Field label="What was said">
          <textarea className="input short" value={form.note} maxLength={MAX_NOTE} onChange={(e) => set({ note: e.target.value })} disabled={busy} data-testid="person-note" />
        </Field>
        <Field label="What I owe" hint="Empty when nothing is owed.">
          <input className="input" value={form.owed} maxLength={MAX_OWED} onChange={(e) => set({ owed: e.target.value })} disabled={busy} data-testid="person-owed" />
        </Field>
        {person && kept.owed !== '' && (
          <Button onClick={() => void save({ ...form, owed: '' })} disabled={busy} data-testid="person-owed-done">
            Done, nothing owed
          </Button>
        )}
      </Card>
      <Card title="Their words about the product">
        <Field label="Testimonial (optional)" hint="Their words, as they wrote them.">
          <textarea className="input short" value={form.testimonial} maxLength={MAX_TESTIMONIAL} onChange={(e) => set({ testimonial: e.target.value })} disabled={busy} data-testid="person-testimonial" />
        </Field>
        <Field label="Where they said it (address, optional)">
          <input className="input" value={form.testimonialSource} maxLength={MAX_SOURCE} onChange={(e) => set({ testimonialSource: e.target.value })} disabled={busy} placeholder="https://…" data-testid="person-source" />
        </Field>
        <div className="people-permission" role="radiogroup" aria-label="Permission to quote">
          <span className="muted">Permission to quote:</span>
          {PERMISSIONS.map((id) => (
            <label key={id} className="people-radio">
              <input type="radio" name="person-permission" checked={form.permission === id} onChange={() => set({ permission: id })} disabled={busy || form.testimonial.trim() === ''} data-testid={`person-permission-${id}`} /> {PERMISSION_LABEL[id]}
            </label>
          ))}
        </div>
        <Hint>Only words with “Given” are marked as usable. The application never quotes anybody by itself.</Hint>
      </Card>
      <div className="people-actions">
        <Button variant="primary" onClick={() => void save(form)} disabled={busy || form.handle.trim() === '' || !changed} data-testid="person-save">
          {saving.busy ? 'Saving…' : person ? 'Save' : 'Add'}
        </Button>
        {person &&
          (confirming ? (
            <>
              <span>Delete {person.handle} for good?</span>
              <Button onClick={() => void remove()} disabled={busy} data-testid="person-delete-yes">
                {removing.busy ? 'Deleting…' : 'Yes, delete'}
              </Button>
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)} disabled={busy} data-testid="person-delete">
              Delete
            </Button>
          ))}
      </div>
      <ErrorNote error={saving.error ?? removing.error} />
    </div>
  )
}
