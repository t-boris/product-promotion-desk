import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HttpNoAnswerError, createHttpPort, retryAfterMs } from './http'

describe('the network port for API connectors', () => {
  it('sends JSON and returns the status, the headers in lower case and the text, whatever the status', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const port = createHttpPort(async (url, init) => {
      seen.push({ url, init })
      return new Response('{"ok":false}', { status: 429, headers: { 'Retry-After': '7' } })
    })
    const answer = await port.request({ method: 'POST', url: 'https://api.example/x', json: { a: 1 } })
    expect(answer).toMatchObject({ status: 429, text: '{"ok":false}' })
    expect(retryAfterMs(answer.headers)).toBe(7000)
    expect(retryAfterMs({})).toBeNull()
    expect(seen[0]!.init).toMatchObject({ method: 'POST', body: '{"a":1}', redirect: 'error' })
    expect((seen[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('sends a form of words the way a token address takes it', async () => {
    let init: RequestInit | null = null
    const port = createHttpPort(async (_url, given) => {
      init = given
      return new Response('{}')
    })
    await port.request({ method: 'POST', url: 'https://api.example/token', headers: { authorization: 'Basic eA==' }, urlencoded: { grant_type: 'client_credentials', scope: 'a:read,b:write' } })
    expect(init!.body).toBe('grant_type=client_credentials&scope=a%3Aread%2Cb%3Awrite')
    expect(init!.headers as Record<string, string>).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic eA==' })
  })

  it('sends a file of a form from its path, with its name and type', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ppd-http-')), 'picture.png')
    writeFileSync(path, Buffer.from([1, 2, 3, 4]))
    let form: FormData | null = null
    const port = createHttpPort(async (_url, init) => {
      form = init.body as FormData
      return new Response('ok')
    })
    await port.request({ method: 'POST', url: 'https://api.example/upload', form: { chat_id: '@x', photo: { path, name: 'picture.png', mime: 'image/png' } } })
    expect(form!.get('chat_id')).toBe('@x')
    const file = form!.get('photo') as File
    expect(file).toMatchObject({ name: 'picture.png', type: 'image/png', size: 4 })
  })

  it('sends only the named part of a file: one segment of an upload a platform takes in parts', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ppd-http-')), 'clip.mp4')
    writeFileSync(path, Buffer.from([1, 2, 3, 4, 5, 6, 7]))
    let form: FormData | null = null
    const port = createHttpPort(async (_url, init) => {
      form = init.body as FormData
      return new Response('ok')
    })
    await port.request({ method: 'POST', url: 'https://api.example/append', form: { segment_index: '1', media: { path, name: 'clip.mp4', mime: 'video/mp4', part: { start: 3, end: 6 } } } })
    const segment = form!.get('media') as File
    expect(segment).toMatchObject({ name: 'clip.mp4', type: 'video/mp4', size: 3 })
    expect([...new Uint8Array(await segment.arrayBuffer())]).toEqual([4, 5, 6])
  })

  it('says "no answer" without repeating the address, which may hold a key', async () => {
    const port = createHttpPort(async () => {
      throw new TypeError('fetch failed: https://api.example/botSECRET/send')
    })
    const error = await port.request({ method: 'GET', url: 'https://api.example/botSECRET/send' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpNoAnswerError)
    expect((error as Error).message).toBe('the connection failed')
    const slow = createHttpPort(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    await expect(slow.request({ method: 'GET', url: 'https://api.example/x', timeoutMs: 2000 })).rejects.toThrow('no answer within 2 seconds')
  })
})
