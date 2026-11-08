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

  /** Prepared connectors win; the universal connector is the fallback for unknown sites. */
  resolve(input: string): Connector | undefined {
    for (const c of this.connectors.values()) {
      if (c.id !== UNIVERSAL_CONNECTOR_ID && c.matches(input)) return c
    }
    return this.connectors.get(UNIVERSAL_CONNECTOR_ID)
  }
}
