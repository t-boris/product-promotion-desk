import type { AnalysisStage, AnalysisStageName, PassportView } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { ANALYSIS_LABELS, ANALYSIS_TONES, STAGE_LABELS, STAGE_STATUS_LABELS, STAGE_TONES } from './labels'

const ORDER: AnalysisStageName[] = ['read_site', 'analyze_documents', 'scan_code', 'synthesize', 'find_contradictions']

function StageRow({ stage }: { stage: AnalysisStage }) {
  return (
    <div className="list-row" data-testid={`stage-${stage.name}`} data-status={stage.status}>
      <div>
        <strong>{STAGE_LABELS[stage.name]}</strong>
        {stage.detail && <div className="muted small">{stage.detail}</div>}
      </div>
      <div className="row">
        {stage.status !== 'pending' && stage.updatedAt && <span className="muted small">{formatTime(stage.updatedAt)}</span>}
        <Badge tone={STAGE_TONES[stage.status]}>{STAGE_STATUS_LABELS[stage.status]}</Badge>
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

  const stages = ORDER.map((name) => view.stages.find((s) => s.name === name)).filter((s): s is AnalysisStage => s !== undefined)
  const done = stages.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const running = product.analysisStatus === 'running'
  const startLabel = product.analysisStatus === 'paused' || product.analysisStatus === 'failed' ? 'Resume analysis' : product.analysisStatus === 'complete' ? 'Run again' : 'Start analysis'

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
            <Button variant="primary" onClick={() => void start()} disabled={starting.busy || (engineKnown && !engineReady)} data-testid="analysis-start">
              {starting.busy ? 'Starting…' : startLabel}
            </Button>
          )
        }
      >
        <div className="row">
          <Badge tone={ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>
          <span className="muted small" data-testid="analysis-progress">
            {done} of {ORDER.length} steps finished
          </span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={ORDER.length} aria-valuenow={done}>
          <div className="progress-bar" style={{ width: `${(done / ORDER.length) * 100}%` }} />
        </div>
        <p className="muted small">
          The AI reads your sources and proposes statements for the passport. Nothing is approved automatically. Stopping keeps the finished steps; resuming continues from where it stopped. Running it again after it is complete starts over and adds new proposals to a draft; the approved passport is not changed.
        </p>
        {engineKnown && !engineReady && (
          <div className="warn-note" data-testid="analysis-no-engine">
            {engine
              ? `${engine.label} is not ready${engine.detail ? ` (${engine.detail})` : ''}.`
              : 'No AI engine is selected.'}{' '}
            Analysis needs one. You can still fill in the passport by hand on the Passport tab, or <a href="#/settings">choose an engine in Settings</a>.
          </div>
        )}
        <ErrorNote error={starting.error ?? stopping.error} />
      </Card>

      <div className="stack" data-testid="analysis-stages">
        {stages.map((stage) => (
          <StageRow key={stage.name} stage={stage} />
        ))}
      </div>
    </div>
  )
}
