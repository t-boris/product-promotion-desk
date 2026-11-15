/** "Nov 12, 10:00 AM": a time in the viewer's zone, short enough for a row. Anything that is not a time comes back as a dash. */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '—' : at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
