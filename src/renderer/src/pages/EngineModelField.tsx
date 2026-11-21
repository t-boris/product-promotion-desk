import type { EngineId } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Button, ErrorNote } from '../ui'
import { modelNote, modelOptions } from './engine-detail'

/**
 * The model an engine is asked for, chosen from the list the engine itself gives (what it offers this account). The first choice is the engine's own
 * default. Nothing is typed: a name the engine does not list cannot be kept.
 */
export function EngineModelField({ engine, label, saved, installed }: { engine: EngineId; label: string; saved: string; installed: boolean }) {
  const models = useQuery('engines.models', { id: engine }, [], { skip: !installed })
  const [choose, state] = useAction((model: string) => call('engines.setModel', { id: engine, model }))
  const offered = models.data ?? []
  const options = modelOptions(offered, saved)
  const note = models.data ? modelNote(offered, saved) : ''

  return (
    <div className="engine-model" data-testid={`engine-model-${engine}`}>
      <label className="engine-model-row">
        <span className="field-label">Model</span>
        <select
          className="input"
          value={saved}
          onChange={(e) => void choose(e.target.value)}
          disabled={!installed || state.busy || (models.loading && !models.data)}
          aria-label={`Model for ${label}`}
          data-testid={`engine-model-select-${engine}`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {models.loading && !models.data && installed && <span className="hint">Reading the models {label} offers…</span>}
      {note && (
        <span className="hint" data-testid={`engine-model-note-${engine}`}>
          {note}
        </span>
      )}
      {models.error && (
        <span className="hint warn" data-testid={`engine-model-error-${engine}`}>
          {label} did not give its list of models: {models.error}{' '}
          <Button variant="quiet" onClick={() => models.reload()}>
            Try again
          </Button>
        </span>
      )}
      <ErrorNote error={state.error} />
    </div>
  )
}
