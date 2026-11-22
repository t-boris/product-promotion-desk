import './video-tile.css'

/** A frame of a video with a play mark on it; where the system could not make a frame, a plain tile that says "Video". It is not opened large: a video is played by the system (Show file). */
export function VideoTile({ poster, name, label }: { poster: string | null | undefined; name: string; label?: string }) {
  return (
    <div className={`video-tile${poster ? ' has-poster' : ''}`} role="img" aria-label={`Video: ${name}`} data-testid="video-tile">
      {poster ? <img src={poster} alt="" /> : null}
      <span className="video-tile-play" aria-hidden="true" />
      {!poster && <span className="video-tile-label small">{label ?? 'Video'}</span>}
    </div>
  )
}
