// The guided connection of an account (DEC-074): the kind is asked per account, the steps follow the platform and the kind, and every
// address of a step is one the account's own browser opens.
import { afterEach, describe, expect, it } from 'vitest'
import { PLATFORM_PRESETS } from '../core/channels/presets'
import { makeTestCore, type TestCore } from '../core/testing/fakes'
import { guideSteps, kindLabel } from '../shared/connection-guide'
import type { PlatformInfo } from '../shared/types'
import { TelegramBotConnector } from './telegram/connector'
import { UniversalConnector } from './universal'

let t: TestCore | null = null
afterEach(async () => {
  await t?.core.shutdown()
  t = null
})

function world() {
  t = makeTestCore({ connectors: [new TelegramBotConnector(), new UniversalConnector()] })
  const core = t.core
  return { core, browser: t.browser, call: core.router.call.bind(core.router) as typeof core.router.call }
}
const refusal = async (work: Promise<unknown>): Promise<string> => work.then(() => 'accepted', (error: { code?: string }) => error.code ?? 'threw')

describe('the kind of an account (DEC-074)', () => {
  it('is asked per account: three Instagram accounts of one owner can be one professional and two personal', async () => {
    const w = world()
    const business = await w.call('accounts.create', { platform: 'instagram', label: 'Brand', kind: 'professional' })
    const first = await w.call('accounts.create', { platform: 'instagram', label: 'Anna', kind: 'personal' })
    const second = await w.call('accounts.create', { platform: 'instagram', label: 'Boris' })
    expect([business.kind, first.kind, second.kind]).toEqual(['professional', 'personal', null])
    // Said later, changed, and taken back; only the kinds the platform has are accepted.
    expect((await w.call('accounts.setKind', { accountId: second.id, kind: 'personal' })).kind).toBe('personal')
    expect((await w.call('accounts.setKind', { accountId: second.id, kind: null })).kind).toBeNull()
    expect(await refusal(w.call('accounts.setKind', { accountId: second.id, kind: 'page' }))).toBe('invalid_input')
    expect(await refusal(w.call('accounts.create', { platform: 'instagram', label: 'Odd', kind: 'business' }))).toBe('invalid_input')
    expect((await w.call('accounts.list', undefined)).map((a) => a.kind).sort()).toEqual([null, 'personal', 'professional'])
  })

  it('is not asked where the platform has one kind, nor of a bot', async () => {
    const w = world()
    expect(await refusal(w.call('accounts.create', { platform: 'pinterest', label: 'Pins', kind: 'personal' }))).toBe('invalid_input')
    expect(await refusal(w.call('accounts.create', { platform: 'telegram', label: 'Bot', access: 'api', kind: 'personal' }))).toBe('invalid_input')
    expect((await w.call('accounts.create', { platform: 'facebook', label: 'Shop page', kind: 'page' })).kind).toBe('page')
  })
})

describe('the steps of a connection (DEC-074)', () => {
  it('follow the platform, the kind and the way the application works with the account', async () => {
    const w = world()
    const platforms = await w.call('platforms.list', undefined as never)
    const of = (platform: string): PlatformInfo => platforms.find((p) => p.platform === platform) as PlatformInfo
    const instagram = of('instagram')
    expect(instagram.kinds?.map((k) => k.id)).toEqual(['professional', 'personal'])
    expect(kindLabel(instagram, 'professional')).toBe('Professional (business or creator)')
    expect(kindLabel(instagram, null)).toBeNull()
    const words = (platform: string, kind: string | null, access: 'browser' | 'api' = 'browser'): string => guideSteps(of(platform), { kind, access }).map((s) => s.text).join(' | ')
    expect(words('instagram', 'professional')).toMatch(/Creator or Business/)
    expect(words('instagram', 'personal')).toMatch(/Nothing more is needed/)
    expect(words('instagram', null)).toMatch(/Find out the kind/)
    expect(words('facebook', 'page')).toMatch(/no login of its own.*Create the Page.*Switch into the Page/)
    expect(words('facebook', 'profile')).toMatch(/groups it has joined/)
    expect(words('threads', null)).toMatch(/signs in with its Instagram account/)
    // A bot's steps are the API's; the browser account of the same platform has its own.
    expect(words('telegram', null, 'api')).toMatch(/BotFather.*\/newbot.*administrator.*Paste the bot token below/)
    expect(words('telegram', null)).toMatch(/Link Desktop Device/)
    // A platform that wrote no steps still gets the two every login has.
    expect(guideSteps(of('pinterest'), { kind: null, access: 'browser' })).toHaveLength(2)
    expect(words('pinterest', null)).toMatch(/^Sign in to Pinterest.*connect its channel/)
    expect(guideSteps(undefined, { kind: null, access: 'browser' })).toEqual([])
  })

  it('open only https pages of the platform itself, each with the words of its button, in the account’s own browser', async () => {
    const w = world()
    for (const preset of PLATFORM_PRESETS) {
      expect(Object.keys(preset.guides ?? {}).filter((key) => key !== '' && !preset.kinds?.some((k) => k.id === key))).toEqual([])
      if (preset.kinds) expect(Object.keys(preset.guides ?? {}).sort()).toEqual(['', ...preset.kinds.map((k) => k.id)].sort())
      for (const step of Object.values(preset.guides ?? {}).flat()) {
        if (!step.url) continue
        const url = new URL(step.url)
        expect(url.protocol).toBe('https:')
        expect(preset.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))).toBe(true)
        expect(step.link?.trim()).toBeTruthy()
      }
    }
    const bot = await w.call('accounts.create', { platform: 'telegram', label: 'Bot', access: 'api' })
    const platforms = await w.call('platforms.list', undefined as never)
    const step = guideSteps(platforms.find((p) => p.platform === 'telegram'), bot).find((s) => s.url)
    expect(step).toMatchObject({ url: 'https://web.telegram.org/k/#@BotFather', link: 'Open BotFather' })
    await w.call('accounts.openBrowser', { accountId: bot.id, url: step!.url })
    expect(w.browser.opened).toEqual([{ accountId: bot.id, url: 'https://web.telegram.org/k/#@BotFather' }])
  })
})
