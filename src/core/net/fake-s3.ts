// A store that lives in a test: one bucket that keeps what is put into it, and gives an object back to anybody with a signed address.
import type { HttpPort, HttpRequest, HttpResponse } from '../ports'

export const FAKE_STORE_PLACE = { endpoint: 'https://store.example.com', region: 'auto', bucket: 'my-files', accessKeyId: 'AKIDEXAMPLE0001' }
export const FAKE_STORE_SECRET = 'fake-store-secret-key-0123456789'

export class FakeStore implements HttpPort {
  /** The objects of the bucket by their key: the path of the file each was put from. */
  readonly objects = new Map<string, { path: string; mime: string }>()
  /** Every key that was ever put, in order. */
  readonly everPut: string[] = []
  /** A refusal of every request, as the store would word it. */
  refuses: { status: number; code: string; message: string } | null = null
  /** False makes the store refuse to delete (a key with no right to). */
  mayDelete = true
  /** What a plain read of an object gives back, for the check of the place. */
  contentOf: (path: string) => string = () => ''

  /** The key an address of this store names; null for any other address. */
  keyOf(address: string): string | null {
    const url = new URL(address)
    const prefix = `/${FAKE_STORE_PLACE.bucket}/`
    return url.host === 'store.example.com' && url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : null
  }

  /** Whether a platform that fetches this address now would get the file: the object is there, and the address is signed. */
  serves(address: string): boolean {
    const key = this.keyOf(address)
    return key !== null && this.objects.has(key) && new URL(address).searchParams.has('X-Amz-Signature')
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const key = this.keyOf(req.url)
    if (key === null) throw new Error(`Not an address of the fake store: ${req.url}`)
    const xml = (status: number, code: string, message: string): HttpResponse => ({ status, headers: {}, text: `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${message}</Message></Error>` })
    if (this.refuses) return xml(this.refuses.status, this.refuses.code, this.refuses.message)
    if (req.method === 'PUT') {
      if (!req.file || !req.headers?.authorization) return xml(403, 'AccessDenied', 'Access Denied')
      this.objects.set(key, { path: req.file.path, mime: req.file.mime })
      this.everPut.push(key)
      return { status: 200, headers: {}, text: '' }
    }
    if (req.method === 'DELETE') {
      if (!this.mayDelete) return xml(403, 'AccessDenied', 'Access Denied')
      this.objects.delete(key)
      return { status: 204, headers: {}, text: '' }
    }
    if (req.method === 'GET') {
      const object = this.objects.get(key)
      if (!object || !this.serves(req.url)) return xml(object ? 403 : 404, object ? 'AccessDenied' : 'NoSuchKey', 'The object cannot be read')
      return { status: 200, headers: { 'content-type': object.mime }, text: this.contentOf(object.path) }
    }
    throw new Error(`The fake store has no ${req.method}`)
  }
}

/** One network for a test with several fakes behind it: each request goes to the fake of its host. */
export function byHost(hosts: Record<string, HttpPort>): HttpPort {
  return {
    request: (req) => {
      const port = hosts[new URL(req.url).host]
      if (!port) throw new Error(`This test has no ${new URL(req.url).host}`)
      return port.request(req)
    }
  }
}
