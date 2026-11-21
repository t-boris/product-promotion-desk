/**
 * The themes of the application (visual-system.md §33, DEC-036, DEC-047), as plain data and pure rules, so the core, the main process and
 * the renderer agree on them. The colours themselves live in `styles.css` (one token block, the only place with colour values); this
 * module knows which themes exist, which side of light and dark each is on, what the stored choice may be, and when the animated
 * background may run. A test reads `styles.css` and holds the two lists together.
 */

export type ThemeScheme = 'light' | 'dark'

/** Every theme the owner can pick. The id is the value of `data-theme` on the page and the name the choice is stored under. */
export const THEME_IDS = ['daylight', 'lagoon', 'orchid', 'graphite', 'midnight', 'aubergine'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** `system` follows macOS: Daylight in a light appearance, Graphite in a dark one. It is the default, and it is how the app always looked. */
export type ThemeChoice = 'system' | ThemeId

export const DEFAULT_THEME: ThemeChoice = 'system'

export interface ThemeInfo {
  readonly label: string
  readonly scheme: ThemeScheme
  /** One line on its colour character, shown under the swatch. */
  readonly character: string
}

export const THEMES: Readonly<Record<ThemeId, ThemeInfo>> = {
  daylight: { label: 'Daylight', scheme: 'light', character: 'Neutral white and cool grey, indigo accent' },
  lagoon: { label: 'Lagoon', scheme: 'light', character: 'Pale aqua page, deeper aqua sidebar, teal accent' },
  orchid: { label: 'Orchid', scheme: 'light', character: 'Pale lilac page and sidebar, purple accent' },
  graphite: { label: 'Graphite', scheme: 'dark', character: 'Neutral graphite, indigo accent' },
  midnight: { label: 'Midnight', scheme: 'dark', character: 'Deep navy ink, cyan accent' },
  aubergine: { label: 'Aubergine', scheme: 'dark', character: 'Deep plum, fuchsia accent' }
}

/** The two themes "Follow macOS" shows: the palettes of the application before themes existed. */
export const SYSTEM_THEMES: Readonly<Record<ThemeScheme, ThemeId>> = { light: 'daylight', dark: 'graphite' }

/** What the picker offers, in order: "Follow macOS" first, then the light themes, then the dark ones. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', ...THEME_IDS]

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || isThemeId(value)
}

/** A stored or received value read as a choice: anything that is not a known choice is `system`, so a bad value can never blank the page. */
export function themeChoiceOf(value: unknown): ThemeChoice {
  return isThemeChoice(value) ? value : DEFAULT_THEME
}

/** The value of `data-theme` on the page: none for `system`, which leaves the stylesheet to follow macOS by itself (no script involved). */
export function themeAttributeOf(choice: ThemeChoice): ThemeId | null {
  return choice === 'system' ? null : choice
}

/** Which side the page is on, given the choice and (for `system`) macOS's appearance. */
export function schemeOf(choice: ThemeChoice, systemIsDark: boolean): ThemeScheme {
  return choice === 'system' ? (systemIsDark ? 'dark' : 'light') : THEMES[choice].scheme
}

/** What the application's own appearance (`nativeTheme.themeSource`) must be, so the window's material, menus and pop-up lists match the page. */
export function nativeThemeSourceOf(choice: ThemeChoice): 'system' | 'light' | 'dark' {
  return choice === 'system' ? 'system' : THEMES[choice].scheme
}

export interface AnimationState {
  /** The background is drawn and moves. */
  readonly running: boolean
  /** The switch cannot be turned: macOS asks for less motion. */
  readonly locked: boolean
  /** Why the switch is locked, in the owner's words; null when it is not. */
  readonly reason: string | null
}

export const REDUCED_MOTION_REASON =
  'Not running, because "Reduce motion" is on in macOS (System Settings, Accessibility, Display). Your choice is kept and applies when it is turned off.'

/** The animated background runs only when the owner asked for it and macOS is not asked to reduce motion. Off by default. */
export function animationStateOf(setting: boolean, reducedMotion: boolean): AnimationState {
  if (reducedMotion) return { running: false, locked: true, reason: REDUCED_MOTION_REASON }
  return { running: setting === true, locked: false, reason: null }
}

/** What the page needs of an element: the root of the document. */
export interface AttributeTarget {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** The attributes the stylesheet reads: `data-theme` (absent for `system`) and `data-animated` (present only while the background runs). */
export function applyThemeAttributes(root: AttributeTarget, choice: ThemeChoice, animation: AnimationState): void {
  const theme = themeAttributeOf(choice)
  if (theme) root.setAttribute('data-theme', theme)
  else root.removeAttribute('data-theme')
  if (animation.running) root.setAttribute('data-animated', 'on')
  else root.removeAttribute('data-animated')
}

/** The two appearance settings as the stored settings carry them. */
export interface AppearanceSettings {
  theme: ThemeChoice
  animatedBackground: boolean
}

/** A stored settings object, or a part of one, read as appearance: anything missing or malformed is the default (system, still). */
export function appearanceOf(value: unknown): AppearanceSettings {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return { theme: themeChoiceOf(source.theme), animatedBackground: source.animatedBackground === true }
}
