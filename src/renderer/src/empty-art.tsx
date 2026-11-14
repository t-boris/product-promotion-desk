/**
 * The line drawings of the empty states (BUG-036): one colour (the accent, through `currentColor`), a 48px square, inline SVG with
 * no library. Each kind of empty page gets its own; the three rising bars of the brand mark are the default.
 */
export type EmptyArt = 'launch' | 'inbox' | 'product' | 'channel' | 'draft' | 'list'

const PATHS: Record<EmptyArt, string[]> = {
  // The brand's three rising bars on a baseline.
  launch: ['M9 38h30', 'M14.5 34v-6', 'M24 34V21', 'M33.5 34V13'],
  // An empty tray.
  inbox: ['M8 28l5-15h22l5 15v8a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z', 'M8 28h9l2 4h10l2-4h9'],
  // A box.
  product: ['M24 8l14 7v18l-14 7-14-7V15z', 'M10 15l14 7 14-7', 'M24 22v18'],
  // A signal going out from one point.
  channel: ['M24 26.5v.01', 'M18 20a8.5 8.5 0 0 0 0 13', 'M30 20a8.5 8.5 0 0 1 0 13', 'M13 15a15.5 15.5 0 0 0 0 23', 'M35 15a15.5 15.5 0 0 1 0 23'],
  // A page with lines of text.
  draft: ['M14 8h14l8 8v22a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M28 8v8h8', 'M17.5 23h13', 'M17.5 29h13', 'M17.5 35h7'],
  // A short list.
  list: ['M11 14v.01', 'M11 24v.01', 'M11 34v.01', 'M18 14h19', 'M18 24h19', 'M18 34h12']
}

export function EmptyArtwork({ art }: { art: EmptyArt }) {
  return (
    <svg className="empty-art" viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-art={art}>
      {PATHS[art].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
