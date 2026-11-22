import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeMaterial, materialKind, MATERIAL_LIMITS, readMaterial } from './post-material'

let root: string
const made = (): string => (root = mkdtempSync(join(tmpdir(), 'ppd-material-')))
const put = (relative: string, content: string | Buffer = 'x'): string => {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}
afterEach(() => root && rmSync(root, { recursive: true, force: true }))

describe('what kind of file it is', () => {
  it('knows documents, the pictures a post can carry, videos and everything else', () => {
    expect(materialKind('/a/story.md')).toBe('text')
    expect(materialKind('/a/notes.TXT')).toBe('text')
    expect(materialKind('/a/chart.PNG')).toBe('picture')
    expect(materialKind('/a/chart.webp')).toBe('picture')
    expect(materialKind('/a/clip.mp4')).toBe('video')
    expect(materialKind('/a/clip.MOV')).toBe('video')
    expect(materialKind('/a/deck.pdf')).toBe('other')
    // A picture format the library cannot hold is not offered as a picture.
    expect(materialKind('/a/photo.heic')).toBe('other')
  })
})

describe('reading a folder', () => {
  it('lists files before sub-folders, each in natural order, with the path from the chosen folder', () => {
    made()
    put('b.md', '# B')
    put('photo 10.png')
    put('photo 2.png')
    put('clips/launch.mp4')
    put('a.txt', 'A')
    const read = readMaterial([root])
    expect(read.files.map((f) => f.relative)).toEqual(['a.txt', 'b.md', 'photo 2.png', 'photo 10.png', join('clips', 'launch.mp4')])
    expect(read.files.map((f) => f.kind)).toEqual(['text', 'text', 'picture', 'picture', 'video'])
    expect(describeMaterial(read)).toBe('2 documents, 2 pictures, 1 video')
  })

  it('reads the text of the documents and masks what looks like a secret', () => {
    made()
    put('story.md', 'We built a chart tool. key: sk-live-abcdefghijklmnopqrstuvwx')
    const read = readMaterial([root])
    expect(read.texts).toHaveLength(1)
    expect(read.texts[0].relative).toBe('story.md')
    expect(read.texts[0].text).toContain('We built a chart tool.')
    expect(read.texts[0].text).not.toContain('sk-live-abcdefghijklmnopqrstuvwx')
  })

  it('leaves out secret-looking files, hidden files and dependency folders, and says so for the secret', () => {
    made()
    put('story.md', 'Hello')
    put('.env', 'TOKEN=abc')
    put('.hidden.md', 'no')
    put('node_modules/pkg/readme.md', 'no')
    put('config/credentials.json', '{}')
    const read = readMaterial([root])
    expect(read.files.map((f) => f.relative)).toEqual(['story.md'])
    expect(read.skipped.some((s) => s.relative.includes('credentials') && /secret/.test(s.reason))).toBe(true)
  })

  it('does not follow a link inside a folder', () => {
    made()
    const outside = mkdtempSync(join(tmpdir(), 'ppd-material-out-'))
    writeFileSync(join(outside, 'private.md'), 'private')
    put('story.md', 'Hello')
    symlinkSync(join(outside, 'private.md'), join(root, 'link.md'))
    const read = readMaterial([root])
    expect(read.files.map((f) => f.relative)).toEqual(['story.md'])
    rmSync(outside, { recursive: true, force: true })
  })

  it('stops at the depth and the file count and says the folder held more', () => {
    made()
    put('a/b/c/d/deep.md', 'deep')
    put('top.md', 'top')
    expect(readMaterial([root]).cut).toBe(true)
    expect(readMaterial([root]).files.map((f) => f.relative)).toEqual(['top.md'])
    const small = { ...MATERIAL_LIMITS, maxFiles: 2, maxDepth: 5 }
    put('one.md')
    put('two.md')
    const limited = readMaterial([root], small)
    expect(limited.files).toHaveLength(2)
    expect(limited.cut).toBe(true)
  })

  it('shows the AI only as much text as the budget allows and says what did not fit', () => {
    made()
    put('a.md', 'a'.repeat(30_000))
    put('b.md', 'b'.repeat(30_000))
    put('c.md', 'c'.repeat(30_000))
    put('d.md', 'd'.repeat(30_000))
    const read = readMaterial([root], { ...MATERIAL_LIMITS, textPerFile: 1000, textTotal: 2500 })
    expect(read.texts.map((t) => t.text.length)).toEqual([1000, 1000, 500])
    expect(read.texts.every((t) => t.truncated)).toBe(true)
    expect(read.skipped.some((s) => s.relative === 'd.md')).toBe(true)
  })
})

describe('reading files chosen one by one', () => {
  it('takes files and folders in the order given and counts a file once', () => {
    made()
    const first = put('z.md', 'Z')
    put('a/inner.md', 'inner')
    const read = readMaterial([first, join(root, 'a'), first])
    expect(read.files.map((f) => f.relative)).toEqual(['z.md', 'inner.md'])
  })

  it('leaves out the files the owner took out of the list', () => {
    made()
    const keep = put('keep.md', 'keep')
    const drop = put('drop.png')
    const read = readMaterial([root], MATERIAL_LIMITS, new Set([drop]))
    expect(read.files.map((f) => f.path)).toEqual([keep])
  })

  it('names a path that is not absolute or does not exist instead of ignoring it', () => {
    made()
    const read = readMaterial(['relative/path.md', join(root, 'missing.md')])
    expect(read.files).toEqual([])
    expect(read.skipped.map((s) => s.reason)).toEqual(['it is not a full path', 'it does not exist or cannot be read'])
  })

  it('says there is nothing usable when nothing was found', () => {
    made()
    expect(describeMaterial(readMaterial([root]))).toBe('nothing usable')
  })
})
