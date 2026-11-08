// The platform catalog (DEC-009, DEC-013): what the application can connect. Prepared platforms come from the registered connectors;
// named platforms such as Instagram are presets served by the universal connector; "Other website" is the universal connector itself.

import type { PlatformInfo } from '../../shared/types'
import { UNIVERSAL_CONNECTOR_ID } from '../connector-registry'
import type { Connector, ConnectorRegistry } from '../ports'
import { PLATFORM_PRESETS, presetFor } from './presets'

const capitalize = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text)

export function platformInfo(connector: Connector): PlatformInfo {
  return {
    connectorId: connector.id,
    platform: connector.platform,
    label: connector.label?.trim() || capitalize(connector.platform),
    prepared: connector.id !== UNIVERSAL_CONNECTOR_ID,
    loginUrl: connector.loginUrl(),
    ...(connector.signupUrl ? { signupUrl: connector.signupUrl() } : {})
  }
}

/** Prepared platforms first (alphabetical), then the named platforms (alphabetical), then the universal connector for any other website. */
export function listPlatforms(connectors: ConnectorRegistry): PlatformInfo[] {
  const all = connectors.list()
  const universal = all.find((c) => c.id === UNIVERSAL_CONNECTOR_ID)
  const prepared = all.filter((c) => c.id !== UNIVERSAL_CONNECTOR_ID).map(platformInfo)
  // A named platform exists only while the universal connector that serves it does, and never twice: a prepared connector wins.
  const named: PlatformInfo[] = universal
    ? PLATFORM_PRESETS.filter((p) => !prepared.some((info) => info.platform === p.platform)).map((p) => ({
        connectorId: universal.id,
        platform: p.platform,
        label: p.label,
        prepared: false,
        loginUrl: p.loginUrl,
        ...(p.signupUrl ? { signupUrl: p.signupUrl } : {}),
        ...(p.signupNote ? { signupNote: p.signupNote } : {}),
        hint: p.hint,
        example: p.example,
        handleUrl: p.handleUrl,
        accepts: p.accepts,
        note: p.note
      }))
    : []
  const byLabel = (a: PlatformInfo, b: PlatformInfo): number => a.label.localeCompare(b.label)
  return [...prepared.sort(byLabel), ...named.sort(byLabel), ...(universal ? [platformInfo(universal)] : [])]
}

/** The connector that serves a platform key: its own prepared connector, or the universal one for a named platform. */
export function connectorForPlatform(connectors: ConnectorRegistry, platform: string): Connector | undefined {
  const all = connectors.list()
  const own = all.find((c) => c.platform === platform)
  if (own) return own
  return presetFor(platform) ? all.find((c) => c.id === UNIVERSAL_CONNECTOR_ID) : undefined
}
