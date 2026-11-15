import { platformLabel } from '../../../../shared/post-format'
import type { OverviewChannel } from '../../../../shared/types'
import { Sparkline } from '../../charts/Sparkline'
import { channelHref } from '../../route'
import { formatNumber } from '../../charts/geometry'
import { CHANNEL_STATUS_LABEL, CHANNEL_STATUS_TONE } from '../channels/model'
import { shortTime } from '../posts/short-time'
import type { TileLine } from './overview-data'

/**
 * One tile for each channel of the product: where it is, how it stands, what waits and what went out in the period, and a small line of its
 * main metric where the platform gives one. The tile is a link to the channel's page.
 */
export function ChannelTiles({ channels, lines, days }: { channels: OverviewChannel[]; lines: ReadonlyMap<string, TileLine | null>; days: number }) {
  return (
    <ul className="ov-tiles" data-testid="overview-channels">
      {channels.map((channel) => {
        const line = lines.get(channel.channelId) ?? null
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
            </a>
          </li>
        )
      })}
    </ul>
  )
}
