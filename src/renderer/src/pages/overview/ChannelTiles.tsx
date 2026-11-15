import { platformLabel } from '../../../../shared/post-format'
import type { Channel, OverviewChannel } from '../../../../shared/types'
import { Sparkline } from '../../charts/Sparkline'
import { channelHref } from '../../route'
import { formatNumber } from '../../charts/geometry'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE } from '../channels/model'
import { useWatchingContext } from '../feed/useWatching'
import { watchingLine } from '../feed/watching-line'
import { shortTime } from '../posts/short-time'
import type { TileLine } from './overview-data'

const NO_DETAILS: readonly Channel[] = []

/**
 * One tile for each channel of the product: where it is, how it stands, what waits and what went out in the period, a small line of its
 * main metric where the platform gives one, and how it is watched (how often, when last, when next, or why not: DEC-040). The tile is a
 * link to the channel's page. The watching line is made of the channel's own settings and times, which the Overview's numbers do not carry:
 * `details` are the product's channels as the Channels list gives them; a tile without its channel there has no such line.
 */
export function ChannelTiles({ channels, lines, days, details = NO_DETAILS }: { channels: OverviewChannel[]; lines: ReadonlyMap<string, TileLine | null>; days: number; details?: readonly Channel[] }) {
  const context = useWatchingContext()
  return (
    <ul className="ov-tiles" data-testid="overview-channels">
      {channels.map((channel) => {
        const line = lines.get(channel.channelId) ?? null
        const detail = details.find((c) => c.id === channel.channelId)
        const watching = detail && context ? watchingLine(detail, context) : null
        return (
          <li key={channel.channelId}>
            <a className="ov-tile" href={channelHref(channel.channelId)} data-testid={`overview-channel-${channel.channelId}`}>
              <span className="ov-tile-top">
                <span className="ov-tile-target">{channel.target}</span>
                <span className="ov-tile-platform">{platformLabel(channel.platform)}</span>
              </span>
              <span className="dot-line">
                <span className={`dot ${CHANNEL_STATUS_TONE[channel.status]}`} aria-hidden="true" />
                {CHANNEL_STATUS_LABEL[channel.status]}
              </span>
              <span className="ov-tile-counts">
                {channel.waiting} waiting · {channel.sent} sent in {days} days
              </span>
              <span className="ov-tile-metric">
                {line ? (
                  <>
                    <Sparkline values={line.values} label={line.label} />
                    <span className="ov-tile-latest">
                      {line.latest !== null ? formatNumber(line.latest) : '–'} <span className="muted">{line.label}</span>
                    </span>
                  </>
                ) : (
                  <span className="muted">No metric history yet</span>
                )}
              </span>
              <span className="ov-tile-when">{channel.lastSuccessAt ? `Last read ${shortTime(channel.lastSuccessAt)}` : 'Not read yet'}</span>
              {watching && (
                <span className="ov-tile-when" data-testid={`overview-watching-${channel.channelId}`} data-watching={watching.watching}>
                  {watching.text}
                </span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
