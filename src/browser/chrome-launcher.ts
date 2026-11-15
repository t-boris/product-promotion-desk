// Starting the owner's installed Google Chrome for one account (DEC-025): where it is, where its profile lives, how it is started.
// Chrome is started as a normal browser with a profile folder of its own and a debugging pipe only this application holds (no network port).
// Nothing here hides or fakes anything: no automation banner flag, no headless mode, no user agent, no script. Chrome itself reports
// `navigator.webdriver = true` while a program drives it over a debugging pipe (measured with the real Chrome, chrome-real.test.ts), and a site
// may act on that; it is not changed here (DEC-025: a normal browser, and the owner finishes by hand what a site refuses).

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { Browser } from 'puppeteer-core'

const CHROME_IN_APPLICATIONS = 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** `PPD_CHROME_PATH` (for probes) when it exists, else Google Chrome in /Applications or in the owner's own Applications folder. */
export function findChrome(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync, home: string = homedir()): string | null {
  const override = env.PPD_CHROME_PATH
  if (override && exists(override)) return override
  for (const candidate of [`/${CHROME_IN_APPLICATIONS}`, join(home, CHROME_IN_APPLICATIONS)]) {
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * The folder holding one account's Chrome profile (cookies, storage): under the application's data folder, named after the account's
 * partition. The name is cut to plain characters and the result is checked to be inside the folder for profiles, so no account name can
 * point anywhere else, and nothing outside it is ever deleted when an account is forgotten.
 */
export function profilesRoot(dataDir: string): string {
  return join(resolve(dataDir), 'chrome-profiles')
}

export function profileDirFor(dataDir: string, partition: string): string {
  const name = partition.replace(/^persist:/, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)
  if (name === '' || /^_+$/.test(name)) throw new Error(`Invalid browser profile name: ${partition}`)
  const root = profilesRoot(dataDir)
  const dir = join(root, name)
  if (!dir.startsWith(`${root}${sep}`)) throw new Error(`Invalid browser profile name: ${partition}`)
  return dir
}

/** True for a folder that is a profile folder of this application (the only kind that may be deleted). */
export function isProfileDir(dataDir: string, dir: string): boolean {
  const root = profilesRoot(dataDir)
  const full = resolve(dir)
  return full.startsWith(`${root}${sep}`) && full.length > root.length + 1 && !full.slice(root.length + 1).includes(sep)
}

/**
 * The command line of Chrome. `PPD_CHROME_MOCK_KEYCHAIN=1` keeps a probe away from the owner's keychain (never set in normal use: cookies
 * are then not protected by the keychain).
 */
export function chromeArguments(profileDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    // The page is worked on while its window is behind others or minimised: it must not be slowed down for that.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1280,900',
    ...(env.PPD_CHROME_MOCK_KEYCHAIN === '1' ? ['--use-mock-keychain', '--password-store=basic'] : []),
    'about:blank'
  ]
}

export type LaunchChrome = (executablePath: string, args: string[]) => Promise<Browser>

/**
 * Starts Chrome through puppeteer-core over a pipe. `ignoreDefaultArgs` keeps puppeteer's own list (automation banner, headless-style
 * tuning, mock keychain) out: only `chromeArguments` and the pipe are given. Chrome ends when this application does.
 */
export const launchChrome: LaunchChrome = async (executablePath, args) => {
  const { launch } = await import('puppeteer-core')
  return launch({
    executablePath,
    args,
    ignoreDefaultArgs: true,
    pipe: true,
    headless: false,
    defaultViewport: null,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    timeout: 60_000,
    protocolTimeout: 120_000
  })
}
