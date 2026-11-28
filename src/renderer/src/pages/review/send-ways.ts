import type { Id } from '../../../../shared/types'
import type { SendWays } from '../../../../shared/post-format'
import { useQuery } from '../../hooks'

/**
 * How a post to the channel would go out if the owner pressed Send, as the application judges it at the approval: through the channel's own
 * connector, through its platform's API, or by the AI in the account's browser. The preview asks the application instead of working it out
 * again, so what it says cannot be sent is what the approval refuses (lesson 209). Undefined until the answer comes, and without a channel.
 */
export function useSendWays(channelId: Id | null | undefined): SendWays | undefined {
  const ways = useQuery('channels.sendWays', { channelId: channelId ?? '' }, ['settings', 'channels', 'accounts'], { skip: !channelId })
  return channelId ? ways.data : undefined
}

/**
 * What an answer on the channel costs the owner's developer app, in the application's words; null where an answer costs nothing, without a
 * channel, and until the answer comes. Asked of the application, so the screen need not know which platform charges.
 */
export function useReplyPrice(channelId: Id | null | undefined): string | null {
  const price = useQuery('channels.replyPrice', { channelId: channelId ?? '' }, ['settings', 'channels', 'accounts'], { skip: !channelId })
  return channelId ? (price.data ?? null) : null
}
