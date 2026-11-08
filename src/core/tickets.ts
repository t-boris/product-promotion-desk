import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { TicketError, type Clock, type SendTicket, type TicketVerifier } from './ports'

const DEFAULT_TTL_MS = 3 * 60 * 1000

function sign(secret: Buffer, t: Omit<SendTicket, 'signature'>): string {
  return createHmac('sha256', secret)
    .update([t.id, t.actionId, t.contentHash, t.accountId, t.destination, String(t.expiresAt)].join('\n'))
    .digest('hex')
}

/**
 * Issues and verifies send tickets (REQ-004). The secret exists only in this process's memory, so neither
 * an AI engine nor a connector can mint a ticket: only the SendGate holds the authority.
 * A ticket authorizes one outgoing action and is revoked when that attempt ends.
 */
export class TicketAuthority implements TicketVerifier {
  private readonly secret: Buffer
  private readonly revoked = new Set<string>()

  constructor(
    private readonly clock: Clock,
    secret: Buffer = randomBytes(32)
  ) {
    this.secret = secret
  }

  issue(params: Pick<SendTicket, 'actionId' | 'contentHash' | 'accountId' | 'destination'>, ttlMs = DEFAULT_TTL_MS): SendTicket {
    const unsigned = { id: randomUUID(), ...params, expiresAt: this.clock.now().getTime() + ttlMs }
    return { ...unsigned, signature: sign(this.secret, unsigned) }
  }

  revoke(ticket: SendTicket): void {
    this.revoked.add(ticket.id)
  }

  assertValid(ticket: SendTicket, expect: Partial<Pick<SendTicket, 'accountId' | 'destination' | 'contentHash'>> = {}): void {
    if (!ticket || typeof ticket.signature !== 'string') throw new TicketError('Missing send ticket')
    const { signature, ...unsigned } = ticket
    const expected = Buffer.from(sign(this.secret, unsigned), 'hex')
    const given = Buffer.from(signature, 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new TicketError('Send ticket is not genuine')
    if (this.revoked.has(ticket.id)) throw new TicketError('Send ticket was already used up')
    if (this.clock.now().getTime() > ticket.expiresAt) throw new TicketError('Send ticket expired')
    for (const key of ['accountId', 'destination', 'contentHash'] as const) {
      if (expect[key] !== undefined && expect[key] !== ticket[key]) throw new TicketError(`Send ticket does not match ${key}`)
    }
  }
}
