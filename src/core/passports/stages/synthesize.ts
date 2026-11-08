import { askJson } from '../ai-json'
import { EvidenceTable, finalizeClaims, withPriceBackstop, type Finding } from '../evidence'
import { packBlocks, synthesisPrompt, type SourceBlock } from '../prompts'
import { hashJson } from '../text'
import { claimListValidator } from '../validate'
import { StageFailure, type FindingsData, type SiteData, type StageDef } from './types'

/**
 * Merges the website text and the findings into proposed passport claims. Every claim is 'proposed': nothing is
 * approved without the user. Evidence is resolved by the application, and price statements are verified against it.
 */
export const synthesizeStage: StageDef = {
  name: 'synthesize',
  startMessage: 'Forming the product description…',
  needsEngine: true,
  inputs: (ctx) => ({
    name: ctx.product.name,
    website: ctx.product.websiteUrl,
    site: hashJson(ctx.output<SiteData>('read_site')?.pages.map((p) => [p.url, p.text]) ?? null),
    documents: hashJson(ctx.output<FindingsData>('analyze_documents')?.findings ?? null),
    code: hashJson(ctx.output<FindingsData>('scan_code')?.findings ?? null)
  }),
  async run(ctx) {
    const pages = ctx.output<SiteData>('read_site')?.pages ?? []
    const findings: Finding[] = [...(ctx.output<FindingsData>('analyze_documents')?.findings ?? []), ...(ctx.output<FindingsData>('scan_code')?.findings ?? [])]
    if (pages.length === 0 && findings.length === 0) {
      throw new StageFailure(
        'There is nothing to analyze yet: the website could not be read or was not provided, and there is no description, document or source code. ' +
          'Add a description or documents and run the analysis again, or fill in the passport by hand.'
      )
    }

    const table = new EvidenceTable()
    const pageBlocks: SourceBlock[] = pages.map((page, i) => {
      const key = `W${i + 1}`
      const text = [page.title, page.description, page.siteName, page.text].filter(Boolean).join('\n')
      table.add(key, [{ sourceId: page.sourceId, ref: page.url, sourceKind: 'url', verifiedAt: page.fetchedAt }], text)
      return { key, type: 'website', ref: page.url, text }
    })
    const findingLines = findings.map((finding, i) => {
      const key = `E${i + 1}`
      table.add(key, finding.evidence, finding.text)
      return `${key} [${finding.section}/${finding.kind}] ${finding.text}`
    })

    const existing = ctx.passport.workingClaims()
    const packed = packBlocks(pageBlocks, 8_000, 30_000)
    const task = synthesisPrompt({
      productName: ctx.product.name,
      websiteUrl: ctx.product.websiteUrl,
      pages: packed.text,
      findings: findingLines.join('\n').slice(0, 40_000),
      existing: existing.map((c) => `- [${c.section}] ${c.text}`).join('\n').slice(0, 12_000)
    })
    const raw = await askJson(ctx.engine(), task, claimListValidator('claims'), { signal: ctx.signal, onProgress: ctx.progress })
    const result = finalizeClaims(raw, table)
    const proposed = withPriceBackstop(result.findings, existing)
    const notes = [...result.notes]
    return {
      status: 'done',
      detail: '',
      data: { proposed: proposed.length, notes },
      commit: () => {
        const { added, skipped } = ctx.passport.addGenerated(proposed)
        const extra = notes.length ? ` (${notes.join('; ')})` : ''
        const already = skipped > 0 ? `, ${skipped} already in the passport` : ''
        return { detail: `${added} claim${added === 1 ? '' : 's'} proposed for review${already}${extra}.` }
      }
    }
  }
}
