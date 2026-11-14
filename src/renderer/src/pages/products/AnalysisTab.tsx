import type { AnalysisStageName, PassportView } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { productHref } from '../../route'
import { Badge, Button, Card, ErrorNote, formatTime, Hint } from '../../ui'
import { describeSources, planStages, progressOf, type PlannedStage } from './analysis-plan'
import { ANALYSIS_LABELS, ANALYSIS_TONES, STAGE_LABELS, STAGE_STATUS_LABELS, STAGE_TONES } from './labels'

function StageRow({ planned }: { planned: PlannedStage }) {
  const { stage, needed, reason } = planned
  return (
    <div className={`list-row${needed ? '' : ' not-needed'}`} data-testid={`stage-${stage.name as AnalysisStageName}`} data-status={needed ? stage.status : 'not_needed'}>
      <div>
        <strong>{STAGE_LABELS[stage.name]}</strong>
        {!needed && <div className="hint">{reason}</div>}
        {needed && stage.detail && <div className="hint">{stage.detail}</div>}
      </div>
      <div className="row">
        {needed && stage.status !== 'pending' && stage.updatedAt && <span className="hint">{formatTime(stage.updatedAt)}</span>}
        {needed ? <Badge tone={STAGE_TONES[stage.status]}>{STAGE_STATUS_LABELS[stage.status]}</Badge> : <Badge>Not needed</Badge>}
      </div>
    </div>
  )
}

/** Runs and follows the analysis. It needs a working AI engine; the passport can always be filled in by hand instead. */
export function AnalysisTab({ view }: { view: PassportView }) {
  const { product } = view
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const engine = engines.data?.find((e) => e.id === settings.data?.engineId)
  const engineReady = engine?.ready === true
  const engineKnown = !settings.loading && !engines.loading

  const [start, starting] = useAction(() => call('analysis.start', { productId: product.id }))
  const [stop, stopping] = useAction(() => call('analysis.stop', { productId: product.id }))

  const planned = planStages(view.stages, view.sources)
  const { done, total } = progressOf(planned)
  const running = product.analysisStatus === 'running'
  const startLabel = product.analysisStatus === 'paused' || product.analysisStatus === 'failed' ? 'Resume analysis' : product.analysisStatus === 'complete' ? 'Run again' : 'Start analysis'
  const noSources = view.sources.length === 0
  // The one reason the button is off, at reading size beside it. The engine has its own note below.
  const blocked = noSources ? 'Add a source first: there is nothing to analyze.' : null

  return (
    <div className="stack" data-testid="analysis-tab">
      <Card
        title="Analysis"
        actions={
          running ? (
            <Button onClick={() => void stop()} disabled={stopping.busy} data-testid="analysis-stop">
              {stopping.busy ? 'Stopping…' : 'Stop'}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void start()} disabled={starting.busy || (engineKnown && !engineReady) || noSources} title={blocked ?? undefined} data-testid="analysis-start">
              {starting.busy ? 'Starting…' : startLabel}
            </Button>
          )
        }
      >
        <div className="stack">
          {/* One status: the badge and the step count. The same word is in the product header, which links here. */}
          <div className="row">
            <Badge tone={product.analysisStatus === 'idle' ? 'warn' : ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>
            <span className="hint" data-testid="analysis-progress">
              {done} of {total} steps finished
            </span>
          </div>
          {/* An empty bar before a run says nothing; it appears when there is something to follow. */}
          {product.analysisStatus !== 'idle' && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <div className="progress-bar" style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
            </div>
          )}
          <Hint tone="strong" data-testid="analysis-reads">
            Will read: {describeSources(view.sources)}.{' '}
            <a href={productHref(product.id, 'sources')} data-testid="analysis-sources-link">
              {noSources ? 'Add a source' : 'Sources'}
            </a>
          </Hint>
          {blocked && (
            <Hint tone="warn" data-testid="analysis-blocked">
              {blocked}
            </Hint>
          )}
          <ul className="plain-list analysis-points">
            <li>The AI reads your sources and proposes statements for the passport. Nothing is approved automatically.</li>
            <li>Stopping keeps the finished steps; resuming continues from where it stopped.</li>
            <li>Running it again after it is complete starts over and adds new proposals to a draft. The approved passport is not changed.</li>
          </ul>
          {engineKnown && !engineReady && (
            <div className="warn-note" data-testid="analysis-no-engine">
              {engine ? `${engine.label} is not ready${engine.detail ? ` (${engine.detail})` : ''}.` : 'No AI engine is selected.'} Analysis needs one. You can still fill in the passport by hand on the Passport tab, or{' '}
              <a href="#/settings">choose an engine in Settings</a>.
            </div>
          )}
          <ErrorNote error={starting.error ?? stopping.error} />
        </div>
      </Card>

      <div className="stack" data-testid="analysis-stages">
        {planned.map((p) => (
          <StageRow key={p.stage.name} planned={p} />
        ))}
      </div>
    </div>
  )
}
