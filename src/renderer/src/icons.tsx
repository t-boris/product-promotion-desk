import type { ReactNode } from 'react'

/**
 * The glyphs of the interface (visual-system.md §8): drawn for this app in the manner of SF Symbols (SF Symbols themselves are not
 * embedded and no icon library is used). One 16 × 16 box, a 1.5px stroke in `currentColor`, round caps and joins, no fill: a dot is a
 * zero-length stroke. The colour and the size come from the surrounding CSS (`.icon`, `.icon-sm`).
 */
const GLYPHS = {
  // The sidebar toggle.
  sidebar: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6 2.75v10.5" />
    </>
  ),
  // The seven main areas.
  attention: (
    <>
      <path d="M8 2.25c-2.15 0-3.75 1.65-3.75 3.8v2.5L3 10.75h10l-1.25-2.2v-2.5c0-2.15-1.6-3.8-3.75-3.8z" />
      <path d="M6.6 12.75a1.5 1.5 0 0 0 2.8 0" />
    </>
  ),
  products: (
    <>
      <path d="M8 1.75 13.75 4.6v6.8L8 14.25 2.25 11.4V4.6z" />
      <path d="M2.25 4.6 8 7.45l5.75-2.85M8 7.45v6.8" />
    </>
  ),
  accounts: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="6.6" r="2.1" />
      <path d="M4.3 12.3c.9-1.45 2.2-2.2 3.7-2.2s2.8.75 3.7 2.2" />
    </>
  ),
  opportunities: <path d="M3 2.75h10c.7 0 1.25.55 1.25 1.25v5.75c0 .7-.55 1.25-1.25 1.25H7.6l-3.1 2.5V11H3c-.7 0-1.25-.55-1.25-1.25V4c0-.7.55-1.25 1.25-1.25z" />,
  publications: (
    <>
      <path d="M14.25 1.75 1.75 7.1l5.1 2.05 2.05 5.1z" />
      <path d="M14.25 1.75 6.85 9.15" />
    </>
  ),
  logs: <path d="M6.25 4h7.5M6.25 8h7.5M6.25 12h7.5M3 4h.01M3 8h.01M3 12h.01" />,
  settings: (
    <>
      <path d="M12.68 6.24 L14.51 6.92 L14.51 9.08 L12.68 9.76 L12.55 10.06 L13.37 11.84 L11.84 13.37 L10.06 12.55 L9.76 12.68 L9.08 14.51 L6.92 14.51 L6.24 12.68 L5.94 12.55 L4.16 13.37 L2.63 11.84 L3.45 10.06 L3.32 9.76 L1.49 9.08 L1.49 6.92 L3.32 6.24 L3.45 5.94 L2.63 4.16 L4.16 2.63 L5.94 3.45 L6.24 3.32 L6.92 1.49 L9.08 1.49 L9.76 3.32 L10.06 3.45 L11.84 2.63 L13.37 4.16 L12.55 5.94Z" />
      <circle cx="8" cy="8" r="2.1" />
    </>
  ),
  // Actions and chrome.
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  play: <path d="M5 3.25v9.5L12.5 8z" />,
  pause: <path d="M5.75 3.75v8.5M10.25 3.75v8.5" />,
  chevronRight: <path d="M6 3.75 10.25 8 6 12.25" />,
  chevronDown: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  chevronUpDown: <path d="M5.5 6.25 8 3.75l2.5 2.5M5.5 9.75 8 12.25l2.5-2.5" />,
  check: <path d="M3.25 8.5 6.5 11.5l6.25-7" />,
  xmark: <path d="M4 4l8 8M12 4l-8 8" />,
  ellipsis: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.5" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5M8 5.1h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.25 14.25 13H1.75z" />
      <path d="M8 6.5v3M8 11.25h.01" />
    </>
  ),
  sparkles: (
    <>
      <path d="M6.5 2.75 7.6 6l3.25 1.1L7.6 8.2 6.5 11.45 5.4 8.2 2.15 7.1 5.4 6z" />
      <path d="M12.25 2v3M10.75 3.5h3M12 10.25v2.5M10.75 11.5h2.5" />
    </>
  )
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof GLYPHS

/** A glyph. Decorative: it hides itself from assistive technology, so a button keeps the accessible name of its words. */
export function Icon({ name, small = false }: { name: IconName; small?: boolean }) {
  return (
    <svg className={`icon${small ? ' icon-sm' : ''}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-icon={name}>
      {GLYPHS[name]}
    </svg>
  )
}
