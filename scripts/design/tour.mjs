// Design tour (docs/design/macos/visual-system.md): every section and nested screen in dark and light at 1320x880 and
// 980x640, with measurements (metrics.json). Runs ONE own instance (own PPD_DATA_DIR inside <out dir>, own debugging port),
// seeds demo data (example.com names only, automation paused, nothing is sent) and never touches the owner's app.
// Usage: node scripts/design/tour.mjs "<app>/Contents/MacOS/Product Promotion Desk" <out dir outside the repo> [port]
import fs from 'node:fs'
import { start, MEASURE, LOOK } from './lib.mjs'

const [, , appPath, outDir, port = '9371'] = process.argv
const OUT = `${outDir}/shots`
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(...a)

// TOUR_ARGS (JSON array) and TOUR_CWD run a development build: the Electron binary with the app folder as its argument.
const p = await start({ app: appPath, args: process.env.TOUR_ARGS ? JSON.parse(process.env.TOUR_ARGS) : [], cwd: process.env.TOUR_CWD, dataDir: `${outDir}/data`, port: Number(port) })
const metrics = {}
const theme = (value) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] })
const snap = async (name, { full = false } = {}) => {
  await p.sleep(300)
  metrics[name] = { ...(await p.ev(MEASURE)), ...(await p.ev(LOOK)) }
  await (full ? p.fullShot : p.shot)(`${OUT}/${name}.png`)
  const m = metrics[name]
  log('  shot', name, JSON.stringify({ hscroll: m.hOverflow, primaries: m.primaries.length, cut: m.cutButtons.length, small: m.smallControls, tall: m.tallButtons.length, under: m.underLights.length }))
}

