// Which analysis steps apply to a product, from its sources. Pure, so the rules are tested without the interface.
//
// The core lists all five steps for every product. A step that has no source to work on will not do anything, so showing it as
// "Waiting" promised work that never comes (QA finding 32). Here it says why it is not needed instead.

import type { AnalysisStage, AnalysisStageName, ProductSource } from '../../../../shared/types'

export const STAGE_ORDER: AnalysisStageName[] = ['read_site', 'analyze_documents', 'scan_code', 'synthesize', 'find_contradictions']

const NEEDS: Partial<Record<AnalysisStageName, { kinds: ProductSource['kind'][]; missing: string }>> = {
  read_site: { kinds: ['url'], missing: 'No website to read.' },
  analyze_documents: { kinds: ['text', 'document', 'image'], missing: 'No notes or documents to analyze.' },
  scan_code: { kinds: ['code_folder'], missing: 'No project folder to scan.' }
}

export interface PlannedStage {
  stage: AnalysisStage
  /** False when the step has nothing to work on and has not run: it is shown as not needed, with the reason. */
  needed: boolean
  reason: string
}

export function planStages(stages: AnalysisStage[], sources: Pick<ProductSource, 'kind'>[]): PlannedStage[] {
  return STAGE_ORDER.map((name) => stages.find((s) => s.name === name))
    .filter((s): s is AnalysisStage => s !== undefined)
    .map((stage) => {
      const need = NEEDS[stage.name]
      const missing = need !== undefined && !sources.some((s) => need.kinds.includes(s.kind))
      // A step that already ran or was skipped by the core keeps what the core says.
      const idle = stage.status === 'pending'
      return { stage, needed: !(missing && idle), reason: missing && idle ? need.missing : '' }
    })
}

/** Finished steps out of the steps that apply: the skipped-by-the-core count as finished, the not-needed ones are not counted at all. */
export function progressOf(planned: PlannedStage[]): { done: number; total: number } {
  const counted = planned.filter((p) => p.needed)
  return { done: counted.filter((p) => p.stage.status === 'done' || p.stage.status === 'skipped').length, total: counted.length }
}

const KIND_WORDS: Record<ProductSource['kind'], [string, string]> = {
  url: ['website', 'websites'],
  text: ['text', 'texts'],
  document: ['document', 'documents'],
  image: ['image', 'images'],
  code_folder: ['project folder', 'project folders']
}

/** "1 website, 2 texts" — what the analysis will read; "nothing yet" when there is no source. */
export function describeSources(sources: Pick<ProductSource, 'kind'>[]): string {
  if (sources.length === 0) return 'nothing yet'
  const kinds = Object.keys(KIND_WORDS) as ProductSource['kind'][]
  return kinds
    .map((kind) => ({ kind, n: sources.filter((s) => s.kind === kind).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${KIND_WORDS[x.kind][x.n === 1 ? 0 : 1]}`)
    .join(', ')
}
