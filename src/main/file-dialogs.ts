// How the system's file dialog opens for each thing a file is chosen for (the `FilePurpose` of a screen): its title, what it lists and whether it takes a folder
// or many files. Pure, so the choice is tested without a dialog; the dialog itself is in media-tools.ts.

import type { FilePurpose } from '../shared/types'

export type DialogProperty = 'openFile' | 'openDirectory' | 'multiSelections'

export interface DialogShape {
  title: string
  properties: DialogProperty[]
  /** Absent: every file can be chosen. */
  filters?: { name: string; extensions: string[] }[]
}

const PICTURES = { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }

export function dialogShape(purpose: FilePurpose): DialogShape {
  switch (purpose) {
    case 'source_document':
      return { title: 'Choose a file', properties: ['openFile'] }
    case 'source_image':
      return { title: 'Choose an image', properties: ['openFile'], filters: [PICTURES] }
    case 'source_folder':
      return { title: 'Choose the project folder', properties: ['openDirectory'] }
    case 'picture':
      return { title: 'Choose a picture', properties: ['openFile'], filters: [PICTURES] }
    case 'pictures':
      return { title: 'Choose pictures', properties: ['openFile', 'multiSelections'], filters: [PICTURES] }
    case 'material':
      // The material of a post: any mix of documents, pictures, videos and folders (one dialog takes files and folders together on a Mac).
      return { title: 'Choose files or a folder for the post', properties: ['openFile', 'openDirectory', 'multiSelections'] }
  }
}
