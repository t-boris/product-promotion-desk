import type { Connector } from '../core/ports'
import { RedditConnector } from './reddit'
import { UniversalConnector } from './universal'

/**
 * Prepared connectors plus the universal connector (the fallback for unknown sites). The core's channels
 * module hands the universal connector the database so it can load its site profiles.
 */
export function createConnectors(): Connector[] {
  return [new RedditConnector(), new UniversalConnector()]
}
