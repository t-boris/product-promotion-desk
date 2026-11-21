import type { Finding, FindingPicture } from '../../../../shared/types'
import { useQuery } from '../../hooks'

/** One picture of a post: the file the application fetched, a note while it is on its way, or why the site would not give it. */
function PostPicture({ picture }: { picture: FindingPicture }) {
  const shown = useQuery('findings.picture', { id: picture.id, side: 480 }, [], { skip: picture.state !== 'ready' })
  if (picture.state === 'failed') {
    return (
      <div className="stream-picture missing muted small" data-testid="stream-picture-failed">
        A picture of the post could not be loaded: {picture.failure}
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
  return (
    <figure className="stream-picture" data-testid="stream-picture">
      <img src={shown.data.dataUrl} alt={picture.alt || 'A picture of the post'} loading="lazy" />
    </figure>
  )
}

/** The pictures the AI named for a post, fetched by the application and kept on this computer. */
export function PostPictures({ findingId }: { findingId: string }) {
  const pictures = useQuery('findings.pictures', { id: findingId }, ['opportunities'])
  const list = pictures.data ?? []
  if (list.length === 0) return null
  return (
    <div className="stream-pictures" data-testid="stream-pictures" aria-label="Pictures of the post">
      {list.map((picture) => (
        <PostPicture key={picture.id} picture={picture} />
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
