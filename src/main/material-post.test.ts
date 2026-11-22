import { describe, expect, it } from 'vitest'
import { acceptDrop, loaderWords, takesMany } from '../renderer/src/file-loader'
import { addPaths, hasBasis, kindRole, kindWord, leaveOut, lengthNote, MAX_MATERIAL_PATHS, removePath, shownFiles, sizeWord, writeReason } from '../renderer/src/pages/review/material-post'

describe('the paths of the material', () => {
  it('adds what was chosen after what is there, each once, and trims', () => {
    expect(addPaths(['/a/one.md'], [' /a/two.png ', '/a/one.md', ''])).toEqual(['/a/one.md', '/a/two.png'])
  })

  it('keeps at most the limit', () => {
    const many = Array.from({ length: MAX_MATERIAL_PATHS + 10 }, (_, i) => `/p/${i}.md`)
    expect(addPaths([], many)).toHaveLength(MAX_MATERIAL_PATHS)
  })

  it('removes a path, and leaves a file out once', () => {
    expect(removePath(['/a', '/b'], '/a')).toEqual(['/b'])
    expect(leaveOut(['/a'], '/b')).toEqual(['/a', '/b'])
    expect(leaveOut(['/a'], '/a')).toEqual(['/a'])
  })
})

describe('the file loader takes the material of a post', () => {
  it('takes many files and folders, nothing is filtered out, and the words say so', () => {
    expect(takesMany('material')).toBe(true)
    expect(acceptDrop('material', ['/a/story.md', '/a/shots', '/a/clip.mp4']).accepted).toEqual(['/a/story.md', '/a/shots', '/a/clip.mp4'])
    expect(acceptDrop('material', ['/a/story.md']).notice).toBeNull()
    expect(loaderWords('material').choose).toBe('Choose files or a folder…')
  })
})

describe('words for the files', () => {
  it('names the kinds and what happens to each', () => {
    expect(kindWord('text')).toBe('Document')
    expect(kindRole('picture')).toMatch(/placed in the post/)
    expect(kindRole('video')).toMatch(/cannot be placed yet/)
    expect(kindRole('other')).toBe('Not used')
    expect(lengthNote('long')).toMatch(/Headings/)
  })

  it('says sizes the way a file manager does', () => {
    expect(sizeWord(512)).toBe('512 B')
    expect(sizeWord(2048)).toBe('2 KB')
    expect(sizeWord(1536 * 1024)).toBe('1.5 MB')
    expect(sizeWord(25 * 1024 * 1024)).toBe('25 MB')
  })

  it('shows the first files and counts the rest', () => {
    expect(shownFiles([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 })
    expect(shownFiles([1], 3)).toEqual({ shown: [1], more: 0 })
  })
})

describe('when the post can be written', () => {
  const doc = [{ kind: 'text' as const }]
  const video = [{ kind: 'video' as const }]
  it('needs a document, a picture or the owner\'s own words', () => {
    expect(hasBasis(doc, '')).toBe(true)
    expect(hasBasis([{ kind: 'picture' }], '')).toBe(true)
    expect(hasBasis(video, '')).toBe(false)
    expect(hasBasis([], '   ')).toBe(false)
    expect(hasBasis(video, 'A welcome')).toBe(true)
  })

  it('says why not, and says nothing while it is blocked or busy (those have their own words)', () => {
    expect(writeReason({ files: [], brief: '', loading: false, busy: false, blocked: false })).toMatch(/Choose a document/)
    expect(writeReason({ files: doc, brief: '', loading: true, busy: false, blocked: false })).toBe('Reading your files…')
    expect(writeReason({ files: doc, brief: '', loading: false, busy: false, blocked: false })).toBeNull()
    expect(writeReason({ files: [], brief: '', loading: false, busy: true, blocked: false })).toBeNull()
    expect(writeReason({ files: [], brief: '', loading: false, busy: false, blocked: true })).toBeNull()
  })
})
