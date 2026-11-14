import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Tone } from './tone'

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function Card({ title, actions, children, className = '' }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'quiet' }

/**
 * A button never submits a form unless it says so (`type="submit"`). A browser button inside a form submits it by default, which
 * made "Propose" and "Cancel" create an account in the middle of filling in its form.
 */
export function Button({ variant = 'ghost', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={`btn btn-${variant} ${className}`} />
}

export type { Tone } from './tone'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/**
 * An empty state says what is missing and offers the one action that fills it (QA findings 1, 41, 45): a lone sentence left the owner
 * to find the way. `fill` stretches it over the free height of its column so the page does not end after a thin strip.
 */
export function EmptyState({ title, children, action, fill = false }: { title: string; children?: ReactNode; action?: ReactNode; fill?: boolean }) {
  return (
    <div className={`empty${fill ? ' fill' : ''}`}>
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/** An explanation, 13px. Long ones belong in a `Disclosure` or a `More`, not in a grey paragraph under the title. */
export function Hint({ children, tone, className = '', ...rest }: { children: ReactNode; tone?: 'strong' | 'warn'; className?: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p {...rest} className={`hint ${tone ?? ''} ${className}`}>
      {children}
    </p>
  )
}

/** A folded block with a readable summary line (and a short status on its right). */
export function Disclosure({ title, aside, defaultOpen = false, children, testId }: { title: string; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode; testId?: string }) {
  return (
    <details className="disclosure" open={defaultOpen} data-testid={testId}>
      <summary>
        <span>{title}</span>
        {aside && <span className="disclosure-aside">{aside}</span>}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}

/** "More about this" under a short line: the detail is one click away and does not push the page down. */
export function More({ label = 'More about this', children }: { label?: string; children: ReactNode }) {
  return (
    <details className="more">
      <summary>{label}</summary>
      <div className="stack">{children}</div>
    </details>
  )
}

/** One choice out of a few, as buttons at least as tall as every other control. The whole label is the target. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  testIdPrefix
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  name: string
  testIdPrefix?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={`segmented-option${option.value === value ? ' on' : ''}`}>
          <input type="radio" name={name} checked={option.value === value} onChange={() => onChange(option.value)} data-testid={testIdPrefix ? `${testIdPrefix}${option.value}` : undefined} />
          {option.label}
        </label>
      ))}
    </div>
  )
}

/** An on/off switch. It stays a checkbox for the keyboard and the screen reader (role switch). */
export function Switch({ checked, onChange, disabled, label, note, testId }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string; note?: string; testId?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">
        <span>{label}</span>
        {note && <span className="muted small">{note}</span>}
      </span>
    </label>
  )
}

/** A button that opens a small menu under it; it closes on a click elsewhere, on Escape, and after a choice. */
export function RowMenu({ label, children, testId }: { label: string; children: (close: () => void) => ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu" ref={box}>
      <Button variant="ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {label}
      </Button>
      {open && (
        <div className="menu-pop" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** One entry of a `RowMenu`: the action, and in a second line what it means. */
export function MenuItem({ children, note, danger, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { note?: string; danger?: boolean }) {
  return (
    <button {...rest} type="button" role="menuitem" className={`menu-item${danger ? ' danger' : ''}`}>
      <span>{children}</span>
      {note && <span className="menu-note">{note}</span>}
    </button>
  )
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null
  return (
    <div className="error-note" role="alert">
      {error}
    </div>
  )
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted">{what}…</p>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
