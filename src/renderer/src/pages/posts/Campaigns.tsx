import { useState } from 'react'
import { MAX_THEME_MESSAGE, MAX_THEME_NAME, daysProblem, recapLine, type ThemeState, type ThemeView } from '../../../../shared/post-themes'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint } from '../../ui'

const STATE_LABEL: Record<ThemeState, string> = { running: 'Running', ahead: 'Ahead', over: 'Over' }
const STATE_TONE: Record<ThemeState, 'good' | undefined> = { running: 'good', ahead: undefined, over: undefined }
const dayOf = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Campaigns of a product (DEC-070; "themes" in the code): a named stretch of days in which the posts are about one thing. While one runs, the
 * AI's proposed posts are given its name and what it says. The application adds up what went out in its days. A campaign schedules and posts nothing.
 */
export function Campaigns({ productId }: { productId: string }) {
  const list = useQuery('themes.list', { productId }, ['products', 'results', 'opportunities'])
  // The id of the campaign in the form, 'new' for a new one, null for none.
  const [open, setOpen] = useState<string | null>(null)
  const themes = list.data
  if (!themes) return list.error ? <ErrorNote error={list.error} /> : null
  return (
    <Card title="Campaigns" actions={<Button onClick={() => setOpen(open === 'new' ? null : 'new')} data-testid="campaign-add-open">{open === 'new' ? 'Close' : 'Add a campaign'}</Button>}>
      <Hint>A campaign is a stretch of days with one subject: a launch, a season, a series. While it runs, the AI is given its name and what it says when it proposes a post. The numbers are what the application sent in its days and what the sites show under it.</Hint>
      {open === 'new' && <CampaignForm productId={productId} theme={null} onDone={() => setOpen(null)} />}
      {themes.length === 0 && open !== 'new' && <p className="muted" data-testid="campaigns-empty">No campaign yet.</p>}
      {themes.length > 0 && (
        <ul className="campaigns" data-testid="campaigns">
          {themes.map((theme) =>
            open === theme.id ? (
              <li key={theme.id}>
                <CampaignForm productId={productId} theme={theme} onDone={() => setOpen(null)} />
              </li>
            ) : (
              <li key={theme.id} className="campaign">
                <div className="row">
                  <Badge tone={STATE_TONE[theme.state]}>{STATE_LABEL[theme.state]}</Badge>
                  <strong>{theme.name}</strong>
                  <span className="muted">
                    {dayOf(theme.from)} – {dayOf(theme.to)}
                  </span>
                  <Button variant="quiet" onClick={() => setOpen(theme.id)} data-testid={`campaign-edit-${theme.id}`}>
                    Edit
                  </Button>
                </div>
                {theme.message && <span>{theme.message}</span>}
                {theme.state !== 'ahead' && <span className="muted">{recapLine(theme.recap)}</span>}
              </li>
            )
          )}
        </ul>
      )}
    </Card>
  )
}

function CampaignForm({ productId, theme, onDone }: { productId: string; theme: ThemeView | null; onDone: () => void }) {
  const [name, setName] = useState(theme?.name ?? '')
  const [message, setMessage] = useState(theme?.message ?? '')
  const [from, setFrom] = useState(theme?.from ?? '')
  const [to, setTo] = useState(theme?.to ?? '')
  const [save, saving] = useAction(async () => {
    await call('themes.save', { productId, id: theme?.id ?? null, name, message, from, to })
    onDone()
  })
  const [remove, removing] = useAction(async () => {
    if (!theme) return
    await call('themes.remove', { id: theme.id })
    onDone()
  })
  const [confirming, setConfirming] = useState(false)
  const busy = saving.busy || removing.busy
  const problem = from !== '' && to !== '' ? daysProblem(from, to) : null
  return (
    <div className="stack" data-testid="campaign-form">
      <Field label="Name">
        <input className="input" value={name} maxLength={MAX_THEME_NAME} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="First steps with a chart" data-testid="campaign-name" />
      </Field>
      <Field label="What it says" hint="A sentence or two, in your words. The AI is given this while the campaign runs.">
        <textarea className="input short" value={message} maxLength={MAX_THEME_MESSAGE} onChange={(e) => setMessage(e.target.value)} disabled={busy} data-testid="campaign-message" />
      </Field>
      <div className="campaign-days">
        <Field label="First day">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} data-testid="campaign-from" />
        </Field>
        <Field label="Last day">
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} data-testid="campaign-to" />
        </Field>
      </div>
      {problem && <Hint>{problem}</Hint>}
      <div className="row">
        <Button variant="primary" onClick={() => void save()} disabled={busy || name.trim() === '' || from === '' || to === '' || problem !== null} data-testid="campaign-save">
          {saving.busy ? 'Saving…' : theme ? 'Save' : 'Add'}
        </Button>
        <Button variant="quiet" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        {theme &&
          (confirming ? (
            <>
              <span>Delete this campaign? The posts stay.</span>
              <Button onClick={() => void remove()} disabled={busy} data-testid="campaign-delete-yes">
                Yes, delete
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)} disabled={busy} data-testid="campaign-delete">
              Delete
            </Button>
          ))}
      </div>
      <ErrorNote error={saving.error ?? removing.error} />
    </div>
  )
}
