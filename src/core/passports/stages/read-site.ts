import { readSite } from '../url-reader'
import { StageFailure, type SiteData, type StageDef } from './types'

/** Fetches the product website (and a few related pages). Needs no AI engine; an unreachable site is not fatal. */
export const readSiteStage: StageDef = {
  name: 'read_site',
  startMessage: 'Reading the website…',
  needsEngine: false,
  inputs: (ctx) => ctx.sources.filter((s) => s.kind === 'url').map((s) => ({ id: s.id, ref: s.ref })),
  async run(ctx) {
    const urls = ctx.sources.filter((s) => s.kind === 'url')
    if (urls.length === 0) return { status: 'skipped', detail: 'No website was provided.', data: null }
    const data: SiteData = { pages: [], failures: [] }
    for (const source of urls) {
      ctx.progress(`Reading ${source.ref}`)
      const result = await readSite(source.ref, { signal: ctx.signal, now: () => new Date(ctx.now()), userAgent: ctx.userAgent })
      data.pages.push(...result.pages.map((page) => ({ ...page, sourceId: source.id })))
      data.failures.push(...result.failures.map((failure) => ({ ...failure, sourceId: source.id })))
    }
    if (data.pages.length === 0) {
      const first = data.failures[0]
      throw new StageFailure(
        `The website could not be read (${first ? `${first.url}: ${first.error}` : 'no answer'}). The product is kept: add a description or documents, or enter the passport by hand, then run the analysis again.`
      )
    }
    const missed = data.failures.length > 0 ? `; ${data.failures.length} related page${data.failures.length === 1 ? '' : 's'} could not be read` : ''
    return { status: 'done', detail: `Read ${data.pages.length} page${data.pages.length === 1 ? '' : 's'}${missed}.`, data }
  }
}
