// The decisions of "Make it from your material" in the new-publication form that need no screen: which paths are kept, which files the owner took out, what the length
// choices are called, when the post can be written, and what the owner is told about the files in words. Pure, so they are tested without the interface (lesson 101).

import type { MaterialFileInfo, MaterialKind, PostLength } from '../../../../shared/types'

/** The most paths (files and folders chosen) one post is made from: a folder holds the rest. */
export const MAX_MATERIAL_PATHS = 50
/** What the owner may say the post should be like, as the application takes it. */
export const MAX_BRIEF = 2000

/** The paths chosen so far with the newly chosen ones after them, each once, up to the limit. */
export function addPaths(current: readonly string[], chosen: readonly string[]): string[] {
  const next = [...current]
  for (const raw of chosen) {
    const path = raw.trim()
    if (path !== '' && !next.includes(path)) next.push(path)
  }
  return next.slice(0, MAX_MATERIAL_PATHS)
}

/** A file or a folder taken out of the choice. */
export const removePath = (current: readonly string[], path: string): string[] => current.filter((p) => p !== path)

/** A file left out of the reading: it is listed no more and not shown to the AI. Once. */
export const leaveOut = (excluded: readonly string[], path: string): string[] => (excluded.includes(path) ? [...excluded] : [...excluded, path])

export const LENGTHS: { value: PostLength; label: string; note: string }[] = [
  { value: 'short', label: 'Short', note: 'A few lines, one idea.' },
  { value: 'medium', label: 'Medium', note: 'An ordinary post.' },
  { value: 'long', label: 'Long article', note: 'Headings and sections, for telling something in detail.' }
]

export const lengthNote = (length: PostLength): string => LENGTHS.find((l) => l.value === length)?.note ?? ''

const KIND_WORDS: Record<MaterialKind, string> = { text: 'Document', picture: 'Picture', video: 'Video', other: 'Other' }
export const kindWord = (kind: MaterialKind): string => KIND_WORDS[kind]

/** A file's size the way a file manager says it. */
export function sizeWord(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** What a file is for in the post, in one line, so the owner knows what will happen to it. */
export function kindRole(kind: MaterialKind): string {
  switch (kind) {
    case 'text':
      return 'Read by the AI'
    case 'picture':
      return 'Can be placed in the post'
    case 'video':
      return 'Listed only: videos cannot be placed yet'
    case 'other':
      return 'Not used'
  }
}

/** Whether there is something for the AI to work from: a document or a picture that will be used, or the owner's own words. */
export function hasBasis(files: readonly Pick<MaterialFileInfo, 'kind'>[], brief: string): boolean {
  return brief.trim() !== '' || files.some((f) => f.kind === 'text' || f.kind === 'picture')
}

/** Why "Write the post" is off, in words; null when it can be pressed. */
export function writeReason(args: { files: readonly Pick<MaterialFileInfo, 'kind'>[]; brief: string; loading: boolean; busy: boolean; blocked: boolean }): string | null {
  if (args.blocked) return null
  if (args.busy) return null
  if (args.loading) return 'Reading your files…'
  if (!hasBasis(args.files, args.brief)) return 'Choose a document or pictures, or say what the post should be about.'
  return null
}

/** How many files of each kind are listed, in a row the owner can read at a glance, or null when nothing is listed. */
export function shownFiles<T>(files: readonly T[], limit: number): { shown: T[]; more: number } {
  return { shown: files.slice(0, limit), more: Math.max(0, files.length - limit) }
}