try {
  await p.size(1320, 880)
  await p.sleep(1500)
  await p.api('automation.setPaused', { paused: true })
  const engines = await p.api('engines.list')
  log('engines:', engines.map((e) => `${e.id}${e.ready ? '*' : ''}`).join(' '))
  const eng = engines.find((e) => e.ready)
  if (eng) await p.api('engines.select', { id: eng.id }).catch((e) => log('select failed', e.message))

  // ---- demo data (nothing here is the owner's)
  const full = await p.api('products.create', { name: 'Northwind Notes', websiteUrl: 'https://northwind.example.com/', description: 'A note-taking app that turns meeting notes into clear action lists.' })
  const second = await p.api('products.create', { name: 'Atlas Habit Coach', description: 'A calm habit tracker that suggests one small step a day.' })
  await p.api('products.create', { name: 'Lumen Reader', description: 'Reads long articles aloud with a natural voice.' })
  await p.api('sources.add', { productId: full.id, kind: 'text', ref: 'Northwind Notes reads a meeting transcript and writes the action items, owners and dates. The first 30 notes a month are free.', label: 'Product notes' }).catch((e) => log('source', e.message))
  const claimDefs = [
    { section: 'offer', text: 'Turns meeting notes into action lists with owners and dates', kind: 'fact' },
    { section: 'audience', text: 'Team leads who run several meetings a day', kind: 'fact' },
    { section: 'terms', text: 'The first 30 notes a month are free', kind: 'assumption' },
    { section: 'identity', text: 'Is there a Windows version?', kind: 'unknown' }
  ]
  const claims = []
  for (const c of claimDefs) claims.push(await p.api('passport.claim.save', { productId: full.id, claim: c }).catch((e) => log('claim', e.message)))
  if (claims[0]) await p.api('passport.claim.setStatus', { claimId: claims[0].id, status: 'approved' }).catch((e) => log('approve claim', e.message))
  if (claims[1]) await p.api('passport.claim.setStatus', { claimId: claims[1].id, status: 'approved' }).catch((e) => log('approve claim', e.message))
  await p.api('passport.approve', { productId: full.id }).catch((e) => log('passport approve', e.message))
  await p.api('products.saveGoal', { id: full.id, goal: { targetAction: 'start a free trial', successMetrics: ['trial sign-ups', 'return visits'], notes: '' } }).catch((e) => log('goal', e.message))
  await p.api('passport.claim.save', { productId: second.id, claim: { section: 'offer', text: 'Suggests one small habit step a day', kind: 'fact' } }).catch((e) => log('claim2', e.message))
  await p.api('mailboxes.add', { address: 'team@example.com' }).catch((e) => log('mailbox', e.message))
  const profile = await p.api('profiles.create', { label: 'Dana Reyes', productId: full.id, platforms: ['reddit'], purpose: 'A team lead who shares how she keeps meetings short.' }).catch((e) => log('profile', e.message))
  const account = await p.api('accounts.create', { productId: full.id, platform: 'reddit', label: 'dana_notes', profileId: profile?.id ?? null }).catch((e) => log('account', e.message))
  let channel = null
  if (account) channel = await p.api('channels.connect', { productId: full.id, accountId: account.id, target: 'r/productivity' }).catch((e) => log('channel', e.message))
  if (channel) await p.api('publications.create', { channelId: channel.id, draft: { title: 'How we cut our weekly meetings in half', text: 'We started writing action items with an owner and a date during the meeting. Here is what changed after a month.', link: null } }).catch((e) => log('publication', e.message))
  await p.api('lessons.add', { rule: 'Do not put a link in the first comment of a thread.', platform: 'reddit' }).catch((e) => log('lesson', e.message))
  await p.api('automation.setPaused', { paused: true })
  await p.sleep(600)

  const prods = await p.api('products.list')
  const fullId = prods.find((x) => x.name === 'Northwind Notes').id
  const emptyId = prods.find((x) => x.name === 'Lumen Reader').id
  const tabs = ['sources', 'passport', 'analysis', 'goal', 'channels', 'results']

  for (const t of ['dark', 'light']) {
    await theme(t)
    await p.size(1320, 880)
    const L = `${t}-1320`
    await p.go('#/attention', 900); await snap(`${L}-01-attention`)
    await p.go('#/products', 900); await snap(`${L}-02-products`)
    for (const tab of tabs) { await p.go(`#/products/${fullId}/${tab}`, 1000); await snap(`${L}-03-product-${tab}`) }
    await p.go(`#/products/${emptyId}/sources`, 1000); await snap(`${L}-03-product-empty-sources`)
    await p.go(`#/products/${emptyId}/passport`, 1000); await snap(`${L}-03-product-empty-passport`)
    await p.go('#/products', 600); if (await p.clickText('New product', 800)) await snap(`${L}-03-product-new`)
    await p.go('#/accounts', 900); await snap(`${L}-04-accounts`)
    await p.go('#/accounts/new', 900); await snap(`${L}-04-accounts-new`)
    await p.go('#/accounts', 700)
    for (const tab of ['Profiles', 'Mailboxes']) { await p.clickText(tab, 700); await snap(`${L}-04-accounts-${tab.toLowerCase()}`) }
    await p.go('#/opportunities', 900); await snap(`${L}-05-opportunities`)
    await p.go('#/publications', 900); await snap(`${L}-06-publications`)
    await p.go('#/logs', 900); await snap(`${L}-07-log-runs`)
    for (const tab of ['Action history', 'Events']) { await p.clickText(tab, 700); await snap(`${L}-07-log-${tab.toLowerCase().replace(' ', '-')}`) }
    await p.go('#/settings', 900); await snap(`${L}-08-settings`)
    // the menu hidden
    await p.go(`#/products/${fullId}/sources`, 800); await p.clickText('Hide menu', 600); await snap(`${L}-09-menu-hidden`); await p.clickText('Menu', 600)

    await p.size(980, 640)
    const S = `${t}-980`
    await p.go('#/attention', 900); await snap(`${S}-01-attention`)
    await p.go('#/products', 900); await snap(`${S}-02-products`)
    for (const tab of tabs) { await p.go(`#/products/${fullId}/${tab}`, 1000); await snap(`${S}-03-product-${tab}`) }
    await p.go('#/accounts', 900); await snap(`${S}-04-accounts`)
    await p.go('#/accounts/new', 900); await snap(`${S}-04-accounts-new`)
    await p.go('#/accounts', 700)
    for (const tab of ['Profiles', 'Mailboxes']) { await p.clickText(tab, 700); await snap(`${S}-04-accounts-${tab.toLowerCase()}`) }
    await p.go('#/opportunities', 900); await snap(`${S}-05-opportunities`)
    await p.go('#/publications', 900); await snap(`${S}-06-publications`)
    await p.go('#/logs', 900); await snap(`${S}-07-log-runs`)
    await p.go('#/settings', 900); await snap(`${S}-08-settings`)
  }

  // Full-length captures of the long screens (dark, 1320 wide) so every block of the page is on record.
  await theme('dark'); await p.size(1320, 880)
  for (const tab of tabs) { await p.go(`#/products/${fullId}/${tab}`, 1000); await p.fullShot(`${OUT}/full-dark-product-${tab}.png`) }
  await p.go('#/settings', 900); await p.fullShot(`${OUT}/full-dark-settings.png`)
  await p.go('#/accounts', 900); await p.fullShot(`${OUT}/full-dark-accounts.png`)

  fs.writeFileSync(`${outDir}/metrics.json`, JSON.stringify(metrics, null, 1))
  log('done ->', OUT)
} catch (e) {
  log('FAILED:', e.stack ?? e.message)
  fs.writeFileSync(`${outDir}/metrics.json`, JSON.stringify(metrics, null, 1))
} finally {
  p.stop()
}
