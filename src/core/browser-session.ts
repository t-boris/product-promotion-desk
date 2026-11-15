import {
  SessionChangedError,
  TakeoverError,
  type BrowserPage,
  type BrowserSession,
  type PageStep,
  type PageStepResult,
  type SendTicket,
  type SignInForm,
  type SignInStatus,
  type TicketVerifier
} from './ports'

/** Raw, unguarded page operations supplied by the browser implementation (Electron, or a fake in tests). */
export interface RawPage {
  goto(url: string, options?: { timeoutMs?: number }): Promise<void>
  url(): Promise<string>
  read<T>(script: string): Promise<T>
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>
  fill(selector: string, text: string): Promise<void>
  click(selector: string): Promise<void>
  uploadFile(selector: string, path: string): Promise<void>
  signIn(form: SignInForm): Promise<{ status: SignInStatus }>
  /** `alive` throws when the owner took the browser over meanwhile: a step that takes a while (a glide, a scroll) calls it before each input that reaches the page. */
  pageStep(step: PageStep, hosts: string[], alive?: () => void): Promise<PageStepResult>
}

/**
 * Wraps one account's browser identity with the application-level rules of REQ-002 and REQ-004 (DEC-038):
 *  - the AI's turns on its page for the same account are serialized; the owner's windows are separate pages of the session and take nothing;
 *  - when the owner explicitly takes control of the AI's page, the agent immediately stops interacting with it;
 *  - every write-class page action requires a valid SendTicket issued by the SendGate, and is refused when the owner used a sign-in or
 *    sign-out page of the session since the turn began.
 */
export class ControlledSession implements BrowserSession {
  private holder: 'agent' | 'user' | 'none' = 'none'
  private owner: string | null = null
  /** Incremented on every takeover so an in-flight agent run can detect that it lost control. */
  private epoch = 0
  /** Incremented when the owner did something in the session that can change who is signed in (see `identityEpoch`). */
  private identityChanges = 0
  private tail: Promise<unknown> = Promise.resolve()
  private page: RawPage | null = null

  constructor(
    readonly accountId: string,
    private readonly openPage: () => Promise<RawPage>,
    private readonly tickets: TicketVerifier
  ) {}

  control(): { holder: 'agent' | 'user' | 'none'; owner: string | null } {
    return { holder: this.holder, owner: this.owner }
  }

  identityEpoch(): number {
    return this.identityChanges
  }

  /** Called by the browser service when an owner window used a sign-in, sign-out or account-switch page of this session. */
  noteIdentityActivity(): void {
    this.identityChanges += 1
  }

  takeControl(): void {
    this.epoch += 1
    this.holder = 'user'
    this.owner = null
  }

  releaseControl(): void {
    if (this.holder === 'user') this.holder = 'none'
  }

  async withAgentControl<T>(owner: string, work: (page: BrowserPage) => Promise<T>): Promise<T> {
    if (this.userHolds()) throw new TakeoverError()
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => (release = resolve))
    try {
      await previous.catch(() => undefined)
      // The user may have taken control while this run waited in the queue.
      if (this.userHolds()) throw new TakeoverError()
      const myEpoch = this.epoch
      const identityAtStart = this.identityChanges
      this.holder = 'agent'
      this.owner = owner
      this.page ??= await this.openPage()
      return await work(this.guard(this.page, myEpoch, identityAtStart))
    } finally {
      if (this.agentHolds()) {
        this.holder = 'none'
        this.owner = null
      }
      release()
    }
  }

  // Read through methods: TypeScript would otherwise keep a narrowed type across awaits.
  private userHolds(): boolean {
    return this.holder === 'user'
  }

  private agentHolds(): boolean {
    return this.holder === 'agent'
  }

  private guard(raw: RawPage, epoch: number, identityAtStart: number): BrowserPage {
    const alive = (): void => {
      if (this.userHolds() || this.epoch !== epoch) throw new TakeoverError()
    }
    // A write that publishes or types into a form is refused when the owner used a sign-in or sign-out page of the session during this turn:
    // the page may now be signed in as somebody else. Reads and steps that publish nothing are not.
    const authorized = (ticket: SendTicket): void => {
      this.tickets.assertValid(ticket, { accountId: this.accountId })
      if (this.identityChanges !== identityAtStart) throw new SessionChangedError()
    }
    return {
      goto: async (url, options) => (alive(), raw.goto(url, options)),
      url: async () => (alive(), raw.url()),
      read: async <T>(script: string) => (alive(), raw.read<T>(script)),
      waitForSelector: async (selector, timeoutMs) => (alive(), raw.waitForSelector(selector, timeoutMs)),
      fill: async (selector, text, ticket) => (authorized(ticket), alive(), raw.fill(selector, text)),
      click: async (selector, ticket) => (authorized(ticket), alive(), raw.click(selector)),
      uploadFile: async (selector, path, ticket) => (authorized(ticket), alive(), raw.uploadFile(selector, path)),
      signIn: async (form) => (alive(), raw.signIn(form)),
      pageStep: async (step, hosts) => (alive(), raw.pageStep(step, hosts, alive)),
      publishStep: async (step, hosts, ticket) => (authorized(ticket), alive(), raw.pageStep(step, hosts, alive))
    }
  }
}
