/* global fetch, WebSocket, Buffer, setTimeout */
// Design probe helpers (docs/design/macos/visual-system.md). Drives ONE own instance of the app (own PPD_DATA_DIR, own
// debugging port) through the Chromium DevTools protocol. Never touches the owner's running app: it launches its own
// process and signals only that pid (lesson 92). Dev tool only: electron-builder packages out/** and nothing here.
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function start({ app, args = [], cwd, dataDir, port = 9333, fresh = true, env = {} }) {
  if (fresh) fs.rmSync(dataDir, { recursive: true, force: true })
  const child = spawn(app, [...args, `--remote-debugging-port=${port}`], { cwd, env: { ...process.env, PPD_DATA_DIR: dataDir, ...env }, stdio: 'ignore' })
  let target
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
    } catch {
      // not listening yet
    }
    if (!target) await sleep(500)
  }
  if (!target) { child.kill(); throw new Error('no page target') }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id)
      pending.delete(d.id)
      if (d.error) rej(new Error(JSON.stringify(d.error)))
      else res(d.result)
    }
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const api = async (method, args) => {
    const r = await ev(`window.ppd.invoke(${JSON.stringify(method)}, ${JSON.stringify(args ?? null)})`)
    if (!r.ok) throw new Error(`${method}: ${r.error.code} ${r.error.message}`)
    return r.result
  }
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const go = async (hash, wait = 700) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(wait) }
  const clickText = async (text, wait = 500, scope = 'document') => {
    const ok = await ev(`(() => { const els = [...${scope}.querySelectorAll('button,a,[role=tab],label,summary')]; const e = els.find((x) => x.textContent.trim() === ${JSON.stringify(text)}) ?? els.find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) return false; e.click(); return true })()`)
    await sleep(wait); return ok
  }
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')) }
  const fullShot = async (file) => {
    // the page content scrolls inside .content: capture it whole by growing the viewport to the content height
    const h = await ev(`(() => { const c = document.querySelector('.content'); return c ? c.scrollHeight + (document.querySelector('.topbar')?.offsetHeight ?? 0) : document.body.scrollHeight })()`)
    const w = await ev('window.innerWidth')
    await size(w, Math.min(Math.max(h, 640), 3000)); await sleep(250); await shot(file); await size(w, 880); await sleep(150)
  }
  const stop = () => {
    try {
      ws.close()
    } catch {
      // already closed
    }
    child.kill()
  }
  return { child, send, ev, api, size, go, clickText, shot, fullShot, stop, sleep }
}

// In-page measurement of the controls of the current screen (the "sweep" of lesson 12/25).
export const MEASURE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const controls = [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a.btn, [role=tab]')].filter(vis).map((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e)
    return { tag: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), role: e.getAttribute('role'), link: e.classList.contains('link-btn'), track: !!e.closest('.segmented, .tabs'), text: (e.textContent || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height), fs: cs.fontSize }
  })
  // A tab is a segment inside a 28px track (the track is the control, §7); a segment of a segmented track is 24px inside the 28px track (§7); a link-styled button is inline text like a link.
  const smallList = controls.filter((c) => c.h < 28 && !/checkbox|radio/.test(c.tag) && c.role !== 'tab' && !c.link && !c.track)
  const small = smallList.length
  const tiny = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() && vis(e) && parseFloat(getComputedStyle(e).fontSize) < 12).length
  const wrapped = controls.filter((c) => /button|a/.test(c.tag.split(':')[0]) && c.h > 44 && !c.tag.startsWith('textarea')).map((c) => c.text)
  return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || (document.querySelector('.content') ? document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth + 1 : false), controls: controls.length, smallControls: small, smallList: smallList.map((c) => c.tag + ' ' + c.h + 'px ' + c.text), tinyTextNodes: tiny, tallButtons: wrapped, route: location.hash }
})()`

// Extra facts a visual spec needs, on top of the sweep of lesson 12/25.
export const LOOK = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const content = document.querySelector('.content')
  const primaries = [...document.querySelectorAll('.btn-primary')].filter(vis).map((b) => b.textContent.trim())
  const sizes = new Map()
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.children.length || !e.textContent.trim()) continue
    const k = getComputedStyle(e).fontSize; sizes.set(k, (sizes.get(k) ?? 0) + 1)
  }
  const sb = document.querySelector('.sidebar')?.getBoundingClientRect()
  const tb = document.querySelector('.topbar')?.getBoundingClientRect()
  const cut = [...document.querySelectorAll('button, a.btn, [role=tab]')].filter(vis).filter((b) => {
    const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 1 || b.scrollWidth > b.clientWidth + 1
  }).map((b) => b.textContent.trim().slice(0, 30))
  // What sits under the window buttons (x < 84, y < 40; the buttons end near x = 72 and --window-buttons-w is 84): only drag area may be there.
  const underLights = [...document.querySelectorAll('button, a, input, select, [role=tab], h1, h2, strong, span')].filter(vis).filter((e) => {
    const r = e.getBoundingClientRect(); return r.left < 84 && r.top < 40 && r.bottom > 6
  }).map((e) => (e.textContent || e.tagName).trim().slice(0, 20))
  return {
    font: getComputedStyle(document.body).fontFamily.slice(0, 60),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    sidebarBg: document.querySelector('.sidebar') ? getComputedStyle(document.querySelector('.sidebar')).backgroundColor : null,
    sidebarW: sb ? Math.round(sb.width) : 0,
    topbarH: tb ? Math.round(tb.height) : 0,
    contentScrollW: content ? content.scrollWidth - content.clientWidth : null,
    contentScrollH: content ? content.scrollHeight - content.clientHeight : null,
    primaries,
    // V-18: where the first tab row (a channel's or an account's) ends and how many rows the launch path takes, where one is shown (the Inbox checklist).
    tabsBottom: document.querySelector('.content .tabs') ? Math.round(document.querySelector('.content .tabs').getBoundingClientRect().bottom) : null,
    pathRows: document.querySelector('.content .launch-path') ? new Set([...document.querySelectorAll('.content .launch-stage')].map((e) => Math.round(e.getBoundingClientRect().top))).size : null,
    fontSizes: Object.fromEntries([...sizes.entries()].sort()),
    cutButtons: cut,
    underLights
  }
})()`
