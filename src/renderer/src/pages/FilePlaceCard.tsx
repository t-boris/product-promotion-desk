import { useEffect, useState, type FormEvent } from 'react'
import type { FilePlaceState } from '../../../shared/types'
import { call, useAction } from '../hooks'
import { Button, Card, ConfirmAction, ErrorNote, Field, Hint, More } from '../ui'

const EMPTY = { endpoint: '', region: '', bucket: '', accessKeyId: '' }

/**
 * A place for files on a public address (DEC-081): a storage bucket of the owner's own, for the platforms whose API takes a picture or a video
 * only from an address on the internet (Threads, Instagram). Four plain fields and the secret key, which goes to the keychain's vault and is
 * never shown again; "Check the place" puts a small file, reads it back as a platform would and deletes it.
 */
export function FilePlaceCard({ state }: { state: FilePlaceState | undefined }) {
  const saved = state?.place ?? null
  const [form, setForm] = useState(EMPTY)
  const [secret, setSecret] = useState('')
  const [checked, setChecked] = useState<{ ok: boolean; detail: string } | null>(null)
  // The fields show what is saved whenever that changes, here or elsewhere.
  useEffect(() => {
    setForm(saved ?? EMPTY)
  }, [saved?.endpoint, saved?.region, saved?.bucket, saved?.accessKeyId])

  const [save, saving] = useAction(async () => {
    await call('filePlace.save', { ...form, ...(secret.trim() !== '' ? { secret } : {}) })
    setSecret('')
    setChecked(null)
  })
  const [check, checking] = useAction(async () => setChecked(await call('filePlace.check', undefined)))
  const [remove, removing] = useAction(async () => {
    await call('filePlace.remove', undefined)
    setChecked(null)
  })

  const filled = form.endpoint.trim() !== '' && form.region.trim() !== '' && form.bucket.trim() !== '' && form.accessKeyId.trim() !== ''
  const changed = saved === null || (['endpoint', 'region', 'bucket', 'accessKeyId'] as const).some((name) => form[name].trim() !== saved[name]) || secret.trim() !== ''
  const canSave = filled && changed && (state?.hasSecret === true || secret.trim() !== '')
  const ready = saved !== null && state?.hasSecret === true
  const field = (name: keyof typeof EMPTY) => ({
    className: 'input',
    value: form[name],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [name]: e.target.value }),
    autoComplete: 'off',
    spellCheck: false,
    'data-testid': `file-place-${name}`
  })

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (canSave) void save()
  }

  return (
    <Card title="A place for files">
      <p className="muted">
        Threads takes a picture or a video through its API only from an address on the internet. Give the app a storage bucket of your own: a file is put there for the minutes of a send, the platform reads it from an address that works for an hour, and the app deletes it afterwards. The bucket itself stays private. Posts sent in an account’s browser do not need this.
      </p>
      <More label="What to prepare">
        <Hint>Any store that speaks the S3 API works: Amazon S3, Cloudflare R2, Backblaze B2 and others. Create a private bucket there, and an access key that may put, read and delete files in that bucket only. The store shows its S3 address (endpoint), the region, the access key id and, once, the secret access key.</Hint>
      </More>
      <p data-testid="file-place-state" className={ready ? undefined : 'muted'}>
        {ready ? (
          <>
            Saved: bucket <strong>{saved.bucket}</strong> at {saved.endpoint.replace(/^https:\/\//, '')}. The secret access key is in the keychain vault.
          </>
        ) : (
          'Not set up. A post with a picture or a video for a Threads account that works through the API cannot be sent until it is.'
        )}
      </p>
      <form onSubmit={submit} className="add-form" data-testid="file-place-form">
        <Field label="Address of the store" hint="The S3 address (endpoint) with nothing after its name.">
          <input {...field('endpoint')} placeholder="https://s3.eu-central-1.amazonaws.com" />
        </Field>
        <Field label="Region" hint="For Cloudflare R2 it is auto.">
          <input {...field('region')} placeholder="eu-central-1" />
        </Field>
        <Field label="Bucket">
          <input {...field('bucket')} placeholder="my-post-files" />
        </Field>
        <Field label="Access key id">
          <input {...field('accessKeyId')} />
        </Field>
        <Field label="Secret access key" hint={state?.hasSecret ? 'Saved in the keychain vault and never shown. Leave empty to keep it; type a new one to replace it.' : 'Stored encrypted by the macOS keychain, only on this Mac, and never shown again.'}>
          <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} data-testid="file-place-secret" />
        </Field>
        <div className="row">
          <Button type="submit" disabled={saving.busy || !canSave} data-testid="file-place-save">
            {saving.busy ? 'Saving…' : 'Save the place'}
          </Button>
          {ready && (
            <Button onClick={() => void check()} disabled={checking.busy} data-testid="file-place-check">
              {checking.busy ? 'Checking…' : 'Check the place'}
            </Button>
          )}
          {saved !== null && (
            <ConfirmAction
              label="Remove"
              question="Removes the place and its secret access key from this Mac. The bucket and its files at the store are not touched."
              confirmLabel="Remove the place"
              onConfirm={() => remove()}
              testId="file-place-remove"
              confirmTestId="file-place-remove-confirm"
            />
          )}
          {!filled && <Hint data-testid="file-place-save-reason">Fill in the four fields and the secret access key.</Hint>}
        </div>
      </form>
      {checked && (
        <p className={checked.ok ? 'hint' : 'hint bad'} role={checked.ok ? undefined : 'alert'} data-testid="file-place-checked">
          {checked.ok ? `It works. ${checked.detail}` : checked.detail}
        </p>
      )}
      <ErrorNote error={saving.error ?? checking.error ?? removing.error} />
    </Card>
  )
}
