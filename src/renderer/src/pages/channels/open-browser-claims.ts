// Which "Open browser" control of an account shows the block while the owner works in the window (DEC-028). Several controls can lead to one account
// on a screen (a row of Accounts, the Connect form, a channel card); the block, with its note and buttons, is shown once: by the control that was
// pressed, or, when that one is not on this screen, by the first control of the account. The others are switched off meanwhile.

import { useEffect, useId, useSyncExternalStore } from 'react'
import { blockHolder } from './open-browser'

/** Account id -> the control that was pressed last. */
const claims = new Map<string, string>()
/** Account id -> the controls on screen, in the order they appeared. */
const mounted = new Map<string, string[]>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export interface BlockClaim {
  /** Whether this control is the one that shows the block now. */
  showsBlock: boolean
  /** This control was pressed: the block is its to show while the window is open. */
  claim: () => void
  /** The window was closed or control given back: nobody holds the block any more. */
  release: () => void
}

export function useBlockClaim(accountId: string): BlockClaim {
  const me = useId()
  useEffect(() => {
    mounted.set(accountId, [...(mounted.get(accountId) ?? []), me])
    changed()
    return () => {
      const rest = (mounted.get(accountId) ?? []).filter((id) => id !== me)
      if (rest.length > 0) mounted.set(accountId, rest)
      else mounted.delete(accountId)
      changed()
    }
  }, [accountId, me])
  useSyncExternalStore(subscribe, () => version)
  return {
    showsBlock: blockHolder(claims.get(accountId) ?? null, mounted.get(accountId) ?? []) === me,
    claim: () => {
      claims.set(accountId, me)
      changed()
    },
    release: () => {
      if (claims.delete(accountId)) changed()
    }
  }
}
