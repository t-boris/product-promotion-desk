import type { Finding, FindingPicture } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { ViewableImage } from '../../pictures/ViewableImage'
import { postPicture, type ViewerPicture } from '../../pictures/picture-viewer'
import { pictureColumns } from './stream-card'

/** The longest side, in pixels, of the copy of a picture the card shows. */
const SINGLE_SIDE = 960
const SHARED_SIDE = 640

/**
 * One picture of a post: the file the application fetched, a note while it is on its way, or why the site would not give it. A picture that is here opens large when it
 * is pressed, among the pictures of the same post (`group`, in the order of the post; `place` is this one's number in the post, from 1).
 */
function PostPicture({ picture, side, place, group }: { picture: FindingPicture; side: number; place: number; group: readonly FindingPicture[] }) {
  const shown = useQuery('findings.picture', { id: picture.id, side }, [], { skip: picture.state !== 'ready' })
  if (picture.state === 'failed') {
    return (
      <div className="stream-picture missing muted small" data-testid="stream-picture-failed">
        A picture of the post could not be loaded: {picture.failure}
      </div>
    )
  }
  if (picture.state === 'ready' && shown.data === null) {
    return (
      <div className="stream-picture missing muted small" data-testid="stream-picture-unreadable">
        A picture of the post is saved on this computer but could not be shown.
      </div>
    )
  }
  if (picture.state === 'waiting' || !shown.data) {
    return (
      <div className="stream-picture missing muted small" data-testid="stream-picture-waiting">
        Fetching a picture of the post…
      </div>
    )
  }
  const mine = postPicture(picture, place, shown.data.dataUrl)
  // The others of the post are listed without a copy on hand: the viewer asks for each large copy itself when it comes to it.
  const everyone = group.filter((other) => other.state === 'ready').map((other) => (other.id === picture.id ? mine : postPicture(other, group.indexOf(other) + 1)))
  return (
    <figure className="stream-picture" data-testid="stream-picture">
      <ViewableImage src={shown.data.dataUrl} alt={picture.alt || 'A picture of the post'} loading="lazy" picture={mine} group={everyone} index={everyone.findIndex((other: ViewerPicture) => other.key === picture.id)} />
    </figure>
  )
}

/** The pictures the AI named for a post, fetched by the application and kept on this computer. */
export function PostPictures({ findingId }: { findingId: string }) {
  const pictures = useQuery('findings.pictures', { id: findingId }, ['opportunities'])
  const list = pictures.data ?? []
  if (list.length === 0) return null
  const columns = pictureColumns(list.length)
  // One picture is as wide as the card, so it is fetched larger; two or more share two columns.
  const side = columns === 1 ? SINGLE_SIDE : SHARED_SIDE
  return (
    <div className="stream-pictures" data-testid="stream-pictures" data-columns={columns} aria-label="Pictures of the post">
      {list.map((picture, at) => (
        <PostPicture key={picture.id} picture={picture} side={side} place={at + 1} group={list} />
      ))}
    </div>
  )
}

/**
 * What the AI wrote after it read the thread: what people say as a whole, and the topics the thread raises, each with an idea for the owner's own post. The AI's
 * words about strangers' posts, shown as plain text; nothing here is sent or posted.
 */
export function ThreadInsights({ finding }: { finding: Pick<Finding, 'analysis' | 'topics'> }) {
  const analysis = finding.analysis.trim()
  if (analysis === '' && finding.topics.length === 0) return null
  return (
    <div className="stream-insights" data-testid="stream-insights">
      {analysis !== '' && (
        <section className="stream-analysis" data-testid="stream-analysis" aria-label="What the thread says">
          <h4 className="stream-section-title">What the thread says</h4>
          <p>{analysis}</p>
        </section>
      )}
      {finding.topics.length > 0 && (
        <section className="stream-topics" data-testid="stream-topics" aria-label="Topics the thread raises">
          <h4 className="stream-section-title">Topics it raises</h4>
          <ul>
            {finding.topics.map((topic, index) => (
              <li key={`${index}-${topic.topic}`} data-testid="stream-topic">
                <strong>{topic.topic}</strong>
                {topic.idea.trim() !== '' && <span className="stream-topic-idea muted small"> Idea for your post: {topic.idea}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
