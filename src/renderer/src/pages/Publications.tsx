import { useEffect, useState } from 'react'
import type { Id } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { publicationsProductOf } from '../route'
import { Button, EmptyState, ErrorNote, Field, Hint, Loading, OpenFormsScope, Page } from '../ui'
import { connectChannelHref } from './attention-links'
import { useMainActionOwner } from './review/main-action'
import { PublicationForm } from './review/PublicationForm'
import { ProductFilter, useProductDirectory, useProductFilter } from './review/products'
import { ReviewCard } from './review/ReviewCard'
import './review/review.css'

const CLOSED = ['confirmed', 'cancelled']

export function PublicationsPage() {
  return (
    // The new-publication form is opened on demand: while it is open it owns the screen's filled button.
    <OpenFormsScope>
      <PublicationsScreen />
    </OpenFormsScope>
  )
}

function PublicationsScreen() {
  const directory = useProductDirectory()
  const [chosenProduct, setProduct] = useProductFilter('publications')
  // The last stage of a product's launch path links here as #/publications/<productId>: show that product.
  useEffect(() => {
    const follow = (): void => {
      const linked = publicationsProductOf(window.location.hash)
      if (linked) setProduct(linked)
    }
    follow()
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])
  const productId = directory.effective(chosenProduct)
  const inScope = directory.channelsOf(productId)
  const [chosen, setChosen] = useState<Id | ''>('')
  // Publications are written for one channel: the first channel of the chosen product until the owner picks another.
  const channel = inScope.find((c) => c.id === chosen) ?? inScope[0]
  const channelId = channel?.id ?? ''
  const productName = channel ? directory.productNameOfChannel(channel.id) : undefined
  const list = useQuery('opportunities.list', { channelId: channelId || undefined, kind: 'standalone' }, ['opportunities'])
  const [writing, setWriting] = useState(false)
  const [suggest, suggesting] = useAction(async () => {
    if (channelId) await call('publications.suggest', { channelId })
  })

  const postAbility = channel?.capabilities.find((c) => c.key === 'publish_post')
  const cannotPost = postAbility && (postAbility.status === 'unavailable' || postAbility.status === 'restricted')
  const cards = channelId ? (list.data ?? []) : []
  const pending = cards.filter((c) => !CLOSED.includes(c.opportunity.state))
  const sent = cards.filter((c) => c.opportunity.state === 'confirmed')
  const cancelled = cards.filter((c) => c.opportunity.state === 'cancelled')
  // The first open draft that offers a main action has the screen's one filled button.
  const mainAction = useMainActionOwner(pending.map((card) => card.opportunity.id))

  return (
    <Page title="Publications" subtitle="Drafts, scheduled and sent material">
      <div className="list-head">
        <div className="toolbar">
          <ProductFilter products={directory.products} value={productId} onChange={setProduct} />
          <Field label="Channel">
            <select className="input" value={channelId} onChange={(e) => setChosen(e.target.value)} disabled={inScope.length === 0} data-testid="publication-channel">
              {/* Without a channel the select is not blank: it says why there is nothing to choose. */}
              {inScope.length === 0 && (
                <option value="" disabled>
                  No channels yet
                </option>
              )}
              {inScope.map((c) => (
                <option key={c.id} value={c.id}>
                  {directory.channelLabel(c, productId !== '')}
                </option>
              ))}
            </select>
          </Field>
          {/* An AI helper is never the filled button: the owner's own way ("Write one myself") is as near as the AI's. */}
          <Button variant="secondary" icon="sparkles" onClick={() => void suggest()} disabled={!channelId || suggesting.busy} data-testid="suggest-publication">
            {suggesting.busy ? 'Asking the AI…' : 'Suggest with AI'}
          </Button>
          <Button onClick={() => setWriting(true)} disabled={!channelId || writing} data-testid="write-publication">
            Write one myself
          </Button>
          {/* Why the two buttons are off, beside them, with the way to fix it. */}
          {directory.ready && !channelId && (
            <Hint className="toolbar-hint" data-testid="publication-needs-channel">
              Connect a channel first. <a href={connectChannelHref(productId)}>Connect a channel</a>
            </Hint>
          )}
        </div>
        <ErrorNote error={directory.error ?? suggesting.error} />
        {cannotPost && (
          <div className="note warn" data-testid="post-warning">
            <div>
              <strong>Posting not available</strong>
            </div>
            <div>
              Publishing posts is {postAbility.status} in this channel{postAbility.detail ? `: ${postAbility.detail}` : ''}. You can still prepare drafts.
            </div>
          </div>
        )}
        <Hint>
          The AI proposes a topic and a draft from your approved product knowledge and the channel's rules. Every publication needs your own approval; the automatic rules never publish posts.
        </Hint>
      </div>

      {directory.ready && inScope.length === 0 && (
        <EmptyState
          fill
          art="channel"
          title="No channels yet"
          action={
            <a className="btn btn-primary" href={connectChannelHref(productId)} data-testid="publications-connect-channel">
              Connect a channel
            </a>
          }
        >
          {productId ? 'This product has no channels yet. Add one on the product page; publications are written for a specific channel.' : 'Connect a channel first; publications are written for a specific channel.'}
        </EmptyState>
      )}

      {writing && channelId && <PublicationForm channelId={channelId} onCreated={() => setWriting(false)} onCancel={() => setWriting(false)} />}

      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading what="Loading" />}

      {channelId && list.data && (
        <>
          <section className="review-section" data-testid="pending-publications">
            <h2>Drafts, approved and scheduled</h2>
            {pending.length === 0 && (
              <EmptyState
                art="draft"
                title="No drafts"
                action={
                  // The next step; filled because nothing else on the screen is: no draft has an Approve, and the form is closed.
                  !writing && (
                    <Button variant="primary" onClick={() => setWriting(true)} data-testid="write-publication-empty">
                      Write one myself
                    </Button>
                  )
                }
              >
                Ask the AI for a suggestion or write one yourself.
              </EmptyState>
            )}
            <div className="review-list">
              {pending.map((card) => (
                <ReviewCard
                  key={card.opportunity.id}
                  card={card}
                  collapsible
                  defaultOpen={pending.length === 1}
                  productName={productName}
                  primaryAction={mainAction.isOwner(card.opportunity.id)}
                  onMainAction={mainAction.offer}
                />
              ))}
            </div>
          </section>
          {sent.length > 0 && (
            <section className="review-section" data-testid="sent-publications">
              <h2>Sent</h2>
              <div className="review-list">
                {sent.map((card) => (
                  <ReviewCard key={card.opportunity.id} card={card} collapsible defaultOpen={false} productName={productName} />
                ))}
              </div>
            </section>
          )}
          {cancelled.length > 0 && (
            <section className="review-section">
              <h2>Rejected</h2>
              <div className="review-list">
                {cancelled.map((card) => (
                  <ReviewCard key={card.opportunity.id} card={card} collapsible defaultOpen={false} productName={productName} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Page>
  )
}
