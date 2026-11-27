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
  // The main areas.
  overview: <path d="M3 13.25V8.5M8 13.25V3.25M13 13.25V6.5" />,
  review: (
    <>
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.75" />
      <path d="M2.25 6.5h11.5M5.25 1.75v3M10.75 1.75v3M5.5 10.25l1.75 1.5 3.25-3.25" />
    </>
  ),
  inbox: (
    <>
      <path d="M2.25 9.5 4 3.75h8l1.75 5.75v2.25c0 .7-.55 1.25-1.25 1.25h-9c-.7 0-1.25-.55-1.25-1.25z" />
      <path d="M2.25 9.5h3.2l.8 1.75h3.5l.8-1.75h3.2" />
    </>
  ),
  feed: (
    <>
      <path d="M3.25 3.25c5.5 0 9.5 4 9.5 9.5M3.25 7.25c3.3 0 5.5 2.2 5.5 5.5" />
      <path d="M3.75 12.75h.01" />
    </>
  ),
  people: (
    <>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M1.75 13c.4-2.3 2.1-3.75 4.25-3.75S9.85 10.7 10.25 13M10.5 3.6a2.1 2.1 0 0 1 0 3.8M11.75 9.6c1.3.5 2.2 1.7 2.5 3.4" />
    </>
  ),
  posts: (
    <>
      <path d="M14.25 1.75 1.75 7.1l5.1 2.05 2.05 5.1z" />
      <path d="M14.25 1.75 6.85 9.15" />
    </>
  ),
  channels: (
    <>
      <circle cx="3.75" cy="8" r="1.5" />
      <circle cx="12.25" cy="3.75" r="1.5" />
      <circle cx="12.25" cy="12.25" r="1.5" />
      <path d="M5.1 7.3 10.9 4.5M5.1 8.7 10.9 11.5" />
    </>
  ),
  accounts: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="6.6" r="2.1" />
      <path d="M4.3 12.3c.9-1.45 2.2-2.2 3.7-2.2s2.8.75 3.7 2.2" />
    </>
  ),
  setup: (
    <>
      <path d="M2.5 4.5h5.75M11.75 4.5h1.75M2.5 11.5h1.75M7.75 11.5h5.75" />
      <circle cx="10" cy="4.5" r="1.75" />
      <circle cx="6" cy="11.5" r="1.75" />
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
  // The score of a post and the number of its comments, on the card of the Feed.
  arrowUp: <path d="M8 13V3.5M4 7.25 8 3.25l4 4" />,
  comment: <path d="M2.75 3.75h10.5v6.5H8.4L5 13v-2.75H2.75z" />,
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
