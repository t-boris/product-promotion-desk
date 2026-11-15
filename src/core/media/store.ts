// SQL for the picture library (DEC-030). A row says which file in the data folder is the picture; the file never changes.

import { join } from 'node:path'
import type { Id, MediaItem, MediaOrigin } from '../../shared/types'
import { newId, type Db } from '../db/database'

type Row = Record<string, unknown>

export const MEDIA_FOLDER = 'media'

export interface NewMedia {
  productId: Id
  name: string
  file: string
  mime: string
  sha256: string
  bytes: number
  width: number | null
  height: number | null
  origin: MediaOrigin
  description: string
}

export class MediaStore {
  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
    private readonly now: () => string
  ) {}

  folder(): string {
    return join(this.dataDir, MEDIA_FOLDER)
  }

  private map(row: Row): MediaItem {
    return {
      id: row.id as string,
      productId: row.product_id as string,
      name: row.name as string,
      path: join(this.folder(), row.file as string),
      mime: row.mime as string,
      sha256: row.sha256 as string,
      bytes: row.bytes as number,
      width: (row.width as number | null) ?? null,
      height: (row.height as number | null) ?? null,
      origin: row.origin as MediaOrigin,
      description: row.description as string,
      createdAt: row.created_at as string
    }
  }

  get(id: Id): MediaItem | null {
    const row = this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Row | undefined
    return row ? this.map(row) : null
  }

  list(productId: Id): MediaItem[] {
    return (this.db.prepare('SELECT * FROM media WHERE product_id = ? ORDER BY created_at DESC, rowid DESC').all(productId) as Row[]).map((row) => this.map(row))
  }

  byHash(productId: Id, sha256: string): MediaItem | null {
    const row = this.db.prepare('SELECT * FROM media WHERE product_id = ? AND sha256 = ?').get(productId, sha256) as Row | undefined
    return row ? this.map(row) : null
  }

  /** The id is chosen first so the file can be named after it before the row exists. */
  newId(): Id {
    return newId()
  }

  insert(id: Id, media: NewMedia): MediaItem {
    this.db
      .prepare(
        `INSERT INTO media (id, product_id, name, file, mime, sha256, bytes, width, height, origin, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, media.productId, media.name, media.file, media.mime, media.sha256, media.bytes, media.width, media.height, media.origin, media.description, this.now())
    return this.get(id)!
  }

  describe(id: Id, description: string): void {
    this.db.prepare('UPDATE media SET description = ? WHERE id = ?').run(description, id)
  }

  delete(id: Id): void {
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id)
  }

  /**
   * Whether the picture is carried by what could still be sent: the LATEST draft of an item that is not deleted (an older version was
   * replaced by an edit, and nothing is sent from it). By its id, or by its file for a post written before the library.
   */
  usedByDraft(item: MediaItem): boolean {
    const live = `SELECT 1 FROM drafts d JOIN opportunities o ON o.id = d.opportunity_id
      WHERE o.state <> 'cancelled' AND d.attachments_json LIKE ?
        AND d.id = (SELECT d2.id FROM drafts d2 WHERE d2.opportunity_id = d.opportunity_id ORDER BY d2.created_at DESC, d2.rowid DESC LIMIT 1)
      LIMIT 1`
    if (this.db.prepare(live).get(`%"mediaId":${JSON.stringify(item.id)}%`)) return true
    return this.db.prepare(live).get(`%${JSON.stringify(item.path).slice(1, -1)}%`) !== undefined
  }

  /** Pictures older than `before` that no draft carries. */
  unusedOlderThan(before: string): MediaItem[] {
    return (this.db.prepare('SELECT * FROM media WHERE created_at < ?').all(before) as Row[]).map((row) => this.map(row)).filter((item) => !this.usedByDraft(item))
  }
}
