import { useMemo } from 'react'
import type { Channel, Id, OverviewView, ResultsHistory } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { useProductChannels } from '../review/product-channels'
import { mainMetric, tileLine, type MainMetric, type TileLine } from './overview-data'

export interface OverviewData {
  /** The product's numbers for the period; undefined until they are loaded. */
  view: OverviewView | undefined
  history: ResultsHistory | undefined
  channels: Channel[]
  /** The local day of each day of the period, oldest first. */
  days: string[]
  /** The metric the lines show, or null where no channel has two days of readings. */
  metric: MainMetric | null
  /** The small line of each channel's tile. */
  lines: ReadonlyMap<Id, TileLine | null>
  offset: number
  error: string | null
}

/** What the Overview and the list of channels draw: the product's counts and metric history for a period, and the lines made of them. */
export function useOverviewData(productId: Id, days: number): OverviewData {
  const offset = -new Date().getTimezoneOffset()
  const overview = useQuery('overview.get', { productId, days, utcOffsetMinutes: offset }, ['opportunities', 'channels', 'results', 'attention', 'products'])
  const history = useQuery('results.history', { productId, days }, ['results', 'channels'])
  const { channels, error: channelsError } = useProductChannels(productId)
  const view = overview.data
  const dayList = useMemo(() => (view ? view.activity.map((day) => day.day) : []), [view])
  const metric = useMemo(
    () =>
      history.data
        ? mainMetric(
            history.data,
            dayList,
            offset,
            channels.map((c) => c.id),
            (id) => channels.find((c) => c.id === id)?.target ?? 'Channel'
          )
        : null,
    [history.data, dayList, offset, channels]
  )
  const lines = useMemo(() => {
    const map = new Map<Id, TileLine | null>()
    if (history.data && view) for (const channel of view.channels) map.set(channel.channelId, tileLine(history.data, channel.channelId, dayList, offset, metric?.key ?? null))
    return map
  }, [history.data, view, dayList, offset, metric])
  return { view, history: history.data, channels, days: dayList, metric, lines, offset, error: overview.error ?? history.error ?? channelsError }
}
