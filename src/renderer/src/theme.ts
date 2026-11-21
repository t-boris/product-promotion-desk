// The look of the window: the theme and the animated background of Settings, applied to the page (visual-system.md §33).
//
// The setting lives in the core (SQLite) and is the truth. The page needs it before the first paint, which cannot wait for an answer from
// the core, so the last confirmed value is also kept in the browser's own storage as a hint: it is applied at once when the script starts,
// then the core is asked and the page follows what it says (and again on every change of the settings, from this window, another window or
// the web access). With no storage, or no answer yet, the page follows macOS and stands still, which is how the application always looked.
import { useSyncExternalStore } from 'react'
import { animationStateOf, appearanceOf, applyThemeAttributes, type AnimationState, type AppearanceSettings } from '../../shared/themes'
import { transport } from './transport'

const HINT_KEY = 'ppd-appearance'
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export interface Appearance {
  /** What the settings say. */
  settings: AppearanceSettings
  /** Whether the animated background runs, and if its switch is locked and why. */
  animation: AnimationState
}

let reducedMotion = false
let current: Appearance = describe(appearanceOf(undefined))
const listeners = new Set<() => void>()
let started = false

function describe(settings: AppearanceSettings): Appearance {
  return { settings, animation: animationStateOf(settings.animatedBackground, reducedMotion) }
}

function readHint(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(HINT_KEY)
    return appearanceOf(raw ? JSON.parse(raw) : undefined)
  } catch {
    // No storage (a private window, blocked site data) or a damaged value: the page follows macOS and stands still.
    return appearanceOf(undefined)
  }
}

function writeHint(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify(settings))
  } catch {
    // The hint only saves a flash on the next start.
  }
}

function show(settings: AppearanceSettings): void {
  current = describe(settings)
  applyThemeAttributes(document.documentElement, current.settings.theme, current.animation)
  for (const listener of [...listeners]) listener()
}

/** Shows a choice the owner just made at once, before the core has confirmed it (the hint is not touched until it has). */
export function previewAppearance(patch: Partial<AppearanceSettings>): void {
  show({ ...current.settings, ...patch })
}

/** Takes the appearance from a settings object the core has confirmed, applies it and remembers it for the next start. */
export function adoptSettings(settings: unknown): void {
  const next = appearanceOf(settings)
  writeHint(next)
  if (next.theme === current.settings.theme && next.animatedBackground === current.settings.animatedBackground) return
  show(next)
}

/** Asks the core what the settings are and follows it: after a refusal, this puts back what was shown before the choice. */
export async function refreshAppearance(): Promise<void> {
  try {
    adoptSettings(await transport.invoke('app.settings.get', undefined))
  } catch {
    // The core did not answer: what is shown stays.
  }
}

/** Applies the hint at once, follows "Reduce motion", and keeps the page in step with the settings. Call it once, before the first render. */
export function startAppearance(): void {
  if (started) return
  started = true
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null
  reducedMotion = query?.matches ?? false
  show(readHint())
  query?.addEventListener('change', (event) => {
    reducedMotion = event.matches
    show(current.settings)
  })
  transport.subscribe((event) => {
    if (event.type === 'changed' && event.scope === 'settings') void refreshAppearance()
  })
  void refreshAppearance()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The appearance now, for a screen that shows it; it re-renders when the theme, the animation or "Reduce motion" changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current)
}
