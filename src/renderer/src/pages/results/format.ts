import type { MetricSnapshot } from '../../../../shared/types'

const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** The only place that decides how a metric reads: a number, or null meaning "Unavailable" (never "0"). */
export function metricDisplay(metric: Pick<MetricSnapshot, 'available' | 'value'>): string | null {
  return metric.available && metric.value !== null ? numbers.format(metric.value) : null
}
