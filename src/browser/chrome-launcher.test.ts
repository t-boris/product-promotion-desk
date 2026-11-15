import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chromeArguments, findChrome, isProfileDir, profileDirFor, profilesRoot } from './chrome-launcher'

const APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

describe('where Chrome is', () => {
  it('prefers the override, then /Applications, then the owner\'s own Applications', () => {
    const only = (...present: string[]) => (path: string) => present.includes(path)
    expect(findChrome({ PPD_CHROME_PATH: '/x/chrome' }, only('/x/chrome', APP), '/Users/a')).toBe('/x/chrome')
    expect(findChrome({}, only(APP, '/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Users/a')).toBe(APP)
    expect(findChrome({}, only('/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Users/a')).toBe('/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  })

  it('is null when there is none, and an override that does not exist does not count', () => {
    expect(findChrome({}, () => false, '/Users/a')).toBeNull()
    expect(findChrome({ PPD_CHROME_PATH: '/x/chrome' }, () => false, '/Users/a')).toBeNull()
    expect(findChrome({ PPD_CHROME_PATH: '/x/chrome' }, (p) => p === APP, '/Users/a')).toBe(APP)
  })
})

describe('the profile folder of an account', () => {
  const data = '/data/ppd'

  it('is a folder of its own under chrome-profiles, named after the partition', () => {
    expect(profileDirFor(data, 'persist:acct-abc_1')).toBe(join(data, 'chrome-profiles', 'acct-abc_1'))
    expect(profileDirFor(data, 'acct-abc_1')).toBe(join(data, 'chrome-profiles', 'acct-abc_1'))
    expect(profilesRoot(data)).toBe(join(data, 'chrome-profiles'))
  })

  it('cannot point anywhere else, whatever the name', () => {
    for (const name of ['../../etc', '..', '.', 'a/b', '/abs/path', 'persist:../x', 'x\u0000y', '']) {
      let dir: string
      try {
        dir = profileDirFor(data, name)
      } catch {
        continue
      }
      expect(isProfileDir(data, dir), name).toBe(true)
      expect(dir.startsWith(join(data, 'chrome-profiles') + '/'), name).toBe(true)
      expect(dir.slice(join(data, 'chrome-profiles').length + 1).includes('/'), name).toBe(false)
    }
    expect(() => profileDirFor(data, '')).toThrow()
    // A name with nothing of its own left after cleaning is refused, not turned into one folder for many accounts.
    expect(() => profileDirFor(data, '...')).toThrow()
    expect(() => profileDirFor(data, '///')).toThrow()
    expect(profileDirFor(data, 'a.b')).not.toBe(profileDirFor(data, 'a_c'))
  })

  it('knows a profile folder when it sees one, and nothing else', () => {
    expect(isProfileDir(data, join(data, 'chrome-profiles', 'acct-1'))).toBe(true)
    expect(isProfileDir(data, join(data, 'chrome-profiles'))).toBe(false)
    expect(isProfileDir(data, join(data, 'chrome-profiles', 'a', 'b'))).toBe(false)
    expect(isProfileDir(data, data)).toBe(false)
    expect(isProfileDir(data, '/Users/a')).toBe(false)
    expect(isProfileDir(data, join(data, 'chrome-profiles', '..', 'ppd.sqlite'))).toBe(false)
    expect(isProfileDir(data, join(data, 'chrome-profiles-other', 'x'))).toBe(false)
  })
})

describe('the command line of Chrome', () => {
  it('names the profile, opens a blank page, and does nothing that changes what a page sees of the browser', () => {
    const args = chromeArguments('/data/ppd/chrome-profiles/acct-1', {})
    expect(args[0]).toBe('--user-data-dir=/data/ppd/chrome-profiles/acct-1')
    expect(args.at(-1)).toBe('about:blank')
    expect(args).toContain('--no-first-run')
    for (const forbidden of [/automation/, /headless/, /remote-debugging/, /no-sandbox/, /disable-extensions/, /user-agent/, /disable-blink-features/, /mock-keychain/, /password-store/, /proxy/, /disable-web-security/, /allow-running-insecure/]) {
      expect(args.filter((a) => forbidden.test(a)), String(forbidden)).toEqual([])
    }
  })

  it('keeps a probe away from the keychain only when asked', () => {
    expect(chromeArguments('/p', { PPD_CHROME_MOCK_KEYCHAIN: '1' })).toEqual(expect.arrayContaining(['--use-mock-keychain', '--password-store=basic']))
    for (const value of [undefined, '', '0', 'true']) {
      expect(chromeArguments('/p', { PPD_CHROME_MOCK_KEYCHAIN: value }).some((a) => /mock-keychain/.test(a)), String(value)).toBe(false)
    }
  })
})
