import type { AttentionItem, AttentionKind, Channel, Product } from '../../../../shared/types'
import { Badge, Card, EmptyState } from '../../ui'
import { fixLinkFor } from '../attention-links'
import { KIND_TONE } from '../attention-tone'

const KIND_LABEL: Record<AttentionKind, string> = {
  approval: 'Approval',
  draft: 'Draft',
  question: 'Question',
  login: 'Sign in',
  captcha: 'CAPTCHA',
  connection: 'Connection',
  error: 'Problem',
  unknown_result: 'Unknown result'
}

/**
 * The Fix segment: what is wrong with a connection or an account and the link that goes to where it is fixed. The problems of the
 * current product, and the accounts, which belong to no product (DEC-015).
 */
export function FixList({ items, channels, products }: { items: AttentionItem[]; channels: Channel[]; products: Product[] }) {
  if (items.length === 0) {
    return (
      <EmptyState art="channel" title="No connection or account problems">
        A channel that cannot be read, an account that needs to sign in and a CAPTCHA to solve appear here, with the link that fixes them.
      </EmptyState>
    )
  }
  return (
    <div data-testid="problem-list">
      <Card title="Connections and accounts">
        <div className="rows">
          {items.map((item) => {
            const fix = fixLinkFor(item, { channels, products })
            return (
              <div key={item.id} className="problem-row" data-testid={`attention-${item.kind}`}>
                <div className="problem-main">
                  <div className="problem-title">
                    <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                    <strong>{item.title}</strong>
                  </div>
                  <div className="problem-line">{item.detail}</div>
                  {fix?.productName && <div className="problem-line">Product: {fix.productName}</div>}
                </div>
                {fix && (
                  <a className="btn" href={fix.href} data-testid={`attention-link-${item.kind}`}>
                    {fix.label}
                  </a>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
