import { call, useQuery } from '../../hooks'
import { OpenAccountBrowser } from './OpenAccountBrowser'
import { OPEN_BROWSER } from './open-browser'

/**
 * "Open browser" for a channel the screen knows only by id (Feed, Posts, a thread): the account the channel is served
 * by is looked up, and its browser opens on the channel's address, or on `url` (a post or a comment of that channel). Nothing is offered
 * while the channel or its account is not known.
 */
export function OpenChannelBrowser({ channelId, url, label = OPEN_BROWSER, testId }: { channelId: string; url?: string; label?: string; testId: string }) {
  const channels = useQuery('channels.list', undefined, ['channels'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const channel = channels.data?.find((c) => c.id === channelId)
  const account = accounts.data?.find((a) => a.id === channel?.accountId)
  if (!channel || !account) return null
  return <OpenAccountBrowser key={account.id} account={account} label={label} open={() => call('accounts.openBrowser', { accountId: account.id, url: url ?? channel.url })} testId={testId} />
}
