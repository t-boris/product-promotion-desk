// Native window captures (docs/design/macos/visual-system.md). The window buttons, the title-bar band and the sidebar
// material are drawn by macOS, so only a capture of the real window shows them. Reuses the data folder that tour.mjs
// seeded in <out dir> (fresh: false), starts ONE own instance, resizes ITS window through System Events aimed at its pid
// (never at the process name, lesson 92) and captures it with `screencapture -l` (lesson 109).
// Usage: node scripts/design/native.mjs "<app>/Contents/MacOS/Product Promotion Desk" <out dir of tour.mjs> [prefix] [port]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { start } from './lib.mjs'

const [, , appPath, outDir, prefix = 'native', port = '9372'] = process.argv
const OUT = `${outDir}/shots`
fs.mkdirSync(OUT, { recursive: true })
const here = path.dirname(fileURLToPath(import.meta.url))
const p = await start({ app: appPath, dataDir: `${outDir}/data`, port: Number(port), fresh: false })
const windows = () =>
  execFileSync('swift', [path.join(here, 'winid.swift'), String(p.child.pid)], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((w) => w.layer === 0)
    .sort((a, b) => b.w * b.h - a.w * a.h)
const resize = (w, h) =>
  execFileSync('osascript', ['-e', `tell application "System Events" to tell (first process whose unix id is ${p.child.pid}) to set size of window 1 to {${w}, ${h}}`])
try {
  await p.sleep(1800)
  const products = await p.api('products.list')
  const id = (products.find((x) => x.name === 'Northwind Notes') ?? products[0]).id
  for (const [w, h] of [
    [1320, 880],
    [980, 640]
  ]) {
    resize(w, h)
    for (const [name, hash] of [
      ['passport', `#/products/${id}/passport`],
      ['attention', '#/attention']
    ]) {
      await p.go(hash, 1200)
      const win = windows()[0]
      if (!win) {
        console.log('no window of pid', p.child.pid)
        continue
      }
      execFileSync('screencapture', ['-l', String(win.id), '-o', '-x', `${OUT}/${prefix}-${w}-${name}.png`])
      console.log('native', w, h, name)
    }
  }
} catch (e) {
  console.log('FAILED:', e.stack ?? e.message)
} finally {
  p.stop()
}
