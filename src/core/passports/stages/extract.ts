// The shared core of the two extraction stages (documents, source code): fence the materials, ask the engine for
// findings, and turn the answer into findings whose sources are resolved by the application.

import { askJson } from '../ai-json'
import { EvidenceTable, finalizeClaims, type EvidenceRef, type Finding } from '../evidence'
import { extractionPrompt, packBlocks, type SourceBlock } from '../prompts'
import { claimListValidator } from '../validate'
import type { StageContext } from './types'

export interface Material {
  block: SourceBlock
  evidence: EvidenceRef[]
}

export async function extractFindings(
  ctx: StageContext,
  args: { label: string; materials: Material[]; codeOnly: boolean; perBlock: number; total: number }
): Promise<{ findings: Finding[]; notes: string[] }> {
  const table = new EvidenceTable()
  for (const m of args.materials) table.add(m.block.key, m.evidence, m.block.text)
  const packed = packBlocks(
    args.materials.map((m) => m.block),
    args.perBlock,
    args.total
  )
  const task = extractionPrompt({ label: args.label, productName: ctx.product.name, materials: packed.text, omitted: packed.omitted, codeOnly: args.codeOnly })
  const raw = await askJson(ctx.engine(), task, claimListValidator('findings'), { signal: ctx.signal, onProgress: ctx.progress })
  const { findings, notes } = finalizeClaims(raw, table)
  if (packed.omitted > 0) notes.push(`${packed.omitted} source${packed.omitted === 1 ? '' : 's'} did not fit into one request and ${packed.omitted === 1 ? 'was' : 'were'} not analyzed`)
  return { findings, notes }
}
