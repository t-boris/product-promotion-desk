import type { FeedPeriod, Id, TagStat } from '../../../../shared/types'
import { Sparkline } from '../../charts/Sparkline'
import { AiProgressPanel } from '../../AiProgress'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote } from '../../ui'
import { barPercent, themeNumbers } from './analysis-card'
import { dailyDescription, dailyValues, tagsBasis, tagsIntro, untaggedLine } from './tags-card'

/** How many tags are listed before "Show all": the card sits above the stream and must not push it off the screen. */
const TAGS_SHOWN = 8

const localOffsetMinutes = (): number => -new Date().getTimezoneOffset()

export function TagRow({ tag, rank, widest, compared, picked, onTag }: { tag: TagStat; rank: number; widest: number; compared: boolean; picked: boolean; onTag: (name: string) => void }) {
  return (
    <li className="feed-theme feed-tag" data-testid="feed-tag" data-tag={tag.name}>
      <div className="feed-theme-head">
        <span className="feed-theme-rank" aria-hidden="true">
          {rank}
        </span>
        <span className="feed-theme-main">
          <span className="feed-theme-line">
            <button type="button" className={`tag-chip${picked ? ' on' : ''}`} aria-pressed={picked} onClick={() => onTag(tag.name)} title="Show only the posts with this tag" data-testid="feed-tag-pick">
              {tag.name}
            </button>
            <span className="feed-theme-numbers" data-testid="feed-tag-numbers">
              {themeNumbers(tag, compared)}
            </span>
          </span>
          <span className="feed-theme-bar" aria-hidden="true">
            <span style={{ width: `${barPercent(tag.posts, widest)}%` }} />
          </span>
        </span>
        <span className="feed-tag-spark" title={dailyDescription(tag)} data-testid="feed-tag-spark">
          <Sparkline values={dailyValues(tag)} label={`${tag.name}, posts per day`} width={112} height={28} />
        </span>
      </div>
    </li>
  )
}

/**
 * The tags of the posts the Feed holds, for a period: the AI names them (a few short names for each post, reusing the names already in use), and the application
 * counts everything else: how many posts carry each tag and how that compares with the period before, the comments and the score the sites showed for those posts,
 * and the posts of each of the last thirty days as a small picture. A tag is a button: it narrows the stream below to the posts that carry it. The AI uses no
 * browser for this and nothing is sent or posted.
 */
export function TagsPanel({
  productId,
  channelId,
  days,
  all,
  setAll,
  picked,
  onTag
}: {
  productId: Id
  channelId: Id | null
  days: FeedPeriod
  all: boolean
  setAll: (all: boolean) => void
  picked: readonly string[]
  onTag: (name: string) => void
}) {
  const view = useQuery('tags.view', { productId, channelId, days, offsetMinutes: localOffsetMinutes() }, ['opportunities'])
  const [tag, tagging] = useAction(async () => {
    const made = await call('findings.tag', { productId })
    view.reload()
    return made
  })
  const data = view.data ?? null
  const shown = data === null ? [] : all ? data.tags : data.tags.slice(0, TAGS_SHOWN)
  const widest = Math.max(0, ...(data?.tags ?? []).map((t) => t.posts))
  const untagged = data === null ? null : untaggedLine(data)
  return (
    <div className="feed-tags" data-testid="feed-tags">
      {data !== null && (
        <p className="muted small" data-testid="feed-tags-basis">
          {tagsBasis(data)}
        </p>
      )}
      {data !== null && data.tags.length === 0 && (
        <p className="muted small" data-testid="feed-tags-empty">
          {tagsIntro(days)}
        </p>
      )}
      {data !== null && data.tags.length > 0 && (
        <ol className="feed-themes" data-testid="feed-tag-list">
          {shown.map((t, index) => (
            <TagRow key={t.id} tag={t} rank={index + 1} widest={widest} compared={data.compared} picked={picked.includes(t.name)} onTag={onTag} />
          ))}
        </ol>
      )}
      {data !== null && data.tags.length > TAGS_SHOWN && (
        <Button variant="secondary" onClick={() => setAll(!all)} data-testid="feed-tags-more">
          {all ? 'Show fewer tags' : `Show all ${data.tags.length} tags`}
        </Button>
      )}
      <div className="feed-tags-foot">
        {untagged !== null && (
          <span className="muted small" data-testid="feed-tags-untagged">
            {untagged}
          </span>
        )}
        <Button variant={data !== null && data.tags.length === 0 ? 'primary' : 'secondary'} onClick={() => void tag()} disabled={tagging.busy} data-testid="feed-tags-run">
          {tagging.busy ? 'Tagging…' : 'Tag the posts'}
        </Button>
      </div>
      {tagging.busy && <AiProgressPanel subject={productId} />}
      <ErrorNote error={tagging.error ?? view.error} />
      <p className="muted small">The AI names the tags and puts them on the posts. Posts, comments and scores are counted by the application from what the sites show; Instagram and Threads show none.</p>
    </div>
  )
}
