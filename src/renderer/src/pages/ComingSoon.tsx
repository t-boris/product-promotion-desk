import { EmptyState, Page } from '../ui'

/** Placeholder replaced by the work area's real page. */
export function ComingSoon({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Page title={title} subtitle={subtitle}>
      <EmptyState title="Not available yet">This area is being built.</EmptyState>
    </Page>
  )
}
