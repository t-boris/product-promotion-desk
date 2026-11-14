/* global setTimeout */
// Electron main process that shows docs/design/macos/mock.html in a real macOS window: hiddenInset title bar, the
// window buttons where the spec puts them, and the sidebar vibrancy material. Started by mock-capture.mjs, one window
// per shot; it prints METRICS (layout facts measured in the page) and READY, and quits by itself after 20 seconds.
import { app, BrowserWindow, nativeTheme } from 'electron'
import { pathToFileURL } from 'node:url'

const [file, screen, theme, w, h] = (process.env.MOCK_ARGS ?? '').split('|')

const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect()
  const vis = (e) => r(e).width > 1 && r(e).height > 1
  const shown = '[data-screen]:not([hidden])'
  const bar = [...document.querySelectorAll('.toolbar > *')].filter(vis).map((e) => ({ l: Math.round(r(e).left), r: Math.round(r(e).right) }))
  let overlap = false
  for (let i = 1; i < bar.length; i++) if (bar[i].l < bar[i - 1].r - 0.5) overlap = true
  const content = document.querySelector('.content')
  const tabs = document.querySelector(shown + ' .segmented')
  return {
    toolbarOverlap: overlap,
    pathRows: new Set([...document.querySelectorAll(shown + ' .stage')].map((e) => Math.round(r(e).top))).size,
    groupTitleHeights: [...new Set([...document.querySelectorAll(shown + ' .group-head h3')].map((e) => Math.round(r(e).height)))],
    contentHScroll: content.scrollWidth > content.clientWidth + 1,
    tabsBottom: tabs ? Math.round(r(tabs).bottom) : null,
    fontSizes: [...new Set([...document.querySelectorAll('body *')].filter((e) => vis(e) && !e.children.length && e.textContent.trim()).map((e) => getComputedStyle(e).fontSize))].sort()
  }
})()`

app.whenReady().then(() => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'
  const win = new BrowserWindow({
    width: Number(w),
    height: Number(h),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000'
  })
  const url = pathToFileURL(file)
  url.search = `?screen=${screen}&chrome=native`
  void win.loadURL(url.href)
  win.webContents.on('did-finish-load', () =>
    setTimeout(async () => {
      console.log('METRICS ' + JSON.stringify(await win.webContents.executeJavaScript(MEASURE)))
      console.log('READY')
    }, 1200)
  )
  setTimeout(() => app.quit(), 20000)
})
