import { useState } from 'react'
import type { FeedAnalysisView, FeedPeriod, FeedTheme, Id } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, Hint, SegmentedControl, formatTime } from '../../ui'
import { PERIOD_OPTIONS, barPercent, basisLine, introWords, themeBadges, themeNumbers } from './analysis-card'
import { TagsPanel } from './TagsPanel'

/** What the stream is narrowed to: the posts of a theme, or the one post of a question. */
export interface FeedFocus {
  label: string
  ids: ReadonlySet<Id>
}

/** How many themes are listed before "Show all": the card sits above the stream and must not push it off the screen. */
const THEMES_SHOWN = 4

function Theme({ theme, rank, widest, compared, onShow }: { theme: FeedTheme; rank: number; widest: number; compared: boolean; onShow: (theme: FeedTheme) => void }) {
  const badges = themeBadges(theme)
  return (
    <li className="feed-theme" data-testid="feed-theme" data-theme-id={theme.id}>
      <details>
        <summary className="feed-theme-head">
          <span className="feed-theme-rank" aria-hidden="true">
            {rank}
          </span>
          <span className="feed-theme-main">
            <span className="feed-theme-line">
              <span className="feed-theme-name">{theme.name}</span>
              {badges.map((badge) => (
                <span key={badge.label} className={`badge badge-${badge.tone}`} data-testid="feed-theme-badge">
                  {badge.label}
                </span>
              ))}
              <span className="feed-theme-numbers" data-testid="feed-theme-numbers">
                {themeNumbers(theme, compared)}
              </span>
            </span>
            <span className="feed-theme-bar" aria-hidden="true">
              <span style={{ width: `${barPercent(theme.posts, widest)}%` }} />
            </span>
          </span>
        </summary>
        <div className="feed-theme-body">
          {theme.summary !== '' && <p className="feed-theme-summary">{theme.summary}</p>}
          {theme.idea !== '' && (
            <p className="feed-theme-idea muted small" data-testid="feed-theme-idea">
              Idea for your post: {theme.idea}
            </p>
          )}
          <Button variant="secondary" onClick={() => onShow(theme)} disabled={theme.postIds.length === 0} data-testid="feed-theme-show">
            Show these posts ({theme.postIds.length})
          </Button>
        </div>
      </details>
    </li>
  )
}

