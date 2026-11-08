import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** SHA-256 of a file, used to prove an attachment is still exactly what the user approved (REQ-004). */
export function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
