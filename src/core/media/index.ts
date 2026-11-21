// The picture library module (DEC-030): the API of `media.*`.

import type { Core } from '../core'
import { pictureSaverOf } from './save-picture'
import { MediaService } from './service'

export { MediaService } from './service'

export function register(core: Core): void {
  const media = new MediaService(core)
  core.services.media = media
  core.router.register({
    'media.status': (args) => media.status(args),
    'media.pick': (args) => media.pick(args),
    'media.add': (args) => media.add(args),
    'media.list': (args) => media.list(args),
    'media.thumb': (args) => media.thumb(args),
    'media.describe': (args) => media.describe(args),
    'media.remove': (args) => media.remove(args),
    'media.make': (args) => media.make(args),
    'media.reveal': (args) => media.reveal(args),
    'media.save': (args) => media.save(args),
    // A picture drawn on the screen (a page capture, the card of a quick post) is saved from its bytes; "Show in Finder" takes only a path that was saved just now.
    'pictures.saveDataUrl': (args) => pictureSaverOf(core).saveDrawn(args.dataUrl, args.name),
    'pictures.revealSaved': (args) => pictureSaverOf(core).reveal(args.path)
  })
  // Pictures nobody uses are cleared once at start-up, off the start's path; a failure is only logged.
  void media.cleanOrphans().catch((error) => core.log.warn('pipeline', `Clearing unused pictures failed: ${error instanceof Error ? error.message : String(error)}`))
}
