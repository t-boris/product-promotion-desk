import { call, useQuery } from '../../hooks'
import { OpenAccountBrowser } from './OpenAccountBrowser'
import { OPEN_BROWSER } from './open-browser'
import { AddressLink } from '../AddressLink'

/**
 * "Open browser" for a channel the screen knows only by id (Feed, Posts, a thread): the account the channel is served
 * by is looked up, and its browser opens on the channel's address, or on `url` (a post or a comment of that channel). While the channel or its
 * account is not known nothing is offered, except that a `fallbackUrl` becomes a link that opens in the app's own browser (never the system's), so a
 * post is never left without a way to open it.
 */
export function OpenChannelBrowser({ channelId, url, label = OPEN_BROWSER, testId, fallbackUrl }: { channelId: string; url?: string; label?: string; testId: string; fallbackUrl?: string }) {
  const channels = useQuery('channels.list', undefined, ['channels'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const channel = channels.data?.find((c) => c.id === channelId)
  const account = accounts.data?.find((a) => a.id === channel?.accountId)
  if (!channel || !account) {
    return fallbackUrl ? (
      <AddressLink className="btn" url={fallbackUrl} channelId={channelId} testId={testId}>
        {label}
      </AddressLink>
    ) : null
  }
  return <OpenAccountBrowser key={account.id} account={account} label={label} open={() => call('accounts.openBrowser', { accountId: account.id, url: url ?? channel.url })} testId={testId} />
}
