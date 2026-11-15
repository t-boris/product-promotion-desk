import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { EmptyArtwork, type EmptyArt } from './empty-art'
import { Icon, type IconName } from './icons'
import { closeForm, mainForm, openForm, type OpenFormIds } from './open-forms'
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

/** The header of an object (a product, an account, a channel): its name, a meta line under it, its actions on the right. No box. */
export function ObjectHeader({ title, meta, actions, testId }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div className="obj-head" data-testid={testId}>
      <div>
        <h2>{title}</h2>
        {meta && <div className="obj-meta">{meta}</div>}
      </div>
      {actions && <div className="obj-actions">{actions}</div>}
    </div>
  )
}

/**
 * One filled button per screen (visual-system.md §10): the screen's next step. While a form that was opened on demand (an edit,
 * "Add statement") is open, the form's own button is the filled one and the resting main action steps back to a bezel. A screen
 * wraps its content in `OpenFormsScope`; an on-demand form calls `useOpenForm()` and gives its submit button the variant it returns; a
 * resting main action reads `useMainVariant()`. When several forms are open, only the one opened last keeps its submit filled
 * (open-forms.ts), so there is never more than one filled button on a screen (BUG-040).
 */
const OpenForms = createContext<{ forms: OpenFormIds; open: (id: string) => () => void } | null>(null)

