import type { Id } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { launchCounts, launchProgress, type LaunchCounts, type LaunchStage } from './launch-path'

const STATE_WORD: Record<LaunchStage['state'], string> = { done: 'done', current: 'next', todo: 'not yet' }

/** The channel and approved-publication counts of every product, from the same lists Channels and Publications load. */
export function useLaunchCounts(): (productId: Id) => LaunchCounts {
  const channels = useQuery('channels.list', undefined, ['channels', 'products'])
  const publications = useQuery('opportunities.list', { kind: 'standalone' }, ['opportunities'])
  const counts = launchCounts(channels.data ?? [], publications.data ?? [])
  return (productId) => counts.get(productId) ?? { channels: 0, approvedPublications: 0 }
}

/** The launch path under the product header (BUG-012): each stage links to the place where it is worked on. */
export function LaunchPath({ stages, testId = 'launch-path' }: { stages: LaunchStage[]; testId?: string }) {
  return (
    <nav className="launch-path" aria-label={`Launch path, ${launchProgress(stages)}`} data-testid={testId}>
      <ol>
        {stages.map((stage) => (
          <li key={stage.id} className={`launch-stage ${stage.state}`} data-testid={`launch-stage-${stage.id}`} data-state={stage.state}>
            <a href={stage.href} title={stage.state === 'done' ? `${stage.label}: done` : stage.todo} aria-current={stage.state === 'current' ? 'step' : undefined}>
              <span className="launch-mark" aria-hidden="true" />
              <span className="launch-label">{stage.label}</span>
              {stage.state === 'current' && <span className="launch-next">Next</span>}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** The same path as five small dots, on a product card in the list. */
export function LaunchDots({ stages, testId }: { stages: LaunchStage[]; testId?: string }) {
  return (
    <span className="launch-dots" role="img" aria-label={`Launch path, ${launchProgress(stages)}`} title={stages.map((s) => `${s.label}: ${STATE_WORD[s.state]}`).join(' · ')} data-testid={testId}>
      {stages.map((stage) => (
        <span key={stage.id} className={`launch-dot ${stage.state}`} />
      ))}
    </span>
  )
}
