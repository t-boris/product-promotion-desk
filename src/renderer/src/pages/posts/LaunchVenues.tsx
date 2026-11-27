import { VENUES, VENUE_STEPS, VENUE_STEP_LABEL, type VenueStep } from '../../../../shared/product-choices'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Card, ErrorNote, Hint } from '../../ui'
import { AddressLink } from '../AddressLink'

/**
 * Launch venues for a software product (DEC-071): the places where software is launched, each with the venue's own page and the owner's own
 * checklist. The application states no venue's rules and reads none of them: the owner reads them at the venue. Shown in full only when the
 * owner said the product is software.
 */
export function LaunchVenues({ productId }: { productId: string }) {
  const choices = useQuery('choices.get', { productId }, ['products', 'channels'])
  const venues = useQuery('choices.venues', { productId }, ['products'])
  const [setSoftware, setting] = useAction((on: boolean) => call('choices.set', { productId, software: on }))
  const [tick, ticking] = useAction((args: { venue: string; step: VenueStep; done: boolean }) => call('choices.tickVenue', { productId, ...args }))
  const view = choices.data
  if (!view) return null
  return (
    <Card title="Launch venues">
      <label className="dates-kind">
        <input type="checkbox" checked={view.software} onChange={(e) => void setSoftware(e.target.checked)} disabled={setting.busy} data-testid="software-switch" /> This product is software
      </label>
      {view.software && (
        <>
          <Hint>Places where software is launched. Each has rules of its own and may make a new account wait: read them at the venue. The ticks are yours; the application posts nothing there.</Hint>
          <ul className="campaigns" data-testid="launch-venues">
            {VENUES.map((venue) => {
              const done = venues.data?.find((v) => v.venue === venue.id)?.done ?? []
              return (
                <li key={venue.id} className="campaign">
                  <div className="row">
                    <strong>{venue.name}</strong>
                    <AddressLink url={venue.url}>The venue’s own page</AddressLink>
                    {done.includes('launched') && <Badge tone="good">Launched</Badge>}
                  </div>
                  {VENUE_STEPS.map((step) => (
                    <label key={step} className="dates-kind">
                      <input type="checkbox" checked={done.includes(step)} onChange={(e) => void tick({ venue: venue.id, step, done: e.target.checked })} disabled={ticking.busy} data-testid={`venue-${venue.id}-${step}`} /> {VENUE_STEP_LABEL[step]}
                    </label>
                  ))}
                </li>
              )
            })}
          </ul>
        </>
      )}
      <ErrorNote error={setting.error ?? ticking.error} />
    </Card>
  )
}
