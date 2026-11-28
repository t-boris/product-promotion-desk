import type { Core } from '../core'
import { PublicFileService } from './public-files'

/** The owner's place for files on a public address (DEC-081): its API for the Settings card, and the service a connector's send asks. */
export function register(core: Core): void {
  const files = new PublicFileService(core)
  core.services.publicFiles = files
  core.router.register({
    'filePlace.get': () => files.state(),
    'filePlace.save': (args) => files.save(args),
    'filePlace.check': () => files.check(),
    'filePlace.remove': () => files.remove()
  })
}
