// The guided connection of an account (DEC-074): which steps the owner is shown for an account, by its platform, its kind and the way the
// application works with it. The steps are data of the platform (its preset, or its API connector); this file only chooses among them.
import type { Account, GuideStep, PlatformInfo } from './types'

/** Shown in the kind's list while the owner has not said the kind. */
export const KIND_NOT_SAID = 'Not sure yet'

/** The words of the account's kind, or null when the platform has no kinds or the kind is not said. */
export function kindLabel(info: Pick<PlatformInfo, 'kinds'> | undefined, kind: string | null): string | null {
  return info?.kinds?.find((k) => k.id === kind)?.label ?? null
}

/**
 * The steps that connect this account. An account that works through the platform's API gets the steps of that API (a Telegram bot); a
 * browser account gets the steps of its kind, or of "kind not said", or, for a platform that wrote none, the two steps every login has.
 */
export function guideSteps(info: PlatformInfo | undefined, account: Pick<Account, 'kind' | 'access'>): GuideStep[] {
  if (!info) return []
  if (account.access === 'api') return info.api?.steps ?? []
  const written = info.guides?.[account.kind ?? ''] ?? info.guides?.['']
  if (written) return written
  return [
    { text: `Sign in to ${info.label} in this account’s browser (the Sign-in step below), or create the account there.` },
    { text: `Then connect its channel on the Channels screen.${info.hint ? ` ${info.hint}` : ''}` }
  ]
}
