// The colours of the template card (REQ-003, DEC-045). Card colours are canvas gradients, not theme tokens: the card is a picture that is
// sent to a platform, so it looks the same in the light and the dark theme of the application. Every gradient is dark enough for white ink.

import type { CardColour } from '../../../../../shared/quick-post'

export interface CardPalette {
  label: string
  /** The three stops of the diagonal gradient, from the top left to the bottom right. */
  stops: readonly [string, string, string]
  /** The colour of the words and the marks on the card. */
  ink: string
}

export const CARD_PALETTES: Record<CardColour, CardPalette> = {
  indigo: { label: 'Indigo', stops: ['#4338ca', '#5b30d3', '#6d28d9'], ink: '#ffffff' },
  sunset: { label: 'Sunset', stops: ['#c2410c', '#d02a48', '#be185d'], ink: '#ffffff' },
  ocean: { label: 'Ocean', stops: ['#0369a1', '#05738a', '#0f766e'], ink: '#ffffff' },
  forest: { label: 'Forest', stops: ['#166534', '#1d6b3a', '#3f6212'], ink: '#ffffff' },
  berry: { label: 'Berry', stops: ['#9d174d', '#82207d', '#6b21a8'], ink: '#ffffff' },
  graphite: { label: 'Graphite', stops: ['#1f2937', '#374151', '#4b5563'], ink: '#ffffff' }
}

const channel = (hex: string, at: number): number => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)

/** The WCAG contrast ratio of two `#rrggbb` colours: 1 (the same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** The least contrast between the ink of a colour and any stop of its gradient. */
export function leastContrast(colour: CardColour): number {
  const { stops, ink } = CARD_PALETTES[colour]
  return Math.min(...stops.map((stop) => contrastRatio(ink, stop)))
}
