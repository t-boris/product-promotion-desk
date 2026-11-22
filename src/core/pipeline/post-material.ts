// The material a post is made from (the owner gives a file, several files or a folder): what is in it, in the order the owner would read it, and the text of the
// documents within a budget. The application reads it, never the AI: the AI is handed what was read and a list of the pictures and videos, so it never opens a path
// of its own and nothing outside what the owner chose is touched.
//
// What is read stays the owner's own: secret-looking files are left out (the same refusal as a product's documents), strings that look like secrets are masked, a
// link inside a folder that points elsewhere is not followed, and a folder is walked only so far (depth, number of files, size of text) so a huge folder cannot swamp
// the AI or the screen. What was left out is counted and said, never silent.

import { lstatSync, readdirSync, realpathSync, statSync, type Stats } from 'node:fs'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { classifyDocument, readDocumentText } from '../passports/documents'
import { secretFileReason } from '../passports/redact'
import type { MaterialKind } from '../../shared/types'

/** The pictures a post can carry (the library's formats) and the videos the application knows. */
const PICTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])

export const MATERIAL_LIMITS = {
  /** Files listed in all; a bigger folder is cut here and the cut is said. */
  maxFiles: 300,
  /** Folders below the chosen one that are walked. */
  maxDepth: 3,
  /** Documents whose text is read. */
  maxTexts: 12,
  /** Characters kept of one document, and of all of them together: what the AI is shown. */
  textPerFile: 12_000,
  textTotal: 48_000
} as const

export interface MaterialLimits {
  maxFiles: number
  maxDepth: number
  maxTexts: number
  textPerFile: number
  textTotal: number
}

export interface MaterialFile {
  /** The absolute path, as the owner's computer has it. */
  path: string
  name: string
  /** Where it is, from the folder the owner chose (the file's own name for a file chosen alone). */
  relative: string
  kind: MaterialKind
  size: number
}

export interface MaterialText {
  relative: string
  text: string
  /** The document is longer than what is kept. */
  truncated: boolean
}

export interface MaterialRead {
  files: MaterialFile[]
  texts: MaterialText[]
  /** Left out, and why (a secret-looking file, an unreadable one, the limits). */
  skipped: { relative: string; reason: string }[]
  /** The folder held more than was listed. */
  cut: boolean
}

export function materialKind(path: string): MaterialKind {
  const extension = extname(path).toLowerCase()
  if (PICTURE_EXTENSIONS.has(extension)) return 'picture'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return classifyDocument(path) === 'text' ? 'text' : 'other'
}

const SKIPPED_FOLDERS = new Set(['node_modules', '.git', '.svn', '.hg', '__MACOSX'])

/** Natural order, as a person sorts file names: "photo 2" before "photo 10". */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/**
 * Reads what the owner chose: each path is a file or a folder. A path that is not absolute, does not exist or is a secret-looking file is left out with its reason.
 * Order is the order the owner gave, and inside a folder files come before sub-folders, each by name. Files the owner took out of the list (`exclude`, by path) are not read.
 */
export function readMaterial(paths: readonly string[], limits: MaterialLimits = MATERIAL_LIMITS, exclude: ReadonlySet<string> = new Set()): MaterialRead {
  const files: MaterialFile[] = []
  const skipped: MaterialRead['skipped'] = []
  let cut = false
  const seen = new Set<string>()

  const add = (path: string, shown: string, size: number): void => {
    if (exclude.has(path)) return
    const real = safeReal(path)
    if (real === null) {
      skipped.push({ relative: shown, reason: 'it cannot be read' })
      return
    }
    if (seen.has(real)) return
    const secret = secretFileReason(path) ?? secretFileReason(real)
    if (secret) {
      skipped.push({ relative: shown, reason: `it looks like a secret (${secret})` })
      return
    }
    if (files.length >= limits.maxFiles) {
      cut = true
      return
    }
    seen.add(real)
    files.push({ path, name: basename(path), relative: shown, kind: materialKind(path), size })
  }

  const walk = (folder: string, root: string, depth: number): void => {
    let names: string[]
    try {
      names = readdirSync(folder)
    } catch {
      skipped.push({ relative: relative(root, folder) || basename(folder), reason: 'the folder cannot be read' })
      return
    }
    const entries: { name: string; full: string; stat: Stats }[] = []
    for (const name of names) {
      if (name.startsWith('.') || SKIPPED_FOLDERS.has(name)) continue
      const full = join(folder, name)
      try {
        // A link inside a folder is not followed: it may point anywhere on the computer.
        const stat: Stats = lstatSync(full)
        if (!stat.isSymbolicLink()) entries.push({ name, full, stat })
      } catch {
        // A file that vanished or cannot be read is simply not listed.
      }
    }
    for (const entry of entries.filter((e) => e.stat.isFile()).sort((a, b) => byName(a.name, b.name))) add(entry.full, relative(root, entry.full), entry.stat.size)
    if (depth >= limits.maxDepth) {
      if (entries.some((e) => e.stat.isDirectory())) cut = true
      return
    }
    for (const entry of entries.filter((e) => e.stat.isDirectory()).sort((a, b) => byName(a.name, b.name))) walk(entry.full, root, depth + 1)
  }

  for (const path of paths) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      skipped.push({ relative: String(path), reason: 'it is not a full path' })
      continue
    }
    let stat
    try {
      // The owner chose this path on purpose, so a link is followed here.
      stat = statSync(path)
    } catch {
      skipped.push({ relative: basename(path), reason: 'it does not exist or cannot be read' })
      continue
    }
    if (stat.isDirectory()) walk(path, path, 0)
    else if (stat.isFile()) add(path, basename(path), stat.size)
    else skipped.push({ relative: basename(path), reason: 'it is neither a file nor a folder' })
  }

  return { files, texts: readTexts(files, limits, skipped), skipped, cut }
}

function safeReal(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** The text of the documents, in listing order, until the budget is spent; what did not fit is said as skipped. */
function readTexts(files: readonly MaterialFile[], limits: MaterialLimits, skipped: MaterialRead['skipped']): MaterialText[] {
  const texts: MaterialText[] = []
  let total = 0
  for (const file of files) {
    if (file.kind !== 'text') continue
    if (texts.length >= limits.maxTexts || total >= limits.textTotal) {
      skipped.push({ relative: file.relative, reason: 'the AI is shown only the first documents' })
      continue
    }
    const read = readDocumentText(file.path)
    if (!read || read.text.trim() === '') {
      skipped.push({ relative: file.relative, reason: 'it has no readable text' })
      continue
    }
    const room = Math.min(limits.textPerFile, limits.textTotal - total)
    const text = read.text.length > room ? read.text.slice(0, room) : read.text
    total += text.length
    texts.push({ relative: file.relative, text, truncated: read.truncated || text.length < read.text.length })
  }
  return texts
}

/** A short count of what was found, for the screen: "2 documents, 14 pictures, 1 video". */
export function describeMaterial(read: Pick<MaterialRead, 'files'>): string {
  const count = (kind: MaterialKind): number => read.files.filter((f) => f.kind === kind).length
  const part = (n: number, one: string, many: string): string | null => (n === 0 ? null : `${n} ${n === 1 ? one : many}`)
  const parts = [part(count('text'), 'document', 'documents'), part(count('picture'), 'picture', 'pictures'), part(count('video'), 'video', 'videos'), part(count('other'), 'other file', 'other files')].filter(
    (p): p is string => p !== null
  )
  return parts.length === 0 ? 'nothing usable' : parts.join(', ')
}
