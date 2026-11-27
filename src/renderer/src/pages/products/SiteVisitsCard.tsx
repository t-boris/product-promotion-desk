import { useState } from 'react'
import { PLAUSIBLE_HOST, VISIT_SOURCES, VISIT_SOURCE_LABEL, siteIdOf, visitRowName, type SiteVisitsView, type VisitSource } from '../../../../shared/site-visits'
import type { Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, Card, ErrorNote, Field, Hint, formatTime } from '../../ui'

/**
 * Where the product's site is counted (DEC-073). "No analytics on the site" is the starting answer and a valid one: nothing is asked for and
 * a goal about visitors is simply not offered. With Plausible the application reads the visitors itself, read-only, with a key kept in the
 * vault. Google Analytics is noted as a fact about the product; the application does not read it.
 */
export function SiteVisitsCard({ product }: { product: Product }) {
  const visits = useQuery('visits.get', { productId: product.id }, ['products', 'results'])
  const view = visits.data
  if (!view) return visits.error ? <ErrorNote error={visits.error} /> : null
  return <Body key={`${view.source}|${view.siteId}|${view.host}`} product={product} view={view} />
}

function Body({ product, view }: { product: Product; view: SiteVisitsView }) {
  const [source, setSource] = useState<VisitSource>(view.source)
  const [siteId, setSiteId] = useState(view.siteId || siteIdOf(product.websiteUrl))
  const [host, setHost] = useState(view.host === PLAUSIBLE_HOST ? '' : view.host)
  const [key, setKey] = useState('')
  const [save, saving] = useAction(async () => {
    await call('visits.setSource', { productId: product.id, source, siteId, host, key })
    setKey('')
  })
  const [read, reading] = useAction(() => call('visits.read', { productId: product.id }))
  const busy = saving.busy || reading.busy
  const changed = source !== view.source || (source === 'plausible' && (siteId.trim() !== view.siteId || (host.trim() || PLAUSIBLE_HOST) !== view.host || key.trim() !== ''))
  const ready = source !== 'plausible' || (siteId.trim() !== '' && (view.hasKey || key.trim() !== ''))
  return (
    <Card title="Site visits">
      <div className="stack" data-testid="site-visits">
        <Field label="Analytics on the product’s site">
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as VisitSource)} disabled={busy} data-testid="visits-source">
            {VISIT_SOURCES.map((id) => (
              <option key={id} value={id}>
                {VISIT_SOURCE_LABEL[id]}
              </option>
            ))}
          </select>
        </Field>
        {source === 'none' && <Hint>Nothing is needed. Without analytics the application cannot know who came to the site, so a goal about visitors is not offered; goals about posts, replies, likes and comments are.</Hint>}
        {source === 'google' && <Hint>Noted. The application does not read Google Analytics, so a goal about visitors is not offered for this product.</Hint>}
        {source === 'plausible' && (
          <>
            <div className="goal-number-fields">
              <Field label="Site, as Plausible lists it" hint="Its domain, like example.com.">
                <input className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={busy} data-testid="visits-site" />
              </Field>
              <Field label="Stats API key" hint={view.hasKey ? 'A key is saved. Leave empty to keep it.' : 'In Plausible: account settings, API Keys, New API Key, Stats API.'}>
                <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} disabled={busy} autoComplete="off" data-testid="visits-key" />
              </Field>
              <Field label="Your own Plausible address (optional)" hint="Only when Plausible runs on your own server.">
                <input className="input" value={host} onChange={(e) => setHost(e.target.value)} disabled={busy} placeholder="https://…" data-testid="visits-host" />
              </Field>
            </div>
            <Hint>The key is kept in the vault of this Mac, used only to read numbers, and never shown again or given to the AI. Plausible offers the Stats API on its Business plan.</Hint>
          </>
        )}
        <div className="row">
          <Button variant={changed ? 'primary' : undefined} onClick={() => void save()} disabled={busy || !changed || !ready} data-testid="visits-save">
            {saving.busy ? 'Saving…' : 'Save'}
          </Button>
          {view.canRead && !changed && (
            <Button onClick={() => void read()} disabled={busy} data-testid="visits-read">
              {reading.busy ? 'Reading…' : 'Read now'}
            </Button>
          )}
        </div>
        <ErrorNote error={saving.error ?? reading.error} />
        {view.canRead && (
          <div className="stack" data-testid="visits-numbers">
            {view.error && !reading.error && <Hint>The last reading failed: {view.error}</Hint>}
            {view.total === null ? (
              <span className="muted">Not read yet. The application reads once a day, or press Read now.</span>
            ) : (
              <>
                <span>
                  <strong>{view.total}</strong> visitors in the last {view.days} days{view.readAt ? <span className="muted"> · read {formatTime(view.readAt)}</span> : null}
                </span>
                {view.rows.length > 0 ? (
                  <ul className="campaigns">
                    {view.rows.map((row) => (
                      <li key={`${row.source}|${row.campaign}`}>
                        {visitRowName(row)}: {row.visitors}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">
                    {view.tagged ? 'No visitor came by a tagged address in these days.' : 'To see which channel a visitor came from, turn on “Name the platform and the channel in that address” for this product: the application then tags the site’s address in each post.'}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
