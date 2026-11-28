import type { Connector } from '../core/ports'
import { FacebookPageConnector } from './facebook'
import { RedditConnector } from './reddit'
import { TelegramBotConnector } from './telegram'
import { ThreadsApiConnector } from './threads'
import { UniversalConnector } from './universal'

export { authIssueOf, CaptchaRequiredError, LoginRequiredError, type AuthIssue } from './errors'

/**
 * Prepared connectors, the connectors that work through a platform's own API (a Telegram bot, DEC-055; a Facebook Page, DEC-076; a Threads profile, DEC-080), plus the universal connector (the fallback for unknown sites). The core's channels
 * module hands the universal connector the database so it can load its site profiles.
 */
export function createConnectors(): Connector[] {
  return [new RedditConnector(), new TelegramBotConnector(), new FacebookPageConnector(), new ThreadsApiConnector(), new UniversalConnector()]
}
