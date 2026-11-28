import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FilePlace, FilePlaceState } from '../../shared/types'
import { ApiError } from '../../shared/api'
import type { Core } from '../core'
import { newId } from '../db/database'
import { HttpNoAnswerError } from '../net/http'
import { S3Store, placeProblem } from '../net/s3'
import type { HttpFile, PublicFile, PublicFiles } from '../ports'

/** The setting that holds the place (everything but the secret key), and the vault entry of the secret key. */
export const FILE_PLACE_SETTING = 'filePlace'
export const FILE_PLACE_SECRET = 'fileplace:secret'
/** How long the address of a put file works: the platform reads the file within minutes of being given it. */
export const PUBLIC_ADDRESS_SECONDS = 3600

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** A file's name as part of an object's key: its letters, digits, dots and hyphens, so the address needs no guessing. */
const safeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file'

/**
 * A place for files on a public address (D5 of the publishing plan, DEC-081): a storage bucket of the owner's own. A platform that takes a
 * picture or a video only from an address on the internet (Threads, Instagram) is given an address of the file there that works for an hour;
 * the file is deleted when the send ends. The bucket itself stays private, and the secret key is kept only in the vault.
 */
export class PublicFileService {
  constructor(private readonly core: Core) {}

  private place(): FilePlace | null {
    return this.core.settings.getRaw<FilePlace | null>(FILE_PLACE_SETTING, null)
  }

  state(): FilePlaceState {
    return { place: this.place(), hasSecret: this.core.secrets.has(FILE_PLACE_SECRET) }
  }

  /** Whether a file can be put: the place and its secret key are both saved. Asks the vault file only, never the keychain. */
  ready(): boolean {
    const state = this.state()
    return state.place !== null && state.hasSecret
  }

  /** Saves the place; the secret key only when one is typed (an empty field keeps the saved one). */
  async save(args: { endpoint: string; region: string; bucket: string; accessKeyId: string; secret?: string }): Promise<FilePlaceState> {
    const place: FilePlace = { endpoint: text(args.endpoint).replace(/\/+$/, ''), region: text(args.region), bucket: text(args.bucket), accessKeyId: text(args.accessKeyId) }
    const problem = placeProblem(place)
    if (problem) throw new ApiError('invalid_input', problem)
    const secret = text(args.secret)
    if (secret === '' && !this.core.secrets.has(FILE_PLACE_SECRET)) throw new ApiError('invalid_input', 'The secret access key is required: the store signs every request with it.')
    if (secret !== '') {
      if (/\s/.test(secret) || secret.length > 512) throw new ApiError('invalid_input', 'This does not look like a secret access key: it is one word. Copy it whole from where the store shows it.')
      try {
        await this.core.secrets.set(FILE_PLACE_SECRET, secret)
      } catch {
        throw new ApiError('vault_failed', 'The secret access key could not be saved to the vault.')
      }
    }
    this.core.settings.setRaw(FILE_PLACE_SETTING, place)
    this.core.log.info('settings', `The place for files was saved: bucket ${place.bucket} at ${new URL(place.endpoint).host}.`)
    this.core.events.changed('settings')
    return this.state()
  }

  remove(): FilePlaceState {
    this.core.settings.setRaw(FILE_PLACE_SETTING, null)
    this.core.secrets.delete(FILE_PLACE_SECRET)
    this.core.log.info('settings', 'The place for files was removed.')
    this.core.events.changed('settings')
    return this.state()
  }

  private async store(): Promise<S3Store | null> {
    const place = this.place()
    if (!place || !this.core.secrets.has(FILE_PLACE_SECRET)) return null
    const secret = await this.core.secrets.get(FILE_PLACE_SECRET)
    return secret ? new S3Store(this.core.http, place, secret, () => this.core.clock.now()) : null
  }

  /** The place as a connector uses it; null when none is set up. */
  async open(): Promise<PublicFiles | null> {
    const store = await this.store()
    if (!store) return null
    return {
      put: async (file: HttpFile): Promise<PublicFile> => {
        const key = `ppd/${newId()}/${safeName(file.name)}`
        await store.put(key, file)
        return {
          url: store.addressOf(key, PUBLIC_ADDRESS_SECONDS),
          // A file that could not be deleted does not change what became of the send: it is said in the log, and its address stops working within the hour.
          remove: async () => {
            try {
              await store.remove(key)
            } catch (error) {
              this.core.log.warn('settings', `A file put for a send could not be deleted from the place for files (${key}): ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }
      }
    }
  }

  /** Puts a small file, reads it back through its public address as a platform would, and deletes it. Says in words what did not work. */
  async check(): Promise<{ ok: boolean; detail: string }> {
    const store = await this.store()
    if (!store) return { ok: false, detail: 'Save the place and its secret access key first.' }
    const words = `Product Promotion Desk checks this place for files. ${this.core.clock.now().toISOString()}`
    const dir = mkdtempSync(join(tmpdir(), 'ppd-file-place-'))
    const path = join(dir, 'check.txt')
    const key = `ppd/check-${newId()}.txt`
    try {
      writeFileSync(path, words, 'utf8')
      try {
        await store.put(key, { path, name: 'check.txt', mime: 'text/plain' })
      } catch (error) {
        return { ok: false, detail: error instanceof HttpNoAnswerError ? `The store did not answer (${error.message}). Check its address.` : error instanceof Error ? error.message : String(error) }
      }
      let detail: string | null = null
      try {
        const read = await this.core.http.request({ method: 'GET', url: store.addressOf(key, 300) })
        if (read.status !== 200 || read.text !== words) detail = `The file was put, but its public address did not give it back (HTTP ${read.status}): a platform could not read it either.`
      } catch (error) {
        detail = `The file was put, but its public address did not answer (${error instanceof Error ? error.message : String(error)}).`
      }
      try {
        await store.remove(key)
      } catch (error) {
        return { ok: false, detail: `${detail ?? 'The file was put and read back.'} ${error instanceof Error ? error.message : String(error)} The key needs the right to delete: the application deletes every file after its send.` }
      }
      if (detail) return { ok: false, detail }
      return { ok: true, detail: 'A file was put, read back through its public address and deleted.' }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
