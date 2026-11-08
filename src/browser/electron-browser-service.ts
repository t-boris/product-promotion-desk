import type { Account } from '../shared/types'
import { ControlledSession } from '../core/browser-session'
import type { BrowserService, BrowserSession, TicketVerifier } from '../core/ports'

/** Placeholder until the Electron browser implementation (I-3) lands: opening a page fails visibly. */
export class ElectronBrowserService implements BrowserService {
  private readonly sessions = new Map<string, ControlledSession>()

  constructor(private readonly tickets: TicketVerifier) {}

  session(account: Account): BrowserSession {
    let session = this.sessions.get(account.id)
    if (!session) {
      session = new ControlledSession(
        account.id,
        async () => {
          throw new Error('The embedded browser is not available yet')
        },
        this.tickets
      )
      this.sessions.set(account.id, session)
    }
    return session
  }

  async openForUser(): Promise<{ tabId: string }> {
    throw new Error('The embedded browser is not available yet')
  }
}
