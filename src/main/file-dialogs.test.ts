import { describe, expect, it } from 'vitest'
import { FILE_PURPOSES } from '../shared/types'
import { dialogShape } from './file-dialogs'

describe('the system dialog for each purpose', () => {
  it('lists pictures and videos together for what a post carries, and each kind on its own', () => {
    const filters = dialogShape('attachments').filters ?? []
    expect(filters.map((f) => f.name)).toEqual(['Pictures and videos', 'Pictures', 'Videos'])
    expect(filters[0].extensions).toEqual(expect.arrayContaining(['png', 'webp', 'mp4', 'm4v', 'mov', 'webm']))
    expect(filters[2].extensions).toEqual(['mp4', 'm4v', 'mov', 'webm'])
  })

  it('opens a folder dialog for a project folder and a file dialog for everything else', () => {
    expect(dialogShape('source_folder').properties).toEqual(['openDirectory'])
    for (const purpose of FILE_PURPOSES.filter((p) => p !== 'source_folder')) expect(dialogShape(purpose).properties).toContain('openFile')
    // The material of a post is files and folders together.
    expect(dialogShape('material').properties).toEqual(['openFile', 'openDirectory', 'multiSelections'])
    expect(dialogShape('material').filters).toBeUndefined()
  })

  it('lists every file for a source document and only pictures for the picture purposes', () => {
    expect(dialogShape('source_document').filters).toBeUndefined()
    for (const purpose of ['source_image', 'picture', 'pictures'] as const) {
      expect(dialogShape(purpose).filters).toEqual([{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }])
    }
  })

  it('lets the owner choose several files only for "pictures" and the material of a post, and gives every dialog a title', () => {
    for (const purpose of FILE_PURPOSES) {
      expect(dialogShape(purpose).properties.includes('multiSelections')).toBe(purpose === 'pictures' || purpose === 'attachments' || purpose === 'material')
      expect(dialogShape(purpose).title).not.toBe('')
    }
  })
})
