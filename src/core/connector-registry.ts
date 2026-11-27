import type { Connector, ConnectorRegistry } from './ports'

export const UNIVERSAL_CONNECTOR_ID = 'universal'

export class Connectors implements ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>()

  constructor(connectors: Connector[] = []) {
    for (const c of connectors) this.register(c)
  }

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector)
  }

  list(): Connector[] {
    return [...this.connectors.values()]
  }

  get(id: string): Connector | undefined {
    return this.connectors.get(id)
  }

  /**
   * Prepared connectors win; the universal connector is the fallback for unknown sites. A connector that works through a platform's API is
   * never chosen by an address: it serves the accounts connected with a key (`apiFor`, DEC-055).
   */
  resolve(input: string): Connector | undefined {
    for (const c of this.connectors.values()) {
      if (c.id !== UNIVERSAL_CONNECTOR_ID && !c.api && c.matches(input)) return c
    }
    return this.connectors.get(UNIVERSAL_CONNECTOR_ID)
  }

  /** The connector that works through the platform's own API, when there is one. */
  apiFor(platform: string): Connector | undefined {
    return this.list().find((c) => c.api !== undefined && c.platform === platform)
  }
}
