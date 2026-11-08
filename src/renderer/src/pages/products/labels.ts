import type { AnalysisStageName, AnalysisStageStatus, AnalysisStatus, ClaimKind, ClaimStatus, PassportSection, SourceKind } from '../../../../shared/types'
import type { Tone } from '../../ui'

export const SECTION_LABELS: Record<PassportSection, string> = {
  identity: 'Identity',
  offer: 'Offer',
  audience: 'Audience',
  terms: 'Terms and price',
  geo_languages: 'Geography and languages',
  communication: 'Communication',
  materials: 'Materials',
  goals: 'Goals'
}

export const SECTION_HINTS: Record<PassportSection, string> = {
  identity: 'Official name, website, one-line description',
  offer: 'What the product does and the benefit for users',
  audience: 'Who it is for and which tasks it solves',
  terms: 'Prices, free features, limits and conditions',
  geo_languages: 'Where and in which languages it is offered',
  communication: 'Tone, allowed wording and promises to avoid',
  materials: 'Images, demos, reviews and links that exist',
  goals: 'The target action and how success is measured'
}

export const KIND_LABELS: Record<ClaimKind, string> = {
  fact: 'Fact',
  assumption: 'Assumption',
  unknown: 'Unknown',
  contradiction: 'Contradiction'
}

export const KIND_TONES: Record<ClaimKind, Tone> = {
  fact: 'info',
  assumption: 'neutral',
  unknown: 'warn',
  contradiction: 'bad'
}

export const KIND_HELP: Record<ClaimKind, string> = {
  fact: 'Stated by a source that was read; the source and the date it was checked are shown.',
  assumption: 'A guess or hypothesis. It has no source and is never presented as a fact.',
  unknown: 'Essential information that no source provides yet.',
  contradiction: 'Sources disagree. Neither version has been chosen: you decide.'
}

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  prohibited: 'Prohibited'
}

export const STATUS_TONES: Record<ClaimStatus, Tone> = {
  proposed: 'neutral',
  approved: 'good',
  rejected: 'neutral',
  prohibited: 'bad'
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  url: 'Website',
  text: 'Text',
  document: 'Document',
  image: 'Image',
  code_folder: 'Code folder'
}

export const SOURCE_PLACEHOLDERS: Record<SourceKind, string> = {
  url: 'https://example.com',
  text: 'Describe the product, paste notes or a price list',
  document: '/Users/you/Documents/product-brief.md',
  image: '/Users/you/Pictures/screenshot.png',
  code_folder: '/Users/you/projects/my-product'
}

export const STAGE_LABELS: Record<AnalysisStageName, string> = {
  read_site: 'Read the website',
  analyze_documents: 'Analyze documents and notes',
  scan_code: 'Scan the project code',
  synthesize: 'Compose the passport',
  find_contradictions: 'Look for contradictions'
}

export const STAGE_TONES: Record<AnalysisStageStatus, Tone> = {
  pending: 'neutral',
  running: 'info',
  done: 'good',
  failed: 'bad',
  skipped: 'neutral'
}

export const STAGE_STATUS_LABELS: Record<AnalysisStageStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped'
}

export const ANALYSIS_LABELS: Record<AnalysisStatus, string> = {
  idle: 'Not analyzed',
  running: 'Analyzing',
  paused: 'Paused',
  failed: 'Analysis failed',
  complete: 'Analyzed'
}

export const ANALYSIS_TONES: Record<AnalysisStatus, Tone> = {
  idle: 'neutral',
  running: 'info',
  paused: 'warn',
  failed: 'bad',
  complete: 'good'
}