/** What an analysis says: when it was made and from what, the AI's summary, the themes with their numbers, the questions nobody answered. */
export function AnalysisBody({
  view,
  stale,
  all,
  setAll,
  onFocus
}: {
  view: FeedAnalysisView
  /** Posts came since it was made (and no new analysis is on its way). */
  stale: boolean
  all: boolean
  setAll: (all: boolean) => void
  onFocus: (focus: FeedFocus | null) => void
}) {
  const themes = all ? view.themes : view.themes.slice(0, THEMES_SHOWN)
  const widest = Math.max(0, ...view.themes.map((t) => t.posts))
  return (
    <>
      <p className="muted small" data-testid="feed-analysis-basis">
        Made {formatTime(view.at)} · {basisLine(view)}
      </p>
      {stale && (
        <Hint tone="warn" data-testid="feed-analysis-stale">
          Posts were noted or read since this was made. Press Analyze again to include them.
        </Hint>
      )}
      {view.summary !== '' && (
        <p className="feed-analysis-summary" data-testid="feed-analysis-summary">
          {view.summary}
        </p>
      )}
      <ol className="feed-themes" data-testid="feed-themes">
        {themes.map((theme, index) => (
          <Theme key={theme.id} theme={theme} rank={index + 1} widest={widest} compared={view.compared} onShow={(t) => onFocus({ label: t.name, ids: new Set(t.postIds) })} />
        ))}
      </ol>
      {view.themes.length > THEMES_SHOWN && (
        <Button variant="secondary" onClick={() => setAll(!all)} data-testid="feed-themes-more">
          {all ? 'Show fewer themes' : `Show all ${view.themes.length} themes`}
        </Button>
      )}
      {view.questions.length > 0 && (
        <details className="feed-questions" data-testid="feed-questions">
          <summary>Questions nobody answered ({view.questions.length})</summary>
          <ul>
            {view.questions.map((q) => (
              <li key={q.postId} data-testid="feed-question">
                <span>{q.question}</span>
                <span className="muted small">
                  {' '}
                  {q.channel} · {q.title}
                </span>{' '}
                <Button variant="secondary" onClick={() => onFocus({ label: q.question, ids: new Set([q.postId]) })} data-testid="feed-question-show">
                  Show the post
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">The AI names the themes and puts the posts in them. Posts, comments and scores are counted by the application from what the sites show; Instagram and Threads show none.</p>
    </>
  )
}

type AnalysisTab = 'themes' | 'tags'

/**
 * "What is going on in your channels": the AI's reading of the posts the Feed holds for a period: the themes they raise, with how many posts, comments and score
 * each has (counted by the application, not by the AI), what grows, and the questions nobody answered. Opening a theme narrows the stream below to its posts.
 * The other tab, Tags, lists the short tags the AI gave the posts, counted the same way, each a way to narrow the stream to its posts.
 * Nothing here posts or sends anything, and the AI uses no browser for it.
 */
export function FeedAnalysisCard({
  productId,
  channelId,
  onFocus,
  pickedTags,
  onTag
}: {
  productId: Id
  channelId: Id | null
  onFocus: (focus: FeedFocus | null) => void
  /** The tags the stream is narrowed to, and what pressing a tag here does. */
  pickedTags: readonly string[]
  onTag: (name: string) => void
}) {
  const [days, setDays] = useState<FeedPeriod>(7)
  const [all, setAll] = useState(false)
  const [tab, setTab] = useState<AnalysisTab>('themes')
  const analysis = useQuery('feed.analysis', { productId, channelId, days }, ['opportunities'])
  const [analyze, running] = useAction(async () => {
    const made = await call('feed.analyze', { productId, channelId, days })
    analysis.reload()
    return made
  })
  const view = analysis.data ?? null
  return (
    <section className="feed-analysis" data-testid="feed-analysis" aria-label="What is going on in your channels">
      <header className="feed-analysis-head">
        <div className="feed-analysis-heading">
          <span className="feed-analysis-eyebrow" data-testid="feed-analysis-eyebrow">
            Analysis of the feed
          </span>
          <h3 className="feed-analysis-title">{channelId === null ? 'What is going on in your channels' : 'What is going on in this channel'}</h3>
        </div>
        <SegmentedControl<AnalysisTab>
          label="What to show"
          name="feed-analysis-tab"
          testIdPrefix="feed-analysis-tab-"
          options={[
            { value: 'themes', label: 'Themes' },
            { value: 'tags', label: 'Tags' }
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value)
            setAll(false)
          }}
        />
        <SegmentedControl
          label="Period"
          name="feed-analysis-period"
          testIdPrefix="feed-analysis-period"
          options={PERIOD_OPTIONS.map((p) => ({ value: String(p.value), label: p.label }))}
          value={String(days)}
          onChange={(value) => {
            setDays(Number(value) as FeedPeriod)
            setAll(false)
            onFocus(null)
          }}
        />
        {tab === 'themes' && (
          <Button variant={view === null ? 'primary' : 'secondary'} onClick={() => void analyze()} disabled={running.busy} data-testid="feed-analysis-run">
            {running.busy ? 'Analyzing…' : view === null ? 'Analyze the feed' : 'Analyze again'}
          </Button>
        )}
      </header>

      {tab === 'themes' && (
        <>
          {running.busy && <AiProgressPanel subject={productId} />}
          <ErrorNote error={running.error} />

          {view === null && !running.busy && (
            <p className="muted small" data-testid="feed-analysis-empty">
              {introWords(days)}
            </p>
          )}

          {view !== null && <AnalysisBody view={view} stale={view.stale && !running.busy} all={all} setAll={setAll} onFocus={onFocus} />}
        </>
      )}

      {tab === 'tags' && <TagsPanel productId={productId} channelId={channelId} days={days} all={all} setAll={setAll} picked={pickedTags} onTag={onTag} />}
    </section>
  )
}
