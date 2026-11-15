// The size of a picture in pixels, read from its header (no image library). Null when the header does not say, so a picture is never refused for it.

const u16be = (b: Buffer, at: number): number => b.readUInt16BE(at)

export function imageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return bytes.length >= 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null
    if (mime === 'image/gif') return bytes.length >= 10 ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) } : null
    if (mime === 'image/jpeg') return jpegSize(bytes)
    if (mime === 'image/webp') return webpSize(bytes)
  } catch {
    return null
  }
  return null
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at += 1
      continue
    }
    const marker = b[at + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const length = u16be(b, at + 2)
    // SOF0..SOF15 except DHT (c4), JPG (c8) and DAC (cc) carry the frame size
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(b, at + 5), width: u16be(b, at + 7) }
    if (length < 2) return null
    at += 2 + length
  }
  return null
}

function webpSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30) return null
  const kind = b.subarray(12, 16).toString('latin1')
  if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (kind === 'VP8X') return { width: (b.readUIntLE(24, 3) & 0xffffff) + 1, height: (b.readUIntLE(27, 3) & 0xffffff) + 1 }
  return null
}
