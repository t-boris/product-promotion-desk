/**
 * The contrast pairs the design document names (visual-system.md §5, §12 and §33), as data: one row is one text colour on one stack of
 * fills, with the least ratio it may have. `themes.test.ts` measures every row in every theme, so a theme that fails breaks the build.
 *
 * The limits are the document's own: 4.5:1 for text of any kind (text, secondary text, placeholders, accent text, a label on the accent,
 * a tag's colour on its background), 3:1 for the focus ring. A momentary state (the pointer over a button) is held to 4.0:1: the shipped
 * dark theme's accent label on a hovered bezel is 4.34:1, and a pressed state, which lasts as long as a click, is not held to a limit.
 */

export type PairKind = 'text' | 'hover' | 'focus' | 'edge'

export interface Pair {
  id: string
  /** Where the owner meets it. */
  use: string
  /** The token of the text (or of the line, for an edge). */
  foreground: string
  /** The base and the translucent fills laid over it, in the order the browser paints them. */
  background: string[]
  min: number
  kind: PairKind
}

const MIN = { text: 4.5, hover: 4.0, focus: 3, edge: 2 } as const

const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3', 'field'] as const
const MEANING = ['error', 'attention', 'success', 'info'] as const

function pair(kind: PairKind, foreground: string, background: string[], use: string): Pair {
  return { id: `${foreground} on ${background.join(' + ')}`, use, foreground, background, min: MIN[kind], kind }
}

function build(): Pair[] {
  const pairs: Pair[] = []
  for (const surface of SURFACES) {
    pairs.push(pair('text', 'text-1', [surface], 'text'))
    pairs.push(pair('text', 'text-2', [surface], 'secondary text, hints'))
    pairs.push(pair('text', 'text-3', [surface], 'disabled labels, placeholders'))
    pairs.push(pair('text', 'accent-on-tint', [surface], 'links, quiet buttons'))
    for (const colour of MEANING) pairs.push(pair('text', colour, [surface], 'status text'))
    pairs.push(pair('focus', 'focus', [surface], 'focus ring'))
  }
  // The sidebar (its opaque colour: in the window a theme without a sidebar of its own shows the system's material instead).
  for (const text of ['text-1', 'text-2', 'accent-on-tint']) pairs.push(pair('text', text, ['sidebar-solid'], 'sidebar'))
  for (const fill of ['hover-fill', 'selection']) for (const text of ['text-1', 'accent-on-tint']) pairs.push(pair('text', text, ['sidebar-solid', fill], 'sidebar item'))
  pairs.push(pair('text', 'text-2', ['sidebar-solid', 'hover-fill'], 'sidebar item'))
  pairs.push(pair('focus', 'focus', ['sidebar-solid'], 'focus ring'))
  // The fills that stack on a card or the page: a striped table row, a tag, a tab track, a selected row, a quiet button under the pointer.
  const stacks: [string[], string][] = [
    [['surface-1', 'hover-fill'], 'table stripe'],
    [['surface-1', 'segment-track'], 'neutral tag, tab track in a card'],
    [['surface-1', 'hover-fill', 'segment-track'], 'neutral tag on a striped row'],
    [['surface-0', 'segment-track'], 'tab track on the page'],
    [['surface-1', 'accent-tint'], 'selected row in a panel'],
    [['surface-0', 'accent-tint'], 'selected row on the page, the Next tag'],
    [['surface-1', 'selection'], 'selected row, neutral']
  ]
  for (const [background, use] of stacks) {
    pairs.push(pair('text', 'text-1', background, use))
    pairs.push(pair('text', 'text-2', background, use))
  }
  for (const [background, use] of [
    [['surface-0', 'accent-tint'], 'accent text on its tint over the page'],
    [['surface-1', 'accent-tint'], 'accent text on its tint over a card'],
    [['surface-0', 'hover-fill'], 'quiet button under the pointer'],
    [['surface-1', 'hover-fill'], 'quiet button under the pointer, in a card']
  ] as [string[], string][]) {
    pairs.push(pair('text', 'accent-on-tint', background, use))
  }
  // Buttons.
  pairs.push(pair('text', 'on-accent', ['accent'], 'the filled button, the menu highlight'))
  pairs.push(pair('hover', 'on-accent', ['accent-hover'], 'the filled button under the pointer'))
  pairs.push(pair('text', 'text-1', ['bezel'], 'bezel button'))
  pairs.push(pair('text', 'accent-on-tint', ['bezel'], 'secondary button'))
  pairs.push(pair('text', 'error', ['bezel'], 'danger button'))
  pairs.push(pair('hover', 'text-1', ['bezel-hover'], 'bezel button under the pointer'))
  pairs.push(pair('hover', 'accent-on-tint', ['bezel-hover'], 'secondary button under the pointer'))
  pairs.push(pair('hover', 'error', ['bezel-hover'], 'danger button under the pointer'))
  pairs.push(pair('text', 'text-1', ['segment-thumb'], 'selected segment'))
  // The colours that carry a meaning, on their own backgrounds (tags, notes, the count capsule).
  for (const colour of MEANING) pairs.push(pair('text', colour, [`${colour}-bg`], 'tag, note'))
  pairs.push(pair('text', 'on-attention', ['attention'], 'count capsule'))
  pairs.push(pair('text', 'on-error', ['error'], 'count capsule of a failure'))
  // A field must stay findable: its edge against the field and the page.
  pairs.push(pair('edge', 'field-border', ['field'], 'edge of a field'))
  pairs.push(pair('edge', 'field-border', ['surface-0'], 'edge of a field on the page'))
  // The animated background: the page under the glow, every way the two glows can lie over it. Text on the page must hold in each.
  for (const layers of [['drift-a'], ['drift-b'], ['drift-a', 'drift-b'], ['drift-b', 'drift-a']]) {
    for (const text of ['text-1', 'text-2', 'text-3', 'accent-on-tint', ...MEANING]) pairs.push(pair('text', text, ['surface-0', ...layers], 'page under the animated background'))
    pairs.push(pair('text', 'text-2', ['surface-0', ...layers, 'segment-track'], 'tab track under the animated background'))
  }
  return pairs
}

export const PAIRS: readonly Pair[] = build()

// ───────────── What a theme may and may not set (DEC-047) ─────────────

/** The only colour tokens a theme's palette rule may declare: backgrounds, surfaces, the sidebar, lines, and the accent with its tint, text and focus ring. */
export const PALETTE_TOKENS = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-3',
  'sidebar-solid',
  'sidebar-native',
  'field',
  'field-border',
  'bezel',
  'line',
  'line-strong',
  'segment-thumb',
  'accent',
  'accent-tint',
  'accent-on-tint',
  'focus',
  'drift-a',
  'drift-b'
] as const

/** The tokens of the scheme: the same in every theme of one side (light or dark), and so in every theme's measurements. */
export const SCHEME_TOKENS = [
  'text-1',
  'text-2',
  'text-3',
  'on-accent',
  'selection',
  'hover-fill',
  'press-fill',
  'segment-track',
  'success',
  'success-bg',
  'attention',
  'attention-bg',
  'on-attention',
  'error',
  'error-bg',
  'on-error',
  'info',
  'info-bg',
  'shadow-control',
  'shadow-thumb',
  'shadow-pop',
  'scrim',
  'glyph-updown',
  'series-1',
  'series-2',
  'series-3',
  'series-4'
] as const
