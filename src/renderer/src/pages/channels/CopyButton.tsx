import { useState } from 'react'
import { Button } from '../../ui'

/** Copies a text that is not secret (an e-mail address). Passwords never go through here: they use the vault's own copy. */
export function CopyButton({ text, label = 'Copy', testId }: { text: string; label?: string; testId?: string }) {
  const [done, setDone] = useState(false)
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 2_000)
    } catch {
      setDone(false)
    }
  }
  return (
    <Button onClick={() => void copy()} data-testid={testId}>
      {done ? 'Copied' : label}
    </Button>
  )
}
