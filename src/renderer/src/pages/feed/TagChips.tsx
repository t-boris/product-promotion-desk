import type { FindingTag } from '../../../../shared/types'

/**
 * The tags the AI gave a post (short names of what it is about): each is a button that narrows the stream to the posts that carry it; a tag the owner already
 * picked is pressed, and pressing it again takes it off. They come from the AI's naming and are shown as plain text.
 */
export function TagChips({ tags, picked, onTag }: { tags: readonly FindingTag[]; picked: readonly string[]; onTag: (name: string) => void }) {
  if (tags.length === 0) return null
  return (
    <ul className="tag-chips" aria-label="Tags of the post" data-testid="stream-tags">
      {tags.map((tag) => (
        <li key={tag.id}>
          <button type="button" className={`tag-chip${picked.includes(tag.name) ? ' on' : ''}`} aria-pressed={picked.includes(tag.name)} onClick={() => onTag(tag.name)} data-testid="stream-tag" data-tag={tag.name}>
            {tag.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
