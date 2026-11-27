import { useEffect, useState } from 'react'
import { DEFAULT_SCHEDULE_GRACE_HOURS, graceChoices } from '../../../shared/schedule'
import type { EngineId } from '../../../shared/types'
import { parseWebPort, usablePort } from '../../../shared/web-port'
import { call, useAction, useQuery } from '../hooks'
import { Icon } from '../icons'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Hint, Loading, More, Page, Switch } from '../ui'
import { AppearanceCard } from './AppearanceCard'
import { MailboxesCard } from './channels/MailboxesCard'
import { engineChoiceVariant, recommendedEngineId, splitEngineDetail } from './engine-detail'
import { EngineModelField } from './EngineModelField'
import { LessonsCard } from './LessonsCard'
import './settings.css'

export function SettingsPage() {
  const engines = useQuery('engines.list', undefined, ['settings'])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const info = useQuery('app.info', undefined, ['settings'])
  // The base mailbox of the account library (DEC-037, phase C5): the Accounts screen lists logins only, the address they are made from is a setting.
  const mailboxes = useQuery('mailboxes.list', undefined, ['accounts'])
  // The port field: what the owner typed and has not applied yet (null shows the port in use), and why it was refused.
  const [draft, setDraft] = useState<string | null>(null)
  const [portError, setPortError] = useState<string | null>(null)

  const [selectEngine, selecting] = useAction((id: EngineId) => call('engines.select', { id }))
  const [recheck, rechecking] = useAction(async () => {
    engines.reload()
  })
  const [update, updating] = useAction((patch: Parameters<typeof call<'app.settings.update'>>[1]) => call('app.settings.update', patch))
  // A port edit has its own action, so applying it when the field loses focus does not disable the switch under the next click.
  const [updatePort, updatingPort] = useAction((patch: Parameters<typeof call<'app.settings.update'>>[1]) => call('app.settings.update', patch))

  const current = settings.data
  const recommendedId = recommendedEngineId(engines.data ?? [])
  const anySelected = engines.data?.some((engine) => engine.id === current?.engineId) ?? false
  const webEnabled = current?.webMode.enabled ?? false
  const publishWithAi = current?.publishWith === 'ai_browser'
  const portInUse = usablePort(current?.webMode.port)
  // The field shows the port in use as soon as it changes, applied here or elsewhere, so it never shows another one.
  useEffect(() => {
    setDraft(null)
    setPortError(null)
  }, [portInUse])

  /** The port to use now: the typed one when it is valid, else null with the reason beside the field. */
  const checkedPort = (): number | null => {
    if (draft === null) return portInUse
    const parsed = parseWebPort(draft)
    setPortError(parsed.ok ? null : parsed.message)
    return parsed.ok ? parsed.port : null
  }
  /** A valid port applies when the field loses focus or on Enter; an invalid one stays in the field with its reason and nothing is sent. */
  const applyPort = async (): Promise<void> => {
    const port = checkedPort()
    if (port === null) return
    const saved = port === portInUse ? undefined : await updatePort({ webMode: { enabled: webEnabled, port } })
    // Nothing to change, or the change was refused (the reason is above): the field shows the port in use again.
    if (!saved) setDraft(null)
  }
  /** The switch never turns access on with a port that cannot work, and turns it off whatever the field says. */
  const toggleWeb = (next: boolean): void => {
    const port = checkedPort()
    if (next && port === null) return
    void update({ webMode: { enabled: next, port: port ?? portInUse } })
  }

  return (
    <Page title="Settings" subtitle="AI engine, notifications, appearance, publishing, base mailbox, local web access and version">
      <Card
        title="AI engine"
        actions={
          <Button onClick={() => void recheck()} disabled={rechecking.busy}>
            Re-check
          </Button>
        }
      >
        <Hint>Promotion data lives in this application, not in the engine. You can switch engines at any time; products, claims and history stay as they are.</Hint>
        <More label="Without an engine">
          <Hint>Without an engine you can still enter product data by hand.</Hint>
        </More>
        <ErrorNote error={engines.error ?? selecting.error} />
        {engines.loading && !engines.data && <Loading what="Checking installed engines" />}
        {engines.data && engines.data.length === 0 && <EmptyState title="No AI engines found">Install Codex or Claude Code to enable analysis and drafting.</EmptyState>}
        <div className="rows engines">
          {engines.data?.map((engine) => {
            const selected = current?.engineId === engine.id
            const detail = splitEngineDetail(engine.detail)
            const recommended = engine.id === recommendedId
            return (
              <div key={engine.id} className="engine" data-testid={`engine-${engine.id}`}>
                <div className="engine-body">
                  {/* One line says what is installed: "Claude Code 2.1.325 · Ready". The path is a detail (BUG-037). */}
                  <div className="engine-name">
                    <strong>{engine.label}</strong>
                    {engine.version && (
                      <span className="hint" data-testid={`engine-version-${engine.id}`}>
                        {engine.version}
                      </span>
                    )}
                    {selected && <Badge>Selected</Badge>}
                    {recommended && !selected && <Badge tone="info">Recommended</Badge>}
                    {engine.installed ? <Badge tone={engine.ready ? 'good' : 'warn'}>{engine.ready ? 'Ready' : 'Installed'}</Badge> : <Badge>Not installed</Badge>}
                  </div>
                  {/* The engine's own summary repeats the version and the badge when it answers; it is shown only when it says what is wrong:
                      "codex was not found. Install Codex, then re-check.", or why the check failed. */}
                  {!engine.ready && detail.summary && <div className="hint">{detail.summary}</div>}
                  {detail.writing && <div className={`hint${detail.limits ? ' warn' : ''}`}>{detail.writing}</div>}
                  {detail.missions && <div className="hint">{detail.missions}</div>}
                  <EngineModelField key={engine.checkedAt} engine={engine.id} label={engine.label} saved={current?.models?.[engine.id] ?? ''} installed={engine.installed} />
                  {engine.path && (
                    <More label="Details">
                      <div className="mono engine-location" data-testid={`engine-path-${engine.id}`}>
                        {engine.path}
                      </div>
                    </More>
                  )}
                </div>
                {selected ? (
                  <span className="engine-in-use" data-testid={`engine-in-use-${engine.id}`}>
                    <Icon name="check" /> In use
                  </span>
                ) : (
                  <Button variant={engineChoiceVariant(engine.id, recommendedId, anySelected)} disabled={!engine.installed || selecting.busy} onClick={() => void selectEngine(engine.id)}>
                    Use this engine
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <LessonsCard />

      <Card title="Notifications">
        <div className="group-row">
          <Switch
            checked={current?.notifications ?? true}
            disabled={!current || updating.busy}
            onChange={(next) => void update({ notifications: next })}
            label="Show macOS notifications for items that need you"
            testId="notifications-switch"
          />
        </div>
      </Card>

      <AppearanceCard />

      <Card title="Publishing">
        <Hint>
          Posts go out through each platform's connector. A channel the app does not read (Instagram, Facebook, Threads) has no connector: the AI always publishes there, in the account's own browser, on your press of Send or at the time you set,
          and needs Claude Code as the engine. The switch below is for the other channels, where a connector cannot carry a post (several pictures, or pictures with words on Reddit).
        </Hint>
        <ErrorNote error={updating.error} />
        <div className="group-row">
          <Switch
            checked={publishWithAi}
            disabled={!current || updating.busy}
            onChange={(next) => void update({ publishWith: next ? 'ai_browser' : 'connector' })}
            label="Let the AI publish in the account's browser"
            testId="publish-with-switch"
          />
        </div>
        <More label="What the AI may and may not do">
          <Hint>
            It types only the post you approved, puts in only the pictures you approved, and presses only the button that publishes, and only when you press Send; you watch it in the account's browser window and can stop it.
A post or a reply you gave a time goes out the same way when its time comes, with nobody pressing; a reply approved by an automatic rule never uses it. Either engine may do it. Claude Code is held to the application's browser tools alone; Codex cannot be held that way, so while it works it could also run commands and read files on this Mac. Choose Claude Code if that matters to you.
          </Hint>
        </More>
        {publishWithAi && !current?.engineId && <div className="hint warn">No AI engine is selected, so the AI cannot publish yet: select Claude Code or Codex above, or a send will stop and tell you.</div>}
        <Field label="A scheduled item may be late by" hint="Nothing is sent while the app is closed or the Mac sleeps. An item whose time passed by less than this goes out as soon as the app runs again; a later one comes back to you for review.">
          <select
            className="input"
            value={current?.scheduleGraceHours ?? DEFAULT_SCHEDULE_GRACE_HOURS}
            disabled={!current || updating.busy}
            onChange={(e) => void update({ scheduleGraceHours: Number(e.target.value) })}
            data-testid="schedule-grace"
          >
            {graceChoices(current?.scheduleGraceHours ?? DEFAULT_SCHEDULE_GRACE_HOURS).map((choice) => (
              <option key={choice.hours} value={choice.hours}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <MailboxesCard mailboxes={mailboxes.data ?? []} />

      <Card title="Local web access">
        <Hint>Serves this interface on 127.0.0.1 so it can be opened in a browser tab on this Mac, for example to check the app.</Hint>
        <More label="How it is protected">
          <Hint>It needs the secret link below, is reachable only from this computer, and cannot send anything without the same approvals the app always requires. Off by default.</Hint>
        </More>
        <ErrorNote error={updating.error ?? updatingPort.error} />
        <div className="rows">
          <div className="group-row">
            <Switch checked={webEnabled} disabled={!current || updating.busy} onChange={toggleWeb} label="Enable local web access" testId="web-switch" />
          </div>
          <label className="group-row">
            <span className="port-label">
              <span className="field-label">Port</span>
              {portError && (
                <span className="hint bad" id="web-port-error" role="alert" data-testid="web-port-error">
                  {portError}
                </span>
              )}
            </span>
            <input
              className="input port-input"
              value={draft ?? String(portInUse)}
              onChange={(e) => {
                setDraft(e.target.value)
                setPortError(null)
              }}
              onBlur={() => void applyPort()}
              onKeyDown={(e) => {
                // Enter applies and stays in the field, so a refused port is fixed where it is and the cursor is not thrown to the page; a held key sends one update.
                if (e.key === 'Enter' && !updatingPort.busy) void applyPort()
              }}
              inputMode="numeric"
              disabled={!current}
              aria-invalid={portError !== null}
              aria-describedby={portError ? 'web-port-error' : undefined}
              data-testid="web-port"
            />
          </label>
          {info.data?.webMode.enabled && info.data.webMode.url && (
            <p className="web-link">
              Open this link on this Mac: <code data-testid="web-url">{info.data.webMode.url}</code>
            </p>
          )}
        </div>
      </Card>

      <Card title="About">
        <dl className="rows about" id="about">
          <div className="group-row">
            <dt>Version</dt>
            <dd data-testid="app-version">{info.data?.version ?? '…'}</dd>
          </div>
          <div className="group-row">
            <dt>Platform</dt>
            <dd>{info.data?.platform ?? '…'}</dd>
          </div>
          <div className="group-row">
            <dt>Data folder</dt>
            <dd>
              <code>{info.data?.dataDir ?? '…'}</code>
            </dd>
          </div>
        </dl>
      </Card>
    </Page>
  )
}
