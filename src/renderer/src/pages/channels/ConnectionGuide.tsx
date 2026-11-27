import { KIND_NOT_SAID, guideSteps } from '../../../../shared/connection-guide'
import type { Account, GuideStep, PlatformInfo } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { ErrorNote } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { OpenAccountBrowser } from './OpenAccountBrowser'
import './channels.css'

/**
 * The steps of a connection, numbered (DEC-074). A step with an address has a button that opens that page in the account's own browser, signed
 * in as the account: the owner only fills in what the site asks. Nothing is filled in or pressed for the owner.
 */
export function GuideSteps({ account, steps, testId }: { account: Account; steps: GuideStep[]; testId: string }) {
  return (
    <ol className="guide-steps" data-testid={testId}>
      {steps.map((step, index) => (
        <li key={step.text}>
          <span>{step.text}</span>
          {step.url && (
            <div className="row">
              <OpenAccountBrowser account={account} label={step.link ?? 'Open the page'} open={() => call('accounts.openBrowser', { accountId: account.id, url: step.url })} testId={`${testId}-open-${index}`} />
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * How this account is connected (DEC-074): the kind of the account, asked where the platform has more than one, and the steps for that kind.
 * The first block of the Sign-in tab of an account that works in its browser; an account that works through an API shows the same steps
 * above the field of its key.
 */
export function ConnectionGuide({ account, info }: { account: Account; info: PlatformInfo | undefined }) {
  const [setKind, setting] = useAction((kind: string | null) => call('accounts.setKind', { accountId: account.id, kind }))
  const steps = guideSteps(info, account)
  const kinds = info?.kinds ?? []
  if (steps.length === 0) return null
  const chosen = kinds.find((k) => k.id === account.kind)
  return (
    <AccountBlock
      title="How to connect this account"
      testId={`connection-guide-${account.id}`}
      summary={kinds.length === 0 ? `The steps for ${info?.label ?? 'this platform'}.${steps.some((s) => s.url) ? ' Each button opens the page in this account’s own browser.' : ''}` : (chosen?.hint ?? 'Say what kind of account it is: the steps depend on it.')}
      actions={
        kinds.length > 0 && (
          <select className="input" aria-label="Kind of account" value={account.kind ?? ''} onChange={(e) => void setKind(e.target.value === '' ? null : e.target.value)} disabled={setting.busy} data-testid={`account-kind-${account.id}`}>
            <option value="">{KIND_NOT_SAID}</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        )
      }
    >
      <GuideSteps account={account} steps={steps} testId={`guide-steps-${account.id}`} />
      <ErrorNote error={setting.error} />
    </AccountBlock>
  )
}
