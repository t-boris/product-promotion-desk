import type { LogLevel, RunKind, RunStatus, SendState } from '../../../../shared/types'
import type { Tone } from '../../ui'

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  monitor: 'Check channel',
  analysis: 'Product analysis',
  send: 'Send',
  reconcile: 'Check uncertain send',
  metrics: 'Refresh metrics',
  assess: 'Assess channel',
  draft: 'Prepare draft'
}

export const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  running: 'info',
  ok: 'good',
  failed: 'bad',
  skipped: 'neutral',
  suspended: 'warn'
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  ok: 'OK',
  failed: 'Failed',
  skipped: 'Skipped',
  suspended: 'Needs you'
}

export const SEND_STATE_TONE: Record<SendState, Tone> = {
  sending: 'info',
  confirmed: 'good',
  failed: 'bad',
  unknown: 'warn'
}

export const SEND_STATE_LABEL: Record<SendState, string> = {
  sending: 'Sending',
  confirmed: 'Confirmed',
  failed: 'Failed',
  unknown: 'Result unknown'
}

export const LEVEL_TONE: Record<LogLevel, Tone> = { info: 'neutral', warn: 'warn', error: 'bad' }

export function durationText(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return ''
  const ms = Date.parse(finishedAt) - Date.parse(startedAt)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return '<1 s'
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}
