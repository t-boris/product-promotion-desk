import { useEffect, useState } from 'react'
import { FIND_KINDS, FIND_KIND_LABEL, MAX_COMPETITORS, MAX_PHRASES, type FindKind } from '../../../../shared/listening'
import type { ListeningView, Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { channelsNewHref } from '../../route'
import { Badge, Button, Card, ErrorNote, Hint, formatTime } from '../../ui'
import { AddressLink } from '../AddressLink'
import { linesOf, questionsChanged } from './answer-view'

/** The finds of one kind, or of all when none is chosen; the newest first (the order the core gives). */
export function findsOfKind(finds: ListeningView['finds'], kind: FindKind | null): ListeningView['finds'] {
  return kind === null ? finds : finds.filter((f) => f.kind === kind)
}

/**
 * Heard elsewhere (DEC-062): the product's name, a few phrases and a few competitors looked for on the open web, outside the connected
 * channels. "Look now" is one AI request with a web search; after the first look the application looks again every week. A find is a page to
 * read: nothing is posted or joined from here.
 */
export function ListeningCard({ product }: { product: Product }) {
  const listening = useQuery('listening.get', { productId: product.id }, ['results'])
  const view = listening.data
  const [phrases, setPhrases] = useState<string | null>(null)
  const [competitors, setCompetitors] = useState<string | null>(null)
  const [kind, setKind] = useState<FindKind | null>(null)
  const keptPhrases = view ? view.phrases.join('\n') : null
  const keptCompetitors = view ? view.competitors.join('\n') : null
  useEffect(() => {
    if (keptPhrases !== null) setPhrases(keptPhrases)
  }, [keptPhrases])
  useEffect(() => {
    if (keptCompetitors !== null) setCompetitors(keptCompetitors)
  }, [keptCompetitors])
  const [save, saving] = useAction(() => call('listening.setTerms', { productId: product.id, phrases: linesOf(phrases ?? ''), competitors: linesOf(competitors ?? '') }))
  const [look, looking] = useAction(() => call('listening.look', { productId: product.id }))
  if (!view || phrases === null || competitors === null) return listening.error ? <ErrorNote error={listening.error} /> : null
  const changed = questionsChanged(phrases, view.phrases) || questionsChanged(competitors, view.competitors)
  const running = looking.busy || view.running
  const shown = findsOfKind(view.finds, kind)
  return (
    <Card title="Heard elsewhere">
      <Hint>
        What is said about “{view.productName}”, your phrases and your competitors on the open web, outside the channels you are in. The AI engine searches; the application keeps each page once. A find is a page to read: nothing is posted or joined from here.
      </Hint>
      <div className="listening-terms">
        <label className="field">
          <span className="field-label">Phrases to watch, one a line (at most {MAX_PHRASES}); the product’s name is always watched</span>
          <textarea className="input listening-box" value={phrases} onChange={(e) => setPhrases(e.target.value)} disabled={saving.busy} data-testid="listening-phrases" />
        </label>
        <label className="field">
          <span className="field-label">Competitors, one a line (at most {MAX_COMPETITORS})</span>
          <textarea className="input listening-box" value={competitors} onChange={(e) => setCompetitors(e.target.value)} disabled={saving.busy} data-testid="listening-competitors" />
        </label>
      </div>
      <div className="answers-actions">
        <Button onClick={() => void save()} disabled={saving.busy || running || !changed} data-testid="listening-save">
          {saving.busy ? 'Saving…' : 'Save what to watch'}
        </Button>
        <Button variant="primary" onClick={() => void look()} disabled={saving.busy || running || changed} data-testid="listening-look">
          {running ? 'Looking…' : 'Look now'}
        </Button>
        <Hint>
          {changed ? 'Save before looking.' : 'One AI request with a web search: a few minutes.'}
          {view.lookedAt ? ` Looked ${formatTime(view.lookedAt)}.` : ''}
          {view.nextAt ? ` Looks again by itself on ${formatTime(view.nextAt)}.` : ''}
        </Hint>
      </div>
      {view.lastError && !looking.error && <p className="muted" data-testid="listening-last-error">The last look did not finish: {view.lastError}</p>}
      <ErrorNote error={saving.error ?? looking.error} />
      {view.finds.length > 0 && (
        <>
          <div className="answers-actions" role="group" aria-label="Kind">
            <Button variant={kind === null ? 'primary' : 'ghost'} onClick={() => setKind(null)}>
              All {view.finds.length}
            </Button>
            {FIND_KINDS.map((k) => (
              <Button key={k} variant={kind === k ? 'primary' : 'ghost'} onClick={() => setKind(k)} data-testid={`listening-kind-${k}`}>
                {FIND_KIND_LABEL[k]} {view.finds.filter((f) => f.kind === k).length}
              </Button>
            ))}
          </div>
          <ul className="answers-list" data-testid="listening-finds">
            {shown.map((find) => (
              <FindRow key={find.id} find={find} />
            ))}
          </ul>
        </>
      )}
      {view.finds.length === 0 && view.lookedAt && !view.lastError && <p className="muted" data-testid="listening-empty">Nothing found by the last look.</p>}
    </Card>
  )
}

function FindRow({ find }: { find: ListeningView['finds'][number] }) {
  const [dismiss, dismissing] = useAction(() => call('listening.dismiss', { id: find.id }))
  return (
    <li className="answers-row">
      <div className="answers-row-head">
        <Badge>{FIND_KIND_LABEL[find.kind]}</Badge>
        <AddressLink url={find.url} className="answers-question">
          {find.title}
        </AddressLink>
        {find.fresh && <Badge tone="good">New</Badge>}
        <Button onClick={() => void dismiss()} disabled={dismissing.busy} data-testid={`listening-dismiss-${find.id}`}>
          Not useful
        </Button>
        <Button variant="quiet" onClick={() => (window.location.hash = channelsNewHref(undefined, find.url))} data-testid={`listening-channel-${find.id}`}>
          Add as a channel
        </Button>
      </div>
      <span>{find.said}</span>
      <span className="muted listening-url">
        {find.term} · {find.url}
      </span>
      <ErrorNote error={dismissing.error} />
    </li>
  )
}
