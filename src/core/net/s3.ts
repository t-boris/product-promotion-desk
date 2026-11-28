// A bucket of the owner's own, spoken to in the S3 API that the common stores share (AWS S3, Cloudflare R2, Backblaze B2, Spaces, MinIO):
// a file is put there, a platform that takes a picture only from an address on the internet is given an address that works for an hour, and
// the object is deleted afterwards. The bucket stays private: the address carries its own signature (AWS Signature Version 4, query form).
// Nothing here is a library: the signing is the documented algorithm with node:crypto.
import { createHash, createHmac } from 'node:crypto'
import type { FilePlace } from '../../shared/types'
import type { HttpFile, HttpPort } from '../ports'

/**
 * `endpoint`: where the store answers, e.g. "https://s3.eu-central-1.amazonaws.com" or "https://<account>.r2.cloudflarestorage.com".
 * `region`: the region the store signs for; "auto" for a store that has none (Cloudflare R2).
 */
export type S3Place = FilePlace

const UNSIGNED = 'UNSIGNED-PAYLOAD'
const ALGORITHM = 'AWS4-HMAC-SHA256'

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const hmac = (key: Buffer | string, text: string): Buffer => createHmac('sha256', key).update(text, 'utf8').digest()

/** RFC 3986 encoding as the signature wants it: everything but letters, digits, "-", "_", "." and "~". */
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** A path with each of its parts encoded, the slashes kept. */
export const encodePath = (path: string): string => path.split('/').map(encode).join('/')

/** "20130524T000000Z" */
const stamp = (now: Date): string => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

function signature(secret: string, region: string, time: string, canonicalRequest: string): string {
  const day = time.slice(0, 8)
  const scope = `${day}/${region}/s3/aws4_request`
  const toSign = [ALGORITHM, time, scope, sha256(canonicalRequest)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request')
  return createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
}

const canonicalQuery = (query: Record<string, string>): string =>
  Object.keys(query)
    .sort()
    .map((name) => `${encode(name)}=${encode(query[name] as string)}`)
    .join('&')

export interface SignInput {
  method: string
  host: string
  /** The path as it is sent, already encoded. */
  path: string
  query?: Record<string, string>
  /** Headers to sign beside `host`, names in lower case. */
  headers?: Record<string, string>
  /** The hash of the body, or "UNSIGNED-PAYLOAD". */
  payloadHash: string
  accessKeyId: string
  secret: string
  region: string
  now: Date
}

/** The headers of a signed request: what was given, plus the date, the hash of the body and `authorization`. */
export function signedHeaders(input: SignInput): Record<string, string> {
  const time = stamp(input.now)
  const headers: Record<string, string> = { ...(input.headers ?? {}), host: input.host, 'x-amz-content-sha256': input.payloadHash, 'x-amz-date': time }
  const names = Object.keys(headers).sort()
  const canonical = [input.method, input.path, canonicalQuery(input.query ?? {}), names.map((name) => `${name}:${(headers[name] as string).trim()}\n`).join(''), names.join(';'), input.payloadHash].join('\n')
  const credential = `${input.accessKeyId}/${time.slice(0, 8)}/${input.region}/s3/aws4_request`
  const { host: _host, ...sent } = headers
  return { ...sent, authorization: `${ALGORITHM} Credential=${credential}, SignedHeaders=${names.join(';')}, Signature=${signature(input.secret, input.region, time, canonical)}` }
}

/** The query of an address that reads the object with no other proof, for `expiresSeconds` from `now`. */
export function presignedQuery(input: Omit<SignInput, 'headers' | 'payloadHash' | 'query'> & { expiresSeconds: number }): string {
  const time = stamp(input.now)
  const query: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${input.accessKeyId}/${time.slice(0, 8)}/${input.region}/s3/aws4_request`,
    'X-Amz-Date': time,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host'
  }
  const canonical = [input.method, input.path, canonicalQuery(query), `host:${input.host}\n`, 'host', UNSIGNED].join('\n')
  return `${canonicalQuery(query)}&X-Amz-Signature=${signature(input.secret, input.region, time, canonical)}`
}

/** A store's refusal, in the store's own words: its answer is a small XML with a code and a message. The secret is never in it. */
function refusalOf(status: number, text: string): string {
  const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1]
  const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1]
  return code || message ? `${code ?? 'error'}${message ? `: ${message}` : ''} (HTTP ${status})` : `HTTP ${status}`
}

/** What is wrong with a typed place, in words; null when it can be tried. */
export function placeProblem(place: S3Place): string | null {
  let url: URL
  try {
    url = new URL(place.endpoint)
  } catch {
    return 'The address of the store must be a full address, like https://s3.eu-central-1.amazonaws.com.'
  }
  if (url.protocol !== 'https:') return 'The address of the store must begin with https://.'
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return 'Give the address of the store itself, with nothing after its name: the bucket has a field of its own.'
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(place.bucket)) return 'A bucket\'s name is 3 to 63 lower-case letters, digits, dots and hyphens.'
  if (!/^[a-z0-9-]{1,40}$/.test(place.region)) return 'The region is a short word like eu-central-1; for Cloudflare R2 it is auto.'
  if (!/^[A-Za-z0-9]{8,128}$/.test(place.accessKeyId)) return 'This does not look like an access key id: it is one word of letters and digits.'
  return null
}

/** One bucket, with the secret key that signs for it. Every object is named by its key inside the bucket. */
export class S3Store {
  private readonly host: string

  constructor(
    private readonly http: HttpPort,
    private readonly place: S3Place,
    private readonly secret: string,
    private readonly now: () => Date
  ) {
    this.host = new URL(place.endpoint).host
  }

  private pathOf(key: string): string {
    return `/${encodePath(`${this.place.bucket}/${key}`)}`
  }

  private signing(method: string, key: string): Omit<SignInput, 'payloadHash'> {
    return { method, host: this.host, path: this.pathOf(key), accessKeyId: this.place.accessKeyId, secret: this.secret, region: this.place.region, now: this.now() }
  }

  /** Puts a file, read from its path as it is sent. It throws with the store's words when the store refuses. */
  async put(key: string, file: HttpFile): Promise<void> {
    const headers = signedHeaders({ ...this.signing('PUT', key), headers: { 'content-type': file.mime }, payloadHash: UNSIGNED })
    const answer = await this.http.request({ method: 'PUT', url: `https://${this.host}${this.pathOf(key)}`, headers, file })
    if (answer.status < 200 || answer.status >= 300) throw new Error(`The store did not take the file: ${refusalOf(answer.status, answer.text)}`)
  }

  /** Deletes an object. An object that is not there is deleted already. */
  async remove(key: string): Promise<void> {
    const headers = signedHeaders({ ...this.signing('DELETE', key), payloadHash: UNSIGNED })
    const answer = await this.http.request({ method: 'DELETE', url: `https://${this.host}${this.pathOf(key)}`, headers })
    if ((answer.status < 200 || answer.status >= 300) && answer.status !== 404) throw new Error(`The store did not delete the file: ${refusalOf(answer.status, answer.text)}`)
  }

  /** An address anybody can read the object from, for `seconds` from now and no longer. */
  addressOf(key: string, seconds: number): string {
    return `https://${this.host}${this.pathOf(key)}?${presignedQuery({ ...this.signing('GET', key), expiresSeconds: seconds })}`
  }
}
