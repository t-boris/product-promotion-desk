import { useState } from 'react'
import type { SavedSiteProfile, SiteProfileDraft } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote } from '../../ui'

/**
 * "Prepare a site profile with AI" for a site the app has no prepared support for. The app only looks at the site (it
 * opens pages in this login's browser; it types and clicks nothing). The AI drafts a profile, which is shown here in plain
 * lines and saved only when the owner says so. A saved profile proves nothing: abilities stay "Needs verification".
 */
export function PrepareSiteProfile({ productId, accountId, url }: { productId: string; accountId: string; url: string }) {
  const [draft, setDraft] = useState<SiteProfileDraft | null>(null)
  const [saved, setSaved] = useState<SavedSiteProfile | null>(null)
  const [prepare, preparing] = useAction(() => call('channels.draftProfile', { productId, accountId, url }))
  const [save, saving] = useAction((d: SiteProfileDraft) => call('channels.saveProfile', { host: d.host, definition: d.definition }))

  async function run(): Promise<void> {
    setSaved(null)
    setDraft(null)
    const result = await prepare()
    if (result) setDraft(result)
  }

  async function keep(d: SiteProfileDraft): Promise<void> {
    const result = await save(d)
    if (result) setSaved(result)
  }

  const reviewable = draft !== null && draft.valid && draft.instructions.length === 0

  return (
    <div className="site-profile" data-testid="site-profile">
      <div className="row">
        <Button onClick={() => void run()} disabled={preparing.busy || saving.busy} data-testid="profile-prepare">
          {preparing.busy ? 'Reading the site…' : 'Prepare a site profile with AI'}
        </Button>
        <span className="muted small">
          A site profile tells the app how to read this kind of site. The app only looks at the site in this account’s browser: it does not type, click or send anything. It can take up to a minute.
        </span>
      </div>
      <ErrorNote error={preparing.error} />

      {draft && reviewable && (
        <div className="stack" data-testid="profile-draft">
          <div>
            <strong>Profile for {draft.host}</strong> <Badge tone="info">Draft, not saved</Badge>
          </div>
          <div className="muted small">What this profile says. Check that it matches the site:</div>
          <ul className="plain-lines" data-testid="profile-summary">
            {draft.summary.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <div className="muted small">Saving does not prove that anything works. Abilities stay “Needs verification” until the app checks them in the channel.</div>
          {saved ? (
            <div className="note" data-testid="profile-saved">
              Saved as version {saved.version} for {saved.host}. Connect the channel now; the app then checks what works.
            </div>
          ) : (
            <div className="row">
              <Button variant="primary" onClick={() => void keep(draft)} disabled={saving.busy} data-testid="profile-save">
                {saving.busy ? 'Saving…' : 'Save this profile'}
              </Button>
              <Button onClick={() => setDraft(null)} disabled={saving.busy} data-testid="profile-discard">
                Discard
              </Button>
            </div>
          )}
          <ErrorNote error={saving.error} />
        </div>
      )}

      {draft && !reviewable && (
        <div className="note warn" data-testid="profile-instructions">
          <strong>The app could not prepare a profile for {draft.host}.</strong>
          {draft.problems.length > 0 && (
            <ul className="plain-lines" data-testid="profile-problems">
              {draft.problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          )}
          {draft.instructions.map((line, index) => (
            <p key={index} className={index === 0 ? '' : 'small'}>
              {line}
            </p>
          ))}
          <Button onClick={() => setDraft(null)} data-testid="profile-discard">
            Close
          </Button>
        </div>
      )}
    </div>
  )
}
