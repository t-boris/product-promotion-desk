// Makes a smaller copy of a picture with Electron's own image support (no extra library). Used when a site refuses a profile picture for
// its size: the AI asks for "shrink_to_kb" and the application uploads this copy. The original is never changed.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import type { ImageShrinker } from '../core/ports'

const QUALITIES = [88, 78, 68, 56, 44]
/** Each round makes the picture this much smaller on its sides. */
const SCALE_STEP = 0.8
const MAX_ROUNDS = 8
const MIN_SIDE = 160

export class ElectronImageShrinker implements ImageShrinker {
  async shrink(source: string, maxBytes: number, outDir: string): Promise<string> {
    const original = nativeImage.createFromPath(source)
    if (original.isEmpty()) throw new Error('The picture could not be read.')
    const { width, height } = original.getSize()
    let scale = 1
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const side = Math.round(width * scale)
      if (round > 0 && Math.min(side, Math.round(height * scale)) < MIN_SIDE) break
      const current = scale === 1 ? original : original.resize({ width: side, quality: 'best' })
      for (const quality of QUALITIES) {
        const bytes = current.toJPEG(quality)
        if (bytes.length <= maxBytes) {
          await mkdir(outDir, { recursive: true })
          const path = join(outDir, `picture-${Math.round(maxBytes / 1024)}kb.jpg`)
          await writeFile(path, bytes)
          return path
        }
      }
      scale *= SCALE_STEP
    }
    throw new Error(`The picture cannot be made smaller than ${Math.round(maxBytes / 1024)} KB without becoming too small to be useful.`)
  }
}
