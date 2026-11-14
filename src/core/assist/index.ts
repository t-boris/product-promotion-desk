// The assist module: the AI helps that are not tied to one screen's service. Today assist.refine (write or improve one text field).

import type { Core } from '../core'
import { AssistService } from './service'

export function register(core: Core): void {
  const assist = new AssistService(core)
  core.router.register({
    'assist.refine': (args) => assist.refine(args)
  })
}
