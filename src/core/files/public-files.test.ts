import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_STORE_PLACE, FAKE_STORE_SECRET, FakeStore } from '../net/fake-s3'
import { makeTestCore, type TestCore } from '../testing/fakes'
import { FILE_PLACE_SECRET } from './public-files'

let t: TestCore | null = null
afterEach(async () => {
  await t?.core.shutdown()
  t = null
})

function world() {
  const store = new FakeStore()
  // The check writes a real small file: the fake gives its words back as the store would.
  store.contentOf = (path) => readFileSync(path, 'utf8')
  t = makeTestCore({ http: store })
  const core = t.core
  const logged = (): string => JSON.stringify(core.db.prepare('SELECT * FROM log_events').all())
  return { core, store, secrets: t.secrets, logged, call: core.router.call.bind(core.router) as typeof core.router.call }
}

describe('a place for files on a public address', () => {
  it('is saved with its secret key in the vault only, and says what it has without ever giving the key back', async () => {
    const w = world()
    expect(await w.call('filePlace.get', undefined)).toEqual({ place: null, hasSecret: false })
    expect(w.core.services.publicFiles?.ready()).toBe(false)
    const saved = await w.call('filePlace.save', { ...FAKE_STORE_PLACE, endpoint: ' https://store.example.com/ ', secret: ` ${FAKE_STORE_SECRET} ` })
    expect(saved).toEqual({ place: FAKE_STORE_PLACE, hasSecret: true })
    expect(JSON.stringify(saved)).not.toContain(FAKE_STORE_SECRET)
    expect(await w.secrets.get(FILE_PLACE_SECRET)).toBe(FAKE_STORE_SECRET)
    expect(JSON.stringify(w.core.db.prepare('SELECT * FROM settings').all())).not.toContain(FAKE_STORE_SECRET)
    expect(w.logged()).not.toContain(FAKE_STORE_SECRET)
    expect(w.logged()).toMatch(/place for files was saved: bucket my-files at store\.example\.com/)
    expect(w.core.services.publicFiles?.ready()).toBe(true)
    // Another bucket with the key field left empty keeps the saved key.
    expect(await w.call('filePlace.save', { ...FAKE_STORE_PLACE, bucket: 'other-files' })).toEqual({ place: { ...FAKE_STORE_PLACE, bucket: 'other-files' }, hasSecret: true })
    expect(await w.secrets.get(FILE_PLACE_SECRET)).toBe(FAKE_STORE_SECRET)
  })

  it('refuses a place that cannot be one, and a first save with no secret key, and keeps nothing of it', async () => {
    const w = world()
    await expect(w.call('filePlace.save', { ...FAKE_STORE_PLACE, endpoint: 'http://store.example.com', secret: FAKE_STORE_SECRET })).rejects.toThrow(/https:\/\//)
    await expect(w.call('filePlace.save', { ...FAKE_STORE_PLACE, bucket: 'My Files', secret: FAKE_STORE_SECRET })).rejects.toThrow(/bucket's name/)
    await expect(w.call('filePlace.save', { ...FAKE_STORE_PLACE })).rejects.toThrow(/secret access key is required/)
    await expect(w.call('filePlace.save', { ...FAKE_STORE_PLACE, secret: 'two words' })).rejects.toThrow(/one word/)
    expect(await w.call('filePlace.get', undefined)).toEqual({ place: null, hasSecret: false })
  })

  it('checks the place by putting a file, reading it through its public address and deleting it', async () => {
    const w = world()
    expect(await w.call('filePlace.check', undefined)).toEqual({ ok: false, detail: 'Save the place and its secret access key first.' })
    await w.call('filePlace.save', { ...FAKE_STORE_PLACE, secret: FAKE_STORE_SECRET })
    expect(await w.call('filePlace.check', undefined)).toEqual({ ok: true, detail: 'A file was put, read back through its public address and deleted.' })
    expect(w.store.everPut).toHaveLength(1)
    expect(w.store.objects.size).toBe(0)

    w.store.refuses = { status: 403, code: 'SignatureDoesNotMatch', message: 'The request signature we calculated does not match the signature you provided.' }
    expect(await w.call('filePlace.check', undefined)).toMatchObject({ ok: false, detail: expect.stringMatching(/did not take the file: SignatureDoesNotMatch/) })
    w.store.refuses = null

    w.store.mayDelete = false
    expect(await w.call('filePlace.check', undefined)).toMatchObject({ ok: false, detail: expect.stringMatching(/put and read back.*did not delete the file.*needs the right to delete/) })
    // That one file stays in the bucket: the store would not delete it.
    expect(w.store.objects.size).toBe(1)
    w.store.mayDelete = true

    // A store that keeps the file but gives something else from its address: a platform could not read it either.
    w.store.contentOf = () => 'something else'
    expect(await w.call('filePlace.check', undefined)).toMatchObject({ ok: false, detail: expect.stringMatching(/public address did not give it back/) })
    expect(w.store.objects.size).toBe(1)
  })

  it('is removed with its secret key', async () => {
    const w = world()
    await w.call('filePlace.save', { ...FAKE_STORE_PLACE, secret: FAKE_STORE_SECRET })
    expect(await w.call('filePlace.remove', undefined)).toEqual({ place: null, hasSecret: false })
    expect(await w.secrets.get(FILE_PLACE_SECRET)).toBeNull()
    expect(await w.core.services.publicFiles?.open()).toBeNull()
  })
})
