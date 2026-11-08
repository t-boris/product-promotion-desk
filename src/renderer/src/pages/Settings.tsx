import { useState } from 'react'
import type { EngineId } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Loading, Page } from '../ui'
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
        <p className="muted">
          Promotion data lives in this application, not in the engine. You can switch engines at any time; products, claims and history stay as they are. Without an engine you can still enter product data by hand.
        </p>
        <ErrorNote error={engines.error ?? selecting.error} />
        {engines.loading && !engines.data && <Loading what="Checking installed engines" />}
        {engines.data && engines.data.length === 0 && <EmptyState title="No AI engines found">Install Codex or Claude Code to enable analysis and drafting.</EmptyState>}
        <div className="stack">
          {engines.data?.map((engine) => {
            const selected = current?.engineId === engine.id
            return (
              <div key={engine.id} className="list-row" data-testid={`engine-${engine.id}`}>
                <div>
                  <strong>{engine.label}</strong>{' '}
                  {selected && <Badge tone="info">Selected</Badge>}{' '}
                  {engine.installed ? <Badge tone={engine.ready ? 'good' : 'warn'}>{engine.ready ? 'Ready' : 'Installed'}</Badge> : <Badge tone="bad">Not installed</Badge>}
                  <div className="muted small">
                    {engine.version ? `Version ${engine.version}` : ''} {engine.path ?? ''} {engine.detail}
                  </div>
                </div>
                <Button variant={selected ? 'ghost' : 'primary'} disabled={!engine.installed || selected || selecting.busy} onClick={() => void selectEngine(engine.id)}>
                  Use this engine
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      <LessonsCard />

      <Card title="Notifications">
        <label className="check">
          <input type="checkbox" checked={current?.notifications ?? true} disabled={!current || updating.busy} onChange={(e) => void update({ notifications: e.target.checked })} />
          Show macOS notifications for items that need you
        </label>
      </Card>

      <Card title="Local web access">
        <p className="muted">
          Serves this interface on 127.0.0.1 so it can be opened in a browser tab on this Mac, for example to check the app. It needs the secret link below, is reachable only from this computer, and cannot send anything without the same approvals the app always requires. Off by default.
        </p>
        <ErrorNote error={updating.error} />
        <label className="check">
          <input
            type="checkbox"
            checked={current?.webMode.enabled ?? false}
            disabled={!current || updating.busy}
            onChange={(e) => void update({ webMode: { enabled: e.target.checked, port: Number(portValue) || 47615 } })}
          />
          Enable local web access
        </label>
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
