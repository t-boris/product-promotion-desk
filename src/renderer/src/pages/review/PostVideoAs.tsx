import { useId } from 'react'
import type { VideoAs } from '../../../../shared/types'
import { REEL_HINT } from '../../../../shared/video-as'
import { Hint, SegmentedControl } from '../../ui'

type Choice = 'video' | VideoAs

/**
 * Under the one video of a post for a channel whose platform has two forms for a video (a Facebook Page through its API): the usual video post,
 * or a Reel. The owner chooses; nothing is chosen for them, and the choice is part of what the approval binds (DEC-092).
 */
export function PostVideoAs({ value, onChange, disabled }: { value: VideoAs | null; onChange: (videoAs: VideoAs | null) => void; disabled: boolean }) {
  const id = useId()
  return (
    <div className="field" data-testid="draft-video-as">
      <span className="field-label">Publish the video as</span>
      <SegmentedControl<Choice>
        label="Publish the video as"
        name={`video-as-${id}`}
        options={[
          { value: 'video', label: 'Video post' },
          { value: 'reel', label: 'Reel' }
        ]}
        value={value ?? 'video'}
        onChange={(next) => onChange(next === 'video' ? null : next)}
        disabled={disabled}
        testIdPrefix="draft-video-as-"
        describedBy={`${id}-hint`}
      />
      <Hint id={`${id}-hint`}>{REEL_HINT}</Hint>
    </div>
  )
}
