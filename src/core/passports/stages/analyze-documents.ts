import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { classifyDocument, readDocumentText } from '../documents'
import { redactSecrets } from '../redact'
import { sha256 } from '../text'
import { extractFindings, type Material } from './extract'
import type { FindingsData, StageDef } from './types'

function fileStamp(path: string): { size: number; mtimeMs: number } | null {
  try {
    const st = statSync(path)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Reads the product description text and the text-like documents (text, markdown, html, json). Other files and all
 * images are attached as materials and not analyzed.
 */
export const analyzeDocumentsStage: StageDef = {
  name: 'analyze_documents',
  startMessage: 'Analyzing the description and documents…',
  needsEngine: true,
  inputs: (ctx) =>
    ctx.sources
      .filter((s) => s.kind === 'text' || s.kind === 'document')
      .map((s) => (s.kind === 'text' ? { id: s.id, text: sha256(s.ref) } : { id: s.id, ref: s.ref, stamp: fileStamp(s.ref) })),
  async run(ctx) {
    const materials: Material[] = []
    const attached: string[] = []
    const notes: string[] = []
    const verifiedAt = ctx.now()
    let texts = 0
    let docs = 0
    for (const source of ctx.sources) {
      if (source.kind === 'image') {
        attached.push(source.label)
      } else if (source.kind === 'text') {
        materials.push({
          block: { key: `T${++texts}`, type: 'description', ref: source.label, text: redactSecrets(source.ref).text },
          evidence: [{ sourceId: source.id, ref: `Text: ${source.label}`, sourceKind: 'text', verifiedAt }]
        })
      } else if (source.kind === 'document') {
        if (classifyDocument(source.ref) !== 'text') {
          attached.push(basename(source.ref))
          continue
        }
        const doc = readDocumentText(source.ref)
        if (!doc) {
          notes.push(`${source.label} could not be read`)
          continue
        }
        if (doc.truncated) notes.push(`${source.label} is long; only its beginning was analyzed`)
        materials.push({
          block: { key: `D${++docs}`, type: 'document', ref: source.label, text: doc.text },
          evidence: [{ sourceId: source.id, ref: source.ref, sourceKind: 'document', verifiedAt }]
        })
      }
    }
    if (materials.length === 0) {
      const data: FindingsData = { findings: [], materials: attached, notes }
      return { status: 'skipped', detail: attached.length ? `No text to analyze; ${attached.length} file(s) attached as materials.` : 'No description or document to analyze.', data }
    }
    ctx.progress(`Analyzing ${materials.length} source${materials.length === 1 ? '' : 's'}`)
    const result = await extractFindings(ctx, { label: 'passport.documents', materials, codeOnly: false, perBlock: 20_000, total: 60_000 })
    const data: FindingsData = { findings: result.findings, materials: attached, notes: [...notes, ...result.notes] }
    const extra = data.notes.length ? ` (${data.notes.join('; ')})` : ''
    return { status: 'done', detail: `${result.findings.length} statement${result.findings.length === 1 ? '' : 's'} found in ${materials.length} source${materials.length === 1 ? '' : 's'}${extra}.`, data }
  }
}
