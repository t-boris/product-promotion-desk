// Pictures on the screen (DEC-030): small copies come from the main process as data addresses (the page may show nothing else), and are
// remembered for the session; a picture of the library never changes, so a copy is never stale.

import { useEffect, useState } from 'react'
import type { MediaItem, MediaOrigin } from '../../../../shared/types'
import { call } from '../../hooks'

const copies = new Map<string, Promise<string | null>>()

export function loadThumb(id: string, side: number): Promise<string | null> {
  const key = `${id}:${side}`
  let copy = copies.get(key)
  if (!copy) {
    copy = call('media.thumb', { id, side })
      .then((result) => result?.dataUrl ?? null)
      .catch(() => null)
    copies.set(key, copy)
    // A picture that could not be shown is asked for again next time.
    void copy.then((url) => {
      if (url === null) copies.delete(key)
    })
  }
  return copy
}

/** The small copy of a picture: `undefined` while it loads, `null` when there is none (the file is gone, a deleted post's picture was cleared). */
export function useThumb(id: string | null | undefined, side = 160): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    setUrl(id ? undefined : null)
    if (id) void loadThumb(id, side).then((value) => current && setUrl(value))
    return () => {
      current = false
    }
  }, [id, side])
  return url
}

/** The small copies of several pictures, by id. */
export function useThumbs(ids: string[], side = 160): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = ids.join(',')
  useEffect(() => {
    let current = true
    for (const id of ids) {
      void loadThumb(id, side).then((value) => {
        if (current && value) setUrls((all) => (all[id] === value ? all : { ...all, [id]: value }))
      })
    }
    return () => {
      current = false
    }
  }, [key, side])
  return urls
}

/** The bytes of a file as base64, without the data address in front. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`${file.name || 'The picture'} could not be read.`))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

const MAX_BYTES = 10 * 1024 * 1024

/** Adds pasted or dropped pictures to the library; the ones that could not be added are named, with the reason, and the rest still go in. */
export async function addImageFiles(productId: string, files: File[], origin: Exclude<MediaOrigin, 'generated'>): Promise<{ items: MediaItem[]; refused: string[] }> {
  const items: MediaItem[] = []
  const refused: string[] = []
  for (const file of files) {
    const name = file.name || 'picture.png'
    if (file.size > MAX_BYTES) {
      refused.push(`${name}: larger than ${MAX_BYTES / 1024 / 1024} MB.`)
      continue
    }
    try {
      items.push(await call('media.add', { productId, name, base64: await fileToBase64(file), origin }))
    } catch (error) {
      refused.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { items, refused }
}
