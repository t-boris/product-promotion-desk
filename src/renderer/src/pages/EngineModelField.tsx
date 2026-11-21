import { useState } from 'react'
import { MODEL_NAME_MAX } from '../../../shared/engine-model'
import type { EngineId } from '../../../shared/types'
import { call, useAction } from '../hooks'
import { Button, ErrorNote } from '../ui'
import { modelFieldView } from './engine-detail'

/**
 * The model an engine is asked for. Empty means the engine's own default (what it used before this field existed). A name is tried with one short
 * question before it is kept, so a name the engine does not know is refused here with the engine's own words, not found out by a mission that fails.
 */
export function EngineModelField({ engine, label, saved, installed }: { engine: EngineId; label: string; saved: string; installed: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [save, state] = useAction(async (model: string) => {
    await call('engines.setModel', { id: engine, model })
    setDraft(null)
  })
  const view = modelFieldView(saved, draft)

  return (
    <div className="engine-model" data-testid={`engine-model-${engine}`}>
      <label className="engine-model-row">
        <span className="field-label">Model</span>
        <input
          className="input"
          value={view.value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && view.changed && !state.busy) void save(view.name)
          }}
          maxLength={MODEL_NAME_MAX}
          placeholder="Empty: the engine's own default"
          aria-label={`Model for ${label}`}
          disabled={!installed || state.busy}
          spellCheck={false}
          data-testid={`engine-model-input-${engine}`}
        />
        <Button variant="secondary" onClick={() => void save(view.name)} disabled={!installed || !view.changed || state.busy} data-testid={`engine-model-save-${engine}`}>
          {state.busy ? 'Trying…' : view.name ? 'Try and use' : 'Use the default'}
        </Button>
      </label>
      <span className="hint" data-testid={`engine-model-in-use-${engine}`}>
        {view.inUse}
      </span>
      <ErrorNote error={state.error} />
    </div>
  )
}
