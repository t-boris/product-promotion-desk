/* global setTimeout */
// Captures docs/design/macos/mock.html in real macOS windows (mock-window.mjs) and prints the layout facts of each shot.
// Each shot is screen:theme:width:height, e.g. products:dark:980:640. Only the windows of the Electron process this
// script started are captured (by pid), never another app's.
// Usage: node scripts/design/mock-capture.mjs <out dir outside the repo> products:dark:1320:880 settings:light:1320:880 ...
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const electron = createRequire(import.meta.url)('electron')
const mock = path.join(root, 'docs/design/macos/mock.html')
const [, , outDir, ...shots] = process.argv
fs.mkdirSync(outDir, { recursive: true })

for (const shot of shots) {
  const [screen, theme, w, h] = shot.split(':')
  const child = spawn(electron, [path.join(here, 'mock-window.mjs')], {
    env: { ...process.env, MOCK_ARGS: [mock, screen, theme, w, h].join('|') },
    stdio: ['ignore', 'pipe', 'ignore']
  })
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => {
      const text = String(data)
      for (const line of text.split('\n')) if (line.startsWith('METRICS ')) console.log(shot, line.slice(8))
      if (text.includes('READY')) resolve()
    })
    setTimeout(() => reject(new Error(`${shot}: the window did not load`)), 15000)
  })
  const win = execFileSync('swift', [path.join(here, 'winid.swift'), String(child.pid)], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((x) => x.layer === 0)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0]
  execFileSync('screencapture', ['-l', String(win.id), '-o', '-x', path.join(outDir, `mock-${screen}-${theme}-${w}.png`)])
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 600))
}