export function OpenFormsScope({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<OpenFormIds>([])
  const open = useCallback((id: string) => {
    setForms((list) => openForm(list, id))
    return () => setForms((list) => closeForm(list, id))
  }, [])
  const value = useMemo(() => ({ forms, open }), [forms, open])
  return <OpenForms.Provider value={value}>{children}</OpenForms.Provider>
}

/**
 * Called by an on-demand form while it is open (`active`); a form that is only sometimes an on-demand one passes the condition. It
 * returns the variant of the form's submit button: filled only while this is the form opened last, a bezel otherwise. The form
 * registers in a layout effect, so the screen never paints a frame with two filled buttons.
 */
export function useOpenForm(active = true): 'primary' | 'ghost' {
  const scope = useContext(OpenForms)
  const open = scope?.open
  const id = useId()
  useLayoutEffect(() => (active ? open?.(id) : undefined), [open, id, active])
  if (!scope) return active ? 'primary' : 'ghost'
  return active && mainForm(scope.forms) === id ? 'primary' : 'ghost'
}

/** The variant of a resting main action: filled, unless an on-demand form of the same screen is open. */
export function useMainVariant(): 'primary' | 'ghost' {
  const scope = useContext(OpenForms)
  return scope && scope.forms.length > 0 ? 'ghost' : 'primary'
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

/** primary is the one main action of a screen (filled); secondary a bezel with an accent label for helpers (the AI ideas,
 *  approving one statement); ghost the plain bezel; quiet a text-only one; danger for removing things. All have one size; `icon`
 *  adds a 16px glyph before the words (the accessible name stays the words). */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'; icon?: IconName }

/**
 * A button never submits a form unless it says so (`type="submit"`). A browser button inside a form submits it by default, which
 * made "Propose" and "Cancel" create an account in the middle of filling in its form.
 */
export function Button({ variant = 'ghost', className = '', type = 'button', icon, children, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={`btn btn-${variant} ${className}`}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

/**
 * A square button with only a glyph (the sidebar toggle, a row's "more"). The words are in the page for a screen reader and for a
 * test tool that reads the accessibility tree (they are the button's name), and are the tooltip; `count` is the count capsule of the
 * sidebar, shown beside the glyph (never smaller than 13px, so it is not a dot on the glyph).
 */
export function IconButton({
  icon,
  label,
  count,
  countTone,
  title,
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; count?: number; countTone?: 'attention' | 'error' | null; title?: string }) {
  const counted = count !== undefined && count > 0
  return (
    <button {...rest} type={type} title={title ?? label} className={`icon-btn${counted ? ' has-count' : ''} ${className}`}>
      <Icon name={icon} />
      {counted && (
        <span className={`count ${countTone ?? ''}`} aria-hidden="true">
          {count}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </button>
  )
}

export type { Tone } from './tone'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/**
 * An empty state says what is missing and offers the one action that fills it (QA findings 1, 41, 45): a lone sentence left the owner
 * to find the way. `fill` stretches it over the free height of its column so the page does not end after a thin strip.
 */
/** An empty page or list: a line drawing of what will be here (BUG-036), what it is, and what to do about it. */
export function EmptyState({ title, children, action, fill = false, art = 'launch' }: { title: string; children?: ReactNode; action?: ReactNode; fill?: boolean; art?: EmptyArt }) {
  return (
    <div className={`empty${fill ? ' fill' : ''}`}>
      <EmptyArtwork art={art} />
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
  testIdPrefix,
  disabled,
  describedBy
}: {
  label: string
  /** An option can be off on its own (`disabled`), or the whole group can (`disabled` below): the reason is said beside the control. */
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
  name: string
  testIdPrefix?: string
  disabled?: boolean
  /** The id of the text that says why the group is off, or what it does. */
  describedBy?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} aria-describedby={describedBy}>
      {options.map((option) => (
        <label key={option.value} className={`segmented-option${option.value === value ? ' on' : ''}${disabled || option.disabled ? ' off' : ''}`}>
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            disabled={disabled || option.disabled}
            onChange={() => onChange(option.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}${option.value}` : undefined}
          />
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
export function RowMenu({ label, children, testId, variant = 'ghost' }: { label: string; children: (close: () => void) => ReactNode; testId?: string; variant?: 'ghost' | 'quiet' }) {
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
      <Button variant={variant} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {label}
        <Icon name="chevronDown" small />
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

/**
 * The one way to ask before something that cannot be undone is removed (BUG-059, visual-system.md §7): the question, the confirming
 * button and "Cancel", in the place of the button that was pressed. No dialog and no system sheet, so the eye stays where the click
 * was. Focus starts on "Cancel", so a second Space or Enter never confirms by accident; Escape cancels.
 *
 * `ConfirmBar` is the three of them alone, for a place whose trigger is not a button (a menu entry). `ConfirmAction` is the button that
 * turns into it. The wrapper draws no box (`display: contents`), so the question and the buttons are items of the row the button was in.
 */
export function ConfirmBar({
  question,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancel',
  quiet = false,
  busy = false,
  disabled = false,
  onConfirm,
  onCancel,
  confirmTestId,
  cancelTestId
}: {
  question: ReactNode
  confirmLabel: string
  /** The confirming button's words while `onConfirm` runs. */
  busyLabel?: string
  cancelLabel?: string
  /** "Cancel" is a quiet button, like the quiet button this replaces. */
  quiet?: boolean
  /** `onConfirm` is running: both buttons are off, and Escape does not leave. */
  busy?: boolean
  /** The place this belongs to is working on something else: the confirming button is off, "Cancel" still leaves. */
  disabled?: boolean
  onConfirm: () => void
  onCancel: () => void
  confirmTestId?: string
  cancelTestId?: string
}) {
  const askId = useId()
  return (
    <span
      className="confirm"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (!busy) onCancel()
      }}
    >
      <span id={askId} className="hint strong confirm-ask">
        {question}
      </span>
      <span className="confirm-buttons">
        <Button variant="danger" onClick={onConfirm} disabled={busy || disabled} aria-describedby={askId} data-testid={confirmTestId}>
          {busy && busyLabel ? busyLabel : confirmLabel}
        </Button>
        <Button variant={quiet ? 'quiet' : 'ghost'} autoFocus onClick={onCancel} disabled={busy} aria-describedby={askId} data-testid={cancelTestId}>
          {cancelLabel}
        </Button>
      </span>
    </span>
  )
}

/**
 * A button that asks first. `onConfirm` reports its own failure (`useAction` does), so the question closes when it has settled, whatever
 * the result, and the owner reads the refusal where the screen shows errors. After "Cancel" or Escape, focus returns to the button.
 */
export function ConfirmAction({
  label,
  icon,
  question,
  confirmLabel,
  busyLabel,
  cancelLabel,
  onConfirm,
  variant = 'danger',
  className = '',
  disabled,
  title,
  testId,
  confirmTestId,
  cancelTestId
}: {
  /** The button that is pressed first. */
  label: string
  icon?: IconName
  question: ReactNode
  confirmLabel: string
  busyLabel?: string
  cancelLabel?: string
  onConfirm: () => unknown
  variant?: 'secondary' | 'ghost' | 'danger' | 'quiet'
  className?: string
  disabled?: boolean
  title?: string
  testId?: string
  confirmTestId?: string
  cancelTestId?: string
}) {
  const [asking, setAsking] = useState(false)
  const [working, setWorking] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (asking || !refocus.current) return
    refocus.current = false
    box.current?.querySelector('button')?.focus()
  }, [asking])

  async function confirm(): Promise<void> {
    setWorking(true)
    try {
      await onConfirm()
    } finally {
      // Whatever the result, the question closes and the trigger takes focus back (if it is still on the screen): the confirming button that
      // had it is gone.
      refocus.current = true
      setWorking(false)
      setAsking(false)
    }
  }

  if (!asking) {
    return (
      <span className="confirm" ref={box}>
        <Button variant={variant} icon={icon} className={className} disabled={disabled} title={title} onClick={() => setAsking(true)} data-testid={testId}>
          {label}
        </Button>
      </span>
    )
  }
  return (
    <ConfirmBar
      question={question}
      confirmLabel={confirmLabel}
      busyLabel={busyLabel}
      cancelLabel={cancelLabel}
      quiet={variant === 'quiet'}
      busy={working}
      disabled={disabled}
      onConfirm={() => void confirm()}
      onCancel={() => {
        refocus.current = true
        setAsking(false)
      }}
      confirmTestId={confirmTestId}
      cancelTestId={cancelTestId}
    />
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
