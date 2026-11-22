import { describe, expect, it } from 'vitest'
import { FILE_PURPOSES } from '../shared/types'
import { dialogShape } from './file-dialogs'

describe('the system dialog for each purpose', () => {
  it('opens a folder dialog for a project folder and a file dialog for everything else', () => {
    expect(dialogShape('source_folder').properties).toEqual(['openDirectory'])
    for (const purpose of FILE_PURPOSES.filter((p) => p !== 'source_folder')) expect(dialogShape(purpose).properties).toContain('openFile')
  })

  it('lists every file for a source document and only pictures for the picture purposes', () => {
    expect(dialogShape('source_document').filters).toBeUndefined()
    for (const purpose of ['source_image', 'picture', 'pictures'] as const) {
      expect(dialogShape(purpose).filters).toEqual([{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }])
    }
  })

  it('lets the owner choose several files only for "pictures", and gives every dialog a title', () => {
    for (const purpose of FILE_PURPOSES) {
      expect(dialogShape(purpose).properties.includes('multiSelections')).toBe(purpose === 'pictures')
      expect(dialogShape(purpose).title).not.toBe('')
    }
  })
})
