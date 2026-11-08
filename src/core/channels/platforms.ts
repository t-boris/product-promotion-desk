// The platform catalog (DEC-009): what the application can connect, taken from the registered connectors.

import type { PlatformInfo } from '../../shared/types'
import { UNIVERSAL_CONNECTOR_ID } from '../connector-registry'
import type { Connector, ConnectorRegistry } from '../ports'

const capitalize = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text)

export function platformInfo(connector: Connector): PlatformInfo {
  return {
    connectorId: connector.id,
    platform: connector.platform,
    label: connector.label?.trim() || capitalize(connector.platform),
    prepared: connector.id !== UNIVERSAL_CONNECTOR_ID,
    loginUrl: connector.loginUrl()
  }
}

/** Prepared platforms first (alphabetical), then the universal connector for any other website. */
export function listPlatforms(connectors: ConnectorRegistry): PlatformInfo[] {
  return connectors
    .list()
    .map(platformInfo)
    .sort((a, b) => Number(b.prepared) - Number(a.prepared) || a.label.localeCompare(b.label))
}
