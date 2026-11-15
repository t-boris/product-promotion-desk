import { createContext, useContext, type ReactNode } from 'react'
import type { Id } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import type { ProductTab } from '../../route'
import { useMainVariant } from '../../ui'
import { APPROVED_PUBLICATION_STATES, DRAFT_PUBLICATION_STATES, launchCounts, launchProgress, tabAccent, type LaunchCounts, type LaunchStage, type TabAccent } from './launch-path'

// Only the publications that count: the list is capped (300, newest first), and cancelled drafts must not push a sent one out of it.
const COUNTED_STATES = [...APPROVED_PUBLICATION_STATES, ...DRAFT_PUBLICATION_STATES]

const STATE_WORD: Record<LaunchStage['state'], string> = { done: 'done', current: 'next', todo: 'not yet' }

/**
 * The channel and approved-publication counts of every product, from the same lists the Channels and Posts screens load. Until both lists have
 * answered (or failed) every count is zero and `loaded` is false: a screen that names the next stage waits for it, or a launched product
 * would be told to connect a channel for a moment.
 */
export function useLaunchCounts(): { countsOf: (productId: Id) => LaunchCounts; loaded: boolean } {
  const channels = useQuery('channels.list', undefined, ['channels', 'products'])
  const publications = useQuery('opportunities.list', { kind: 'standalone', states: COUNTED_STATES }, ['opportunities'])
  const counts = launchCounts(channels.data ?? [], publications.data ?? [])
  const answered = (query: { data: unknown; error: string | null }): boolean => query.data !== undefined || query.error !== null
  return {
    countsOf: (productId) => counts.get(productId) ?? { channels: 0, approvedPublications: 0, draftPublications: 0 },
    loaded: answered(channels) && answered(publications)
  }
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

/**
 * The stages of the open product, for the tabs below its path: each one asks who owns the filled button (`tabAccent`). Outside the scope a
 * tab owns its own main action, as it did before the path steered the accent.
 */
const StagesContext = createContext<LaunchStage[] | null>(null)
const OWN_ACCENT: TabAccent = { own: true, next: null }

export function LaunchStagesScope({ stages, children }: { stages: LaunchStage[]; children: ReactNode }) {
  return <StagesContext.Provider value={stages}>{children}</StagesContext.Provider>
}

export function useTabAccent(tab: ProductTab): TabAccent {
  const stages = useContext(StagesContext)
  return stages ? tabAccent(stages, tab) : OWN_ACCENT
}

/** The variant of a tab's resting main action: filled while the tab holds the path's current stage and no on-demand form is open, a bezel otherwise. */
export function useTabMainVariant(tab: ProductTab): 'primary' | 'ghost' {
  const main = useMainVariant()
  return useTabAccent(tab).own ? main : 'ghost'
}

/**
 * The filled button of a tab that does not hold the path's current stage: a link to that stage, in the words of its action (BUG-065). It
 * takes the variant of a resting main action, so it steps back to a bezel while an on-demand form is open, and it is not drawn when the
 * tab owns the accent or the path is complete. While the passport is the next stage the words beside the button name the route that needs
 * no AI, in the open and not only in a tooltip (BUG-064); the Status row of the product header cannot hold them, they wrap that row at 980 px.
 */
export function NextStage({ tab }: { tab: ProductTab }) {
  const { next } = useTabAccent(tab)
  const variant = useMainVariant()
  if (!next) return null
  return (
    <div className="next-stage" data-testid="next-stage">
      <a className={`btn btn-${variant}`} href={next.href} data-testid="next-stage-link">
        {next.action}
      </a>
      {next.id === 'passport' ? (
        <a href={next.href} data-testid="open-passport-by-hand">
          or add statements yourself
        </a>
      ) : (
        <span className="hint">Next on the launch path: {next.label}</span>
      )}
    </div>
  )
}
