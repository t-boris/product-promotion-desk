import { useState } from 'react'
import type { EngineId } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Hint, Loading, More, Page, Switch } from '../ui'
import { engineChoiceVariant, recommendedEngineId, splitEngineDetail } from './engine-detail'
import { LessonsCard } from './LessonsCard'

export function SettingsPage() {
  const engines = useQuery('engines.list', undefined, ['settings'])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const info = useQuery('app.info', undefined, ['settings'])
  const [port, setPort] = useState<string>('')

  const [selectEngine, selecting] = useAction((id: EngineId) => call('engines.select', { id }))
  const [recheck, rechecking] = useAction(async () => {
    engines.reload()
  })
  const [update, updating] = useAction((patch: Parameters<typeof call<'app.settings.update'>>[1]) => call('app.settings.update', patch))

  const current = settings.data
  const recommendedId = recommendedEngineId(engines.data ?? [])
  const anySelected = engines.data?.some((engine) => engine.id === current?.engineId) ?? false
  const portValue = port || String(current?.webMode.port ?? 47615)

  return (
    <Page title="Settings" subtitle="AI engine, notifications, local web access and version">
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
        <div className="stack">
          {engines.data?.map((engine) => {
            const selected = current?.engineId === engine.id
            const detail = splitEngineDetail(engine.detail)
            const recommended = engine.id === recommendedId
            return (
              <div key={engine.id} className="list-row engine-row" data-testid={`engine-${engine.id}`}>
                <div className="engine-main">
                  <div className="row">
                    <strong>{engine.label}</strong>
                    {selected && <Badge tone="info">Selected</Badge>}
                    {recommended && !selected && <Badge tone="info">Recommended</Badge>}
                    {engine.installed ? <Badge tone={engine.ready ? 'good' : 'warn'}>{engine.ready ? 'Ready' : 'Installed'}</Badge> : <Badge>Not installed</Badge>}
                  </div>
                  {!engine.installed && <div className="hint">Install {engine.label} on this Mac, then press Re-check.</div>}
                  {engine.version && <div className="hint">Version {engine.version}</div>}
                  {engine.path && <div className="mono engine-path">{engine.path}</div>}
                  {detail.summary && <div className="hint">{detail.summary}</div>}
                  {detail.writing && <div className={`hint${detail.limits ? ' warn' : ''}`}>{detail.writing}</div>}
                  {detail.missions && <div className="hint">{detail.missions}</div>}
                </div>
                {selected ? (
                  <span className="in-use" data-testid={`engine-in-use-${engine.id}`}>
                    <span aria-hidden="true">✓</span> In use
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
        <Switch
          checked={current?.notifications ?? true}
          disabled={!current || updating.busy}
          onChange={(next) => void update({ notifications: next })}
          label="Show macOS notifications for items that need you"
          testId="notifications-switch"
        />
      </Card>

      <Card title="Local web access">
        <Hint>Serves this interface on 127.0.0.1 so it can be opened in a browser tab on this Mac, for example to check the app.</Hint>
        <More label="How it is protected">
          <Hint>It needs the secret link below, is reachable only from this computer, and cannot send anything without the same approvals the app always requires. Off by default.</Hint>
        </More>
        <ErrorNote error={updating.error} />
        <Switch
          checked={current?.webMode.enabled ?? false}
          disabled={!current || updating.busy}
          onChange={(next) => void update({ webMode: { enabled: next, port: Number(portValue) || 47615 } })}
          label="Enable local web access"
          testId="web-switch"
        />
        <Field label="Port">
          <input className="input" value={portValue} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
        </Field>
        {info.data?.webMode.enabled && info.data.webMode.url && (
          <p>
            Open this link on this Mac: <code data-testid="web-url">{info.data.webMode.url}</code>
          </p>
        )}
      </Card>

      <Card title="About">
        <dl className="kv" id="about">
          <dt>Version</dt>
          <dd data-testid="app-version">{info.data?.version ?? '…'}</dd>
          <dt>Platform</dt>
          <dd>{info.data?.platform ?? '…'}</dd>
          <dt>Data folder</dt>
          <dd>
            <code>{info.data?.dataDir ?? '…'}</code>
          </dd>
        </dl>
      </Card>
    </Page>
  )
}
