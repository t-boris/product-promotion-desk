import { describe, expect, it } from 'vitest'
import { TRAY_ICON_1X, TRAY_ICON_2X } from './tray-icon'

/** Width, height and colour type of a PNG, read from its header. */
function header(base64: string): { signature: string; width: number; height: number; colorType: number } {
  const bytes = Buffer.from(base64, 'base64')
  return { signature: bytes.subarray(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

describe('the menu-bar icon', () => {
  it('is a PNG of 18 pt: 18 px for a plain screen and 36 px for a Retina one, with a transparent background', () => {
    expect(header(TRAY_ICON_1X)).toEqual({ signature: '89504e470d0a1a0a', width: 18, height: 18, colorType: 6 })
    expect(header(TRAY_ICON_2X)).toEqual({ signature: '89504e470d0a1a0a', width: 36, height: 36, colorType: 6 })
  })
})
