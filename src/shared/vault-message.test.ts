import { describe, expect, it } from 'vitest'
import { vaultUnavailableText } from './vault-message'

describe('vaultUnavailableText', () => {
  it('says that macOS refused the app and how to allow it, and does not blame the Mac', () => {
    const text = vaultUnavailableText('refused')
    expect(text).toContain('macOS did not let the app use its keychain item')
    expect(text).toContain('Quit and reopen the app')
    expect(text).toContain('Always Allow')
    expect(text).not.toMatch(/no usable (system )?keychain/i)
  })

  it('says that there is no keychain only when there really is none', () => {
    const text = vaultUnavailableText('no_keychain')
    expect(text).toContain('no usable keychain')
    expect(text).not.toContain('Always Allow')
  })
})
