import { useState } from 'react'
import type { Account, PageReport, PlatformInfo, SignInResult } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, formatTime, useMainVariant } from '../../ui'
import { AccountBlock } from './AccountBlock'
import { AccountStatusLine } from './AccountStatus'
import { AgentRunPanel } from './AgentRunPanel'
import { CopyButton } from './CopyButton'
import type { NextStep } from './next-step'
import { PageReportView } from './PageReportView'
import { signInControlNote } from '../accounts/account-browser-reason'

/**
 * Signing in (REQ-012, DEC-014, DEC-015, REQ-016): create the account on the platform if it does not exist yet (the AI does it in the
 * account's own browser, or the owner does), sign in in the account's own browser or with the saved password, and check the result.
 * Every check on a site (a CAPTCHA, a code, a phone number) is the owner's: the AI stops and says so.
 *
 * Only one button of this step is ever filled, and only while sign-in is the account's next step (`next`): the saved password when there is
 * one, else the account's browser (also to solve a CAPTCHA). "Let the AI create the account" is a helper and is never filled.
 */
export function AccountSignIn({
  account,
  info,
  step,
  through,
  vaultAvailable,
  hasPassword,
  next
}: {
  account: Account
  info: PlatformInfo | undefined
  /** The number of this step: 5, or 4 for a login that has no e-mail and no password block. */
  step: number
  /** Set for a login that signs in through another account (DEC-027): the name of that platform and the account (null while none is chosen). */
  through?: { label: string; account: Account | null }
  vaultAvailable: boolean
  hasPassword: boolean
  next: NextStep['block']
}) {
  const main = useMainVariant()
  // A login with no credentials of its own signs in through another account: the AI does it (kind 'signin'); there is no password to sign in with and no registration.
  const linked = through !== undefined
  const kind = linked ? 'signin' : 'signup'
  const [signedIn, setSignedIn] = useState<SignInResult | null>(null)
  const [pageReport, setPageReport] = useState<{ report: PageReport | null } | null>(null)
  const [open, opening] = useAction(() => call('accounts.openBrowser', { accountId: account.id }))
  const [check, checking] = useAction(() => call('accounts.checkLogin', { accountId: account.id }))
  const [signIn, signingIn] = useAction(async () => {
    setSignedIn(null)
    setSignedIn(await call('accounts.signIn', { accountId: account.id }))
  })
  const [signUp, signingUp] = useAction(() => call('accounts.openBrowser', { accountId: account.id, url: info?.signupUrl }))
  const agent = useQuery('agent.state', { accountId: account.id }, ['accounts'])
  const canStart = useQuery('agent.canStart', { accountId: account.id, kind }, ['accounts', 'settings'])
  const [startAgent, startingAgent] = useAction(async () => {
    setPageReport(null)
    await call('agent.start', { accountId: account.id, kind })
  })
  const [stopAgent, stoppingAgent] = useAction(() => call('agent.stop', { accountId: account.id }))
  const [copyPassword, copying] = useAction(() => call('vault.copyPassword', { accountId: account.id }))
  const browser = useQuery('accounts.browser', { accountId: account.id }, ['accounts'])
  const [look, looking] = useAction(async () => setPageReport({ report: await call('accounts.pageReport', { accountId: account.id }) }))
  const error = opening.error ?? checking.error ?? signingIn.error ?? signingUp.error ?? copying.error ?? looking.error
  // A window of the owner's takes nothing from the AI (DEC-038): only an explicit Take control (More) stops the AI's page, and then what goes
  // through that page (the saved password, the check, the AI) waits; opening a window of one's own does not.
  const controlNote = signInControlNote(browser.data)
  const taken = controlNote !== null
  const windowOpen = browser.data?.windowOpen === true
  const ready = account.status === 'ready'
  const agentRun = agent.data ?? null
  const agentWorking = agentRun?.status === 'running'
  // What the AI needs (an e-mail, the saved password, an engine that can work the browser) is decided by the core; the screen says it before the click, next to the button.
  const agentReady = canStart.data?.ready === true
  const agentWhy = !agentWorking && canStart.data && !canStart.data.ready ? canStart.data.reason : null

  // The saved password signs in by itself; a CAPTCHA, or no saved password, needs the account's own browser.
  const signInNext = next === 'signin'
  const passwordNext = !linked && signInNext && hasPassword && account.status !== 'captcha'
  // A login that signs in through another account: the AI is the step while it can start; otherwise the account's own browser.
  const aiNext = linked && signInNext && agentReady && account.status !== 'captcha'
  const browserNext = signInNext && !passwordNext && !aiNext

  const summary = (
    <>
      <AccountStatusLine status={account.status} />
      <span data-testid={`account-identity-${account.id}`} className="muted">
        {' · '}
        {account.identity ? `Signed in as ${account.identity}` : ready ? 'The site does not show the account name, so the app cannot read it.' : 'The account name on the platform is not confirmed yet.'}
      </span>
    </>
  )

  return (
    <AccountBlock step={step} title="Sign-in" summary={summary} testId={`signin-${account.id}`}>
      {controlNote && (
        <div className="note warn" role="status" data-testid={`signin-control-note-${account.id}`}>
          {controlNote}
        </div>
      )}
      <div className="row">
        {linked && !ready && (
          <Button variant={aiNext ? main : 'secondary'} onClick={() => void startAgent()} disabled={!agentReady || startingAgent.busy || agentWorking || taken} data-testid={`agent-start-${account.id}`}>
            {startingAgent.busy ? 'Starting…' : `Let the AI sign in with ${through.label}`}
          </Button>
        )}
        {!linked && hasPassword && (
          <Button variant={passwordNext ? main : 'ghost'} onClick={() => void signIn()} disabled={signingIn.busy || agentWorking || taken} data-testid={`password-signin-${account.id}`}>
            {signingIn.busy ? 'Signing in…' : 'Sign in with saved password'}
          </Button>
        )}
        <Button variant={browserNext ? main : 'ghost'} onClick={() => void open()} disabled={opening.busy} data-testid={`account-open-${account.id}`}>
          Open browser to sign in
        </Button>
        <Button onClick={() => void check()} disabled={checking.busy || agentWorking || taken} data-testid={`account-check-${account.id}`}>
          {checking.busy ? 'Checking…' : 'Check sign-in'}
        </Button>
        {windowOpen && (
          <Button onClick={() => void look()} disabled={looking.busy} data-testid={`page-report-${account.id}`}>
            {looking.busy ? 'Looking…' : 'What does the page show?'}
          </Button>
        )}
        {!linked && info?.signupUrl && !ready && (
          <Button variant="secondary" onClick={() => void startAgent()} disabled={!agentReady || startingAgent.busy || agentWorking || taken} data-testid={`agent-start-${account.id}`}>
            {startingAgent.busy ? 'Starting…' : 'Let the AI create the account'}
          </Button>
        )}
        {!linked && info?.signupUrl && !ready && (
          <Button onClick={() => void signUp()} disabled={signingUp.busy} data-testid={`signup-open-${account.id}`}>
            {signingUp.busy ? 'Opening…' : `Create account on ${info.label} myself`}
          </Button>
        )}
      </div>
      {pageReport && <PageReportView report={pageReport.report} testId={`page-report-view-${account.id}`} />}
      {(linked || info?.signupUrl) && !ready && agentWhy && (
        <div className="note warn" role="status" data-testid={`agent-missing-${account.id}`}>
          <strong>The AI cannot start yet.</strong> {agentWhy}
        </div>
      )}
      <ErrorNote error={startingAgent.error ?? stoppingAgent.error} />
      {agentRun?.kind === kind && <AgentRunPanel run={agentRun} onStop={() => void stopAgent()} stopping={stoppingAgent.busy} testId={`agent-run-${account.id}`} />}
      <p className="muted small" data-testid={`signin-last-check-${account.id}`}>
        {account.lastCheckedAt
          ? `Last checked ${formatTime(account.lastCheckedAt)}${account.lastCheckSignal ? ` · ${account.lastCheckSignal}` : ''}.`
          : 'Sign-in has not been checked yet.'}
      </p>
      <p className="muted small">A CAPTCHA, a code or any other check on the site is always yours: the app stops and tells you.</p>
      {linked && (
        <p className="muted small" data-testid={`signin-through-note-${account.id}`}>
          {info?.label ?? 'This platform'} has no password of its own. The AI signs in through {through.account ? <strong>{through.account.label}</strong> : `the ${through.label} account`} with its saved login; you are never asked for a {info?.label ?? 'platform'} password.
        </p>
      )}
      {!linked && !ready && info && (info.signupUrl || info.signupNote) && (
        <div className="stack well" data-testid={`signup-help-${account.id}`}>
          <strong className="small">No account on {info.label} yet?</strong>
          {info.signupUrl ? (
            <ol className="plain-lines" data-testid={`signup-steps-${account.id}`}>
              <li>Press “Let the AI create the account”, or do it yourself: “Create account on {info.label} myself” opens its registration page in this account’s own window.</li>
              <li>
                {account.email ? (
                  <>
                    Use the address <strong>{account.email}</strong> <CopyButton text={account.email} testId={`signup-copy-email-${account.id}`} />
                  </>
                ) : (
                  'Give the account an e-mail address first (step 3), then use it on the site.'
                )}
              </li>
              <li>
                {hasPassword && vaultAvailable ? (
                  <>
                    Use the saved password{' '}
                    <Button onClick={() => void copyPassword()} disabled={copying.busy} data-testid={`signup-copy-password-${account.id}`}>
                      Copy password
                    </Button>{' '}
                    <span className="muted small">(it leaves the clipboard in 30 seconds)</span>
                  </>
                ) : vaultAvailable ? (
                  'Save a password first (step 4), then use it on the site.'
                ) : (
                  'Choose a password yourself and keep it somewhere safe.'
                )}
              </li>
              <li>Pass the site’s checks yourself (a CAPTCHA, a code sent to the e-mail). When you are in, close that window (“Close window” at its top): the app then checks the sign-in by itself.</li>
            </ol>
          ) : (
            <p className="muted small" data-testid={`signup-note-${account.id}`}>
              {info.signupNote}
            </p>
          )}
        </div>
      )}
      {signedIn && (
        <div className={`note ${signedIn.outcome === 'signed_in' ? 'good' : 'warn'}`} role="status" data-testid={`password-signin-result-${account.id}`}>
          {signedIn.detail}
        </div>
      )}
      <ErrorNote error={error} />
    </AccountBlock>
  )
}
