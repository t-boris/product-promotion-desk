import { useEffect, useState } from 'react'
import type { Id, MixCard } from '../../../../shared/types'
import { call } from '../../hooks'

/**
 * The content mix of each channel, for the calendar's faint rhythm lines. It is read when the calendar is shown and when the set of
 * channels changes; a channel whose mix cannot be read is left out of the markers and counted in `unread`, so the calendar can say
 * its lines are incomplete instead of looking as if the mix were off.
 */
export function useMixCards(channelIds: Id[], enabled: boolean): { cards: MixCard[]; unread: number } {
  const [cards, setCards] = useState<MixCard[]>([])
  const [unread, setUnread] = useState(0)
  const key = channelIds.join(',')
  useEffect(() => {
    if (!enabled || channelIds.length === 0) return
    let current = true
    void Promise.all(channelIds.map((channelId) => call('mix.get', { channelId }).catch(() => null))).then((all) => {
      if (!current) return
      setCards(all.filter((card): card is MixCard => card !== null))
      setUnread(all.filter((card) => card === null).length)
    })
    return () => {
      current = false
    }
  }, [key, enabled])
  return { cards, unread }
}
