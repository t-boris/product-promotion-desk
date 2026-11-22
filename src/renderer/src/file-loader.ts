// What the file loader decides without the screen: how a chosen path is shown, which paths of a drop are taken, and the words for each purpose.

import type { FilePurpose } from '../../shared/types'

/** A path in two parts for the screen: the name of the file or folder, and the folder it is in. */
export function fileParts(path: string): { name: string; folder: string } {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return { name: trimmed, folder: '' }
  return { name: trimmed.slice(cut + 1) || trimmed, folder: trimmed.slice(0, cut) || trimmed.slice(0, cut + 1) }
}

const PICTURE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i

/** The purposes that take a picture only: a file of another kind is refused in words, not passed on. */
export function takesPicturesOnly(purpose: FilePurpose): boolean {
  return purpose === 'source_image' || purpose === 'picture' || purpose === 'pictures'
}

/** Whether the purpose is one thing (a file, a folder, a picture) or may be several files at once. */
export function takesMany(purpose: FilePurpose): boolean {
  return purpose === 'pictures' || purpose === 'material'
}

/**
 * The paths of what was dropped on the loader. A dropped file's path comes from the application's bridge (`pathOf`); a file it gives no path for (it was dragged
 * out of a browser, not from the file manager) is counted as skipped.
 */
export function pathsOfDrop(files: readonly File[], pathOf: ((file: File) => string) | undefined): { paths: string[]; skipped: number } {
  const paths: string[] = []
  let skipped = 0
  for (const file of files) {
    let path: string
    try {
      path = pathOf ? pathOf(file) : ''
    } catch {
      path = ''
    }
    if (path) paths.push(path)
    else skipped += 1
  }
  return { paths, skipped }
}

/**
 * What of the dropped paths the purpose takes: one thing unless the purpose takes many, and only pictures where it takes pictures. What is left out is said in one
 * sentence (never silently), so a dropped file that was not taken is not a mystery.
 */
export function acceptDrop(purpose: FilePurpose, paths: readonly string[], skipped = 0): { accepted: string[]; notice: string | null } {
  let accepted = [...paths]
  const notes: string[] = []
  if (skipped > 0) notes.push(skipped === 1 ? 'One item had no place on this computer and was left out.' : `${skipped} items had no place on this computer and were left out.`)
  if (takesPicturesOnly(purpose)) {
    const pictures = accepted.filter((path) => PICTURE_EXTENSION.test(path))
    if (pictures.length < accepted.length) notes.push('Only PNG, JPEG, GIF and WebP pictures can be chosen here.')
    accepted = pictures
  }
  if (!takesMany(purpose) && accepted.length > 1) {
    notes.push('One was taken: the first.')
    accepted = accepted.slice(0, 1)
  }
  return { accepted, notice: notes.length > 0 ? notes.join(' ') : null }
}

export interface LoaderWords {
  /** The button that opens the system's dialog. */
  choose: string
  /** The same button once something is chosen. */
  change: string
  /** What the area says before anything is chosen. */
  drop: string
  /** What the typed path is called where there is no dialog. */
  typed: string
}

export function loaderWords(purpose: FilePurpose): LoaderWords {
  switch (purpose) {
    case 'source_document':
      return { choose: 'Choose file…', change: 'Change…', drop: 'Drop a file here, or', typed: 'Path of the file' }
    case 'source_image':
      return { choose: 'Choose image…', change: 'Change…', drop: 'Drop an image here, or', typed: 'Path of the image' }
    case 'source_folder':
      return { choose: 'Choose folder…', change: 'Change…', drop: 'Drop the project folder here, or', typed: 'Path of the folder' }
    case 'picture':
      return { choose: 'Choose picture…', change: 'Change…', drop: 'Drop a picture here, or', typed: 'Path of the picture' }
    case 'pictures':
      return { choose: 'Choose pictures…', change: 'Choose more…', drop: 'Drop pictures here, or', typed: 'Path of a picture' }
    case 'material':
      return { choose: 'Choose files or a folder…', change: 'Add more…', drop: 'Drop files or a folder here, or', typed: 'Path of a file or a folder' }
  }
}
