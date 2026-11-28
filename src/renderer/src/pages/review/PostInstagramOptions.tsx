import { useId, useState } from 'react'
import {
  ALT_TEXT_MAX,
  STORY_HINT,
  USER_TAGS_MAX,
  altTextProblem,
  cleanInstagramHandle,
  parseInstagramUserTags,
  storyProblem,
  type InstagramPostForm,
  type InstagramUserTag
} from '../../../../shared/instagram-media'
import { kindsOf } from '../../../../shared/post-format'
import type { Attachment } from '../../../../shared/types'
import { Badge, Button, Field, Hint, SegmentedControl } from '../../ui'

type FormChoice = 'feed' | InstagramPostForm

/**
 * Instagram API publishing options (DEC-097): choose Feed post vs 24-hour Story when there is one attachment,
 * and on picture feed posts optionally set custom `alt_text` and tag people (`user_tags`). Every choice is
 * bound into the approval hash so what is approved is exactly what Instagram receives.
 */
export function PostInstagramOptions({
  attachments,
  postForm,
  altText,
  userTags,
  onChange,
  disabled
}: {
  attachments: readonly Attachment[]
  postForm: InstagramPostForm | null
  altText: string
  userTags: InstagramUserTag[]
  onChange: (patch: Partial<{ postForm: InstagramPostForm | null; altText: string; userTags: InstagramUserTag[] }>) => void
  disabled: boolean
}) {
  const id = useId()
  const [handle, setHandle] = useState('')
  const [xPct, setXPct] = useState('50')
  const [yPct, setYPct] = useState('50')
  const [tagError, setTagError] = useState<string | null>(null)

  const canStory = storyProblem(attachments) === null
  const { pictures } = kindsOf(attachments)
  const isStory = postForm === 'story' && canStory

  if (!canStory && pictures === 0) return null

  const altError = !isStory ? altTextProblem(altText) : null

  const addTag = (): void => {
    const cleaned = cleanInstagramHandle(handle)
    if (!cleaned) {
      setTagError('Enter an Instagram username to tag.')
      return
    }
    const xNum = Number(xPct === '' ? '50' : xPct)
    const yNum = Number(yPct === '' ? '50' : yPct)
    if (!Number.isFinite(xNum) || xNum < 0 || xNum > 100 || !Number.isFinite(yNum) || yNum < 0 || yNum > 100) {
      setTagError('Position X and Y must be between 0 and 100%.')
      return
    }
    const parsed = parseInstagramUserTags([...userTags, { username: cleaned, x: xNum / 100, y: yNum / 100 }])
    if (parsed.error) {
      setTagError(parsed.error)
      return
    }
    setTagError(null)
    setHandle('')
    onChange({ userTags: parsed.tags })
  }

  return (
    <div className="rows" data-testid="draft-instagram-options">
      {canStory && (
        <div className="field" data-testid="draft-instagram-form">
          <span className="field-label">Publish on Instagram as</span>
          <SegmentedControl<FormChoice>
            label="Publish on Instagram as"
            name={`ig-form-${id}`}
            options={[
              { value: 'feed', label: 'Feed post' },
              { value: 'story', label: 'Story' }
            ]}
            value={isStory ? 'story' : 'feed'}
            onChange={(next) => {
              setTagError(null)
              onChange({ postForm: next === 'story' ? 'story' : null })
            }}
            disabled={disabled}
            testIdPrefix="draft-ig-form-"
            describedBy={isStory ? `${id}-story-hint` : undefined}
          />
          {isStory && <Hint id={`${id}-story-hint`}>{STORY_HINT}</Hint>}
        </div>
      )}

      {!isStory && pictures > 0 && (
        <>
          <Field
            label="Alt text (optional)"
            hint={altError ?? `Custom accessibility description sent to Instagram (${[...altText.trim()].length}/${ALT_TEXT_MAX}).`}
          >
            <input
              className="input"
              value={altText}
              disabled={disabled}
              maxLength={ALT_TEXT_MAX}
              onChange={(e) => onChange({ altText: e.target.value })}
              placeholder="Describe what the picture shows"
              data-testid="draft-ig-alt-text"
            />
          </Field>

          <Field
            label="Tag people on picture (optional)"
            hint={tagError ?? `Tag up to ${USER_TAGS_MAX} public Instagram accounts with optional X/Y position (0–100%).`}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: '1 1 180px', minWidth: 140 }}
                value={handle}
                disabled={disabled || userTags.length >= USER_TAGS_MAX}
                onChange={(e) => {
                  setHandle(e.target.value)
                  if (tagError) setTagError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="@username"
                aria-label="Instagram username to tag"
                data-testid="draft-ig-tag-username"
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-sm)' }}>
                <span className="muted">X%</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  style={{ width: 68 }}
                  value={xPct}
                  disabled={disabled || userTags.length >= USER_TAGS_MAX}
                  onChange={(e) => setXPct(e.target.value)}
                  aria-label="Tag horizontal position percent"
                  data-testid="draft-ig-tag-x"
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-sm)' }}>
                <span className="muted">Y%</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  style={{ width: 68 }}
                  value={yPct}
                  disabled={disabled || userTags.length >= USER_TAGS_MAX}
                  onChange={(e) => setYPct(e.target.value)}
                  aria-label="Tag vertical position percent"
                  data-testid="draft-ig-tag-y"
                />
              </label>
              <Button variant="secondary" onClick={addTag} disabled={disabled || userTags.length >= USER_TAGS_MAX} data-testid="draft-ig-tag-add">
                Add tag
              </Button>
            </div>
            {userTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }} data-testid="draft-ig-tags-list">
                {userTags.map((tag) => (
                  <span key={tag.username} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Badge>
                      @{tag.username} ({Math.round(tag.x * 100)}%, {Math.round(tag.y * 100)}%)
                    </Badge>
                    {!disabled && (
                      <Button
                        variant="quiet"
                        onClick={() => onChange({ userTags: userTags.filter((t) => t.username !== tag.username) })}
                        aria-label={`Remove tag @${tag.username}`}
                        data-testid={`draft-ig-tag-remove-${tag.username}`}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </Field>
        </>
      )}
    </div>
  )
}
