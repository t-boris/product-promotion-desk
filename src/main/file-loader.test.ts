import { describe, expect, it } from 'vitest'
import { FILE_PURPOSES } from '../shared/types'
import { acceptDrop, fileParts, loaderWords, pathsOfDrop } from '../renderer/src/file-loader'

const file = (name: string): File => ({ name }) as File

describe('a chosen path, in two parts', () => {
  it('splits the name from the folder, and ignores a trailing separator on a folder', () => {
    expect(fileParts('/Users/you/Documents/price list.pdf')).toEqual({ name: 'price list.pdf', folder: '/Users/you/Documents' })
    expect(fileParts('/Users/you/code/site/')).toEqual({ name: 'site', folder: '/Users/you/code' })
    expect(fileParts('C:\\Users\\you\\face.png')).toEqual({ name: 'face.png', folder: 'C:\\Users\\you' })
  })

  it('keeps the root as the folder of a file at the root, and a bare name as it is', () => {
    expect(fileParts('/notes.md')).toEqual({ name: 'notes.md', folder: '/' })
    expect(fileParts('notes.md')).toEqual({ name: 'notes.md', folder: '' })
  })
})

describe('what a drop gives the loader', () => {
  it('takes the path the bridge gives for each file and counts the ones it gives none for', () => {
    const paths: Record<string, string> = { 'a.png': '/p/a.png', 'b.png': '/p/b.png' }
    const dropped = pathsOfDrop([file('a.png'), file('web.png'), file('b.png')], (f) => paths[f.name] ?? '')
    expect(dropped).toEqual({ paths: ['/p/a.png', '/p/b.png'], skipped: 1 })
  })

  it('takes nothing when there is no bridge, and when the bridge fails on a file', () => {
    expect(pathsOfDrop([file('a.png')], undefined)).toEqual({ paths: [], skipped: 1 })
    expect(
      pathsOfDrop([file('a.png')], () => {
        throw new Error('not a file')
      })
    ).toEqual({ paths: [], skipped: 1 })
  })

  it('takes one thing where the purpose is one thing, and says it took the first', () => {
    expect(acceptDrop('source_document', ['/p/a.md', '/p/b.md'])).toEqual({ accepted: ['/p/a.md'], notice: 'One was taken: the first.' })
    expect(acceptDrop('source_folder', ['/p/site'])).toEqual({ accepted: ['/p/site'], notice: null })
  })

  it('takes only pictures where the purpose is a picture, and says what was left out', () => {
    expect(acceptDrop('picture', ['/p/notes.md'])).toEqual({ accepted: [], notice: 'Only PNG, JPEG, GIF and WebP pictures can be chosen here.' })
    expect(acceptDrop('source_image', ['/p/a.PNG'])).toEqual({ accepted: ['/p/a.PNG'], notice: null })
    expect(acceptDrop('pictures', ['/p/a.png', '/p/b.txt', '/p/c.webp'])).toEqual({ accepted: ['/p/a.png', '/p/c.webp'], notice: 'Only PNG, JPEG, GIF and WebP pictures can be chosen here.' })
  })

  it('does not mistake a folder dropped on a document area for a problem of the loader: the core refuses it in words', () => {
    expect(acceptDrop('source_document', ['/p/site'])).toEqual({ accepted: ['/p/site'], notice: null })
  })

  it('names the items that had no place on this computer', () => {
    expect(acceptDrop('picture', ['/p/a.png'], 2).notice).toBe('2 items had no place on this computer and were left out.')
    expect(acceptDrop('picture', ['/p/a.png'], 1).notice).toBe('One item had no place on this computer and was left out.')
  })
})

describe('the words of the loader', () => {
  it('has a button and a drop sentence for every purpose', () => {
    for (const purpose of FILE_PURPOSES) {
      const words = loaderWords(purpose)
      expect(words.choose.endsWith('…')).toBe(true)
      expect(words.drop.endsWith(', or')).toBe(true)
      expect(words.typed).not.toBe('')
    }
  })
})
