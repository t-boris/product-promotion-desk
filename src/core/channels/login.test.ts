import { describe, expect, it } from 'vitest'
import { loginOutcome } from './login'

describe('loginOutcome: the log says what the check saw', () => {
  it('names the signal of a CAPTCHA, of a missing sign-in and of a sign-in without a name', () => {
    expect(loginOutcome({ loggedIn: false, identity: null, captcha: true, signal: 'a visible check on the page (x)' })).toMatchObject({ status: 'captcha', detail: expect.stringContaining('(a visible check on the page (x))') })
    expect(loginOutcome({ loggedIn: false, identity: null, captcha: false, signal: 'a password field is shown' })).toMatchObject({ status: 'login_required', detail: 'Not signed in (a password field is shown). Open the browser and sign in on the site itself.' })
    expect(loginOutcome({ loggedIn: true, identity: null, captcha: false, signal: 'the page does not ask to sign in' })).toMatchObject({ status: 'ready', identity: null, detail: expect.stringContaining('(the page does not ask to sign in)') })
  })

  it('keeps the plain wording when the connector saw nothing to name (Reddit, profiles)', () => {
    expect(loginOutcome({ loggedIn: false, identity: null, captcha: false })).toMatchObject({ detail: 'Not signed in. Open the browser and sign in on the site itself.' })
    expect(loginOutcome({ loggedIn: true, identity: 'natal', captcha: false })).toMatchObject({ status: 'ready', identity: 'natal', detail: 'Signed in as natal.' })
  })
})
