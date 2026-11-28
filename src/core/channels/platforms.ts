// The platform catalog (DEC-009, DEC-013): what the application can connect. Prepared platforms come from the registered connectors;
// named platforms such as Instagram are presets served by the universal connector; "Other website" is the universal connector itself.

import type { AccountAccess, PlatformInfo } from '../../shared/types'
import { UNIVERSAL_CONNECTOR_ID } from '../connector-registry'
import type { Connector, ConnectorRegistry } from '../ports'
import { PLATFORM_PRESETS, presetFor } from './presets'

const capitalize = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text)

/** What a prepared connector says about its channels (DEC-028): where they are found, a typical address, what to give. */
function guideFields(connector: Connector): Pick<PlatformInfo, 'browseUrl' | 'example' | 'hint'> | Record<string, never> {
  const guide = connector.channelGuide?.()
  return guide ? { browseUrl: guide.browseUrl, example: guide.example, hint: guide.hint } : {}
}

export function platformInfo(connector: Connector): PlatformInfo {
  return {
    connectorId: connector.id,
    platform: connector.platform,
    label: connector.label?.trim() || capitalize(connector.platform),
    prepared: connector.id !== UNIVERSAL_CONNECTOR_ID,
    loginUrl: connector.loginUrl(),
    ...(connector.signupUrl ? { signupUrl: connector.signupUrl() } : {}),
    ...(connector.membership ? { canJoin: true } : {}),
    ...guideFields(connector)
  }
}

/** Prepared platforms first (alphabetical), then the named platforms (alphabetical), then the universal connector for any other website. */
export function listPlatforms(connectors: ConnectorRegistry): PlatformInfo[] {
  const all = connectors.list()
  const universal = all.find((c) => c.id === UNIVERSAL_CONNECTOR_ID)
  const prepared = all.filter((c) => c.id !== UNIVERSAL_CONNECTOR_ID && !c.api).map(platformInfo)
  // A named platform exists only while the universal connector that serves it does, and never twice: a prepared connector wins.
  const named: PlatformInfo[] = universal
    ? PLATFORM_PRESETS.filter((p) => !prepared.some((info) => info.platform === p.platform)).map((p) => ({
        connectorId: universal.id,
        platform: p.platform,
        label: p.label,
        prepared: false,
        loginUrl: p.loginUrl,
        browseUrl: p.browseUrl,
        ...(p.signupUrl ? { signupUrl: p.signupUrl } : {}),
        ...(p.signupNote ? { signupNote: p.signupNote } : {}),
        ...(p.signsInWith ? { signsInWith: p.signsInWith } : {}),
        hint: p.hint,
        example: p.example,
        handleUrl: p.handleUrl,
        accepts: p.accepts,
        note: p.note,
        ...(p.kinds ? { kinds: p.kinds } : {}),
        ...(p.guides ? { guides: p.guides } : {})
      }))
    : []
  const byLabel = (a: PlatformInfo, b: PlatformInfo): number => a.label.localeCompare(b.label)
  // A platform that can also be worked through its own API says so (DEC-055): what the key is called and how the owner gets it.
  const withApi = (info: PlatformInfo): PlatformInfo => {
    const connector = all.find((c) => c.api !== undefined && c.platform === info.platform)
    const api = connector?.api
    if (!connector || !api) return info
    return { ...info, api: { accountKind: api.accountKind, keyLabel: api.keyLabel, ...(api.keyName ? { keyName: api.keyName } : {}), steps: api.steps, ...(api.onceSecret ? { onceSecret: api.onceSecret } : {}), ...(connector.renewKey ? { renews: true as const } : {}), ...(api.work ? { work: api.work } : {}), ...(api.keyDays ? { keyDays: api.keyDays } : {}) } }
  }
  return [...prepared.sort(byLabel), ...named.sort(byLabel), ...(universal ? [platformInfo(universal)] : [])].map(withApi)
}

/** The connector that serves a platform key: its own prepared connector, or the universal one for a named platform. */
export function connectorForPlatform(connectors: ConnectorRegistry, platform: string, access: AccountAccess = 'browser'): Connector | undefined {
  const all = connectors.list()
  if (access === 'api') return all.find((c) => c.api !== undefined && c.platform === platform)
  const own = all.find((c) => c.platform === platform && !c.api)
  if (own) return own
  return presetFor(platform) ? all.find((c) => c.id === UNIVERSAL_CONNECTOR_ID) : undefined
}
