import { describe, expect, it } from 'vitest'
import { SIGN_IN_CALLBACK, createSignInListener } from './sign-in-listener'

describe('the address a sign-in answers to', () => {
  it('is on this Mac only, and fixed, so it can be registered in the owner\'s app', () => {
    expect(SIGN_IN_CALLBACK).toBe('http://127.0.0.1:47821/signin')
  })

  it('takes the one answer that carries this sign-in\'s word, and closes', async () => {
    const wait = await createSignInListener(0).listen('word-1', 60_000)
    expect(wait.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/signin$/)
    // Another word, another path or another method is not the answer.
    expect((await fetch(`${wait.redirectUri}?state=other&code=x`)).status).toBe(404)
    expect((await fetch(`${wait.redirectUri.replace('/signin', '/other')}?state=word-1&code=x`)).status).toBe(404)
    expect((await fetch(`${wait.redirectUri}?state=word-1&code=x`, { method: 'POST' })).status).toBe(404)
    const page = await fetch(`${wait.redirectUri}?state=word-1&code=the-code`)
    expect(page.status).toBe(200)
    expect(await page.text()).toMatch(/has the answer. You can close this window/)
    expect((await wait.answer).get('code')).toBe('the-code')
    await expect(fetch(`${wait.redirectUri}?state=word-1&code=again`)).rejects.toThrow()
  })

  it('stops waiting when asked, and after its time', async () => {
    const stopped = await createSignInListener(0).listen('word-2', 60_000)
    stopped.stop()
    await expect(stopped.answer).rejects.toThrow('The sign-in was stopped.')
    await expect(fetch(`${stopped.redirectUri}?state=word-2&code=x`)).rejects.toThrow()
    const late = await createSignInListener(0).listen('word-3', 30)
    await expect(late.answer).rejects.toThrow(/Nobody allowed it within/)
  })

  it('says when the address is taken', async () => {
    const first = await createSignInListener(0).listen('a', 60_000)
    const port = Number(new URL(first.redirectUri).port)
    await expect(createSignInListener(port).listen('b', 60_000)).rejects.toThrow(/uses the address a sign-in answers to|a sign-in is going on already/)
    first.stop()
    await expect(first.answer).rejects.toThrow()
  })
})
