import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpResponse } from '../ports'
import { S3Store, encodePath, placeProblem, presignedQuery, signedHeaders } from './s3'

// The examples of Amazon's own documentation ("Signature Calculations for the Authorization Header" and "Authenticating Requests: Using Query
// Parameters"): the same keys, time and bucket, and the signatures the documentation prints.
const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00.000Z') }
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('the signature of a request to a store (AWS Signature Version 4)', () => {
  it('signs a request in its headers as Amazon\'s documentation does', () => {
    const headers = signedHeaders({ ...AWS, method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' }, payloadHash: EMPTY_HASH })
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
    expect(headers).not.toHaveProperty('host')
  })

  it('signs an address that reads an object for a day as Amazon\'s documentation does', () => {
    const query = presignedQuery({ ...AWS, method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', expiresSeconds: 86_400 })
    expect(query).toBe(
      'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
    )
  })

  it('encodes each part of a path and keeps the slashes', () => {
    expect(encodePath('ppd/ab 1/chart (1).jpg')).toBe('ppd/ab%201/chart%20%281%29.jpg')
  })
})

describe('a bucket of the owner\'s own', () => {
  const place = { endpoint: 'https://store.example.com', region: 'auto', bucket: 'my-files', accessKeyId: 'AKIDEXAMPLE0001' }

  it('puts a file as the whole body of a signed PUT, gives an address for an hour, and deletes', async () => {
    const calls: HttpRequest[] = []
    const http = { request: async (req: HttpRequest): Promise<HttpResponse> => (calls.push(req), { status: req.method === 'DELETE' ? 204 : 200, headers: {}, text: '' }) }
    const store = new S3Store(http, place, 'secret-key', () => new Date('2026-12-01T10:00:00.000Z'))
    const file = { path: '/tmp/a b.jpg', name: 'a b.jpg', mime: 'image/jpeg' }
    await store.put('ppd/x1/a b.jpg', file)
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://store.example.com/my-files/ppd/x1/a%20b.jpg', file })
    expect(calls[0]?.headers).toMatchObject({ 'content-type': 'image/jpeg', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': '20261201T100000Z' })
    expect(calls[0]?.headers?.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE0001\/20261201\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    expect(JSON.stringify(calls)).not.toContain('secret-key')

    const address = store.addressOf('ppd/x1/a b.jpg', 3600)
    expect(address).toMatch(/^https:\/\/store\.example\.com\/my-files\/ppd\/x1\/a%20b\.jpg\?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE0001%2F20261201%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261201T100000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=[0-9a-f]{64}$/)
    expect(address).not.toContain('secret-key')

    await store.remove('ppd/x1/a b.jpg')
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://store.example.com/my-files/ppd/x1/a%20b.jpg' })
  })

  it('says a refusal in the store\'s own words, and takes an object that is not there as deleted', async () => {
    const denied = '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>'
    let status = 403
    const store = new S3Store({ request: async () => ({ status, headers: {}, text: status === 403 ? denied : '' }) }, place, 'secret-key', () => new Date())
    await expect(store.put('k', { path: '/tmp/a', name: 'a', mime: 'image/png' })).rejects.toThrow('The store did not take the file: AccessDenied: Access Denied (HTTP 403)')
    await expect(store.remove('k')).rejects.toThrow(/did not delete the file: AccessDenied/)
    status = 404
    await expect(store.remove('k')).resolves.toBeUndefined()
  })

  it('says what is wrong with a typed place before anything is asked of it', () => {
    expect(placeProblem(place)).toBeNull()
    expect(placeProblem({ ...place, endpoint: 'store.example.com' })).toMatch(/full address/)
    expect(placeProblem({ ...place, endpoint: 'http://store.example.com' })).toMatch(/https:\/\//)
    expect(placeProblem({ ...place, endpoint: 'https://store.example.com/my-files' })).toMatch(/nothing after its name/)
    expect(placeProblem({ ...place, bucket: 'My Files' })).toMatch(/bucket's name/)
    expect(placeProblem({ ...place, region: 'EU Central' })).toMatch(/region/)
    expect(placeProblem({ ...place, accessKeyId: 'a key' })).toMatch(/access key id/)
  })
})
