// "Fill from the website" on the New product form, as plain logic (lesson 101): which fields the proposal fills and what is said about it.
// Never replace what the owner typed (lesson 84): a field that has text is kept, a field that is empty is filled.

export interface ProductForm {
  name: string
  websiteUrl: string
  description: string
}

export interface SiteProposal {
  name: string
  description: string
  /** The address the proposal was read from, as the app reads it (https:// added, no fragment). */
  websiteUrl: string
}

type Filled = 'name' | 'description'

export interface Applied {
  form: ProductForm
  filled: Filled[]
  kept: Filled[]
}

const isEmpty = (text: string): boolean => text.trim() === ''

export function applySiteProposal(form: ProductForm, proposal: SiteProposal): Applied {
  const filled: Filled[] = []
  const kept: Filled[] = []
  const next: ProductForm = { ...form, websiteUrl: proposal.websiteUrl }
  for (const key of ['name', 'description'] as const) {
    if (isEmpty(form[key])) {
      next[key] = proposal[key]
      filled.push(key)
    } else kept.push(key)
  }
  return { form: next, filled, kept }
}

/** What the owner is told after the proposal, in words. */
export function siteProposalNote(applied: Applied): string {
  if (applied.filled.length === 0) return 'Kept what you wrote. Clear a field to let the site fill it.'
  const what = applied.filled.join(' and the ')
  if (applied.kept.length === 0) return `Filled the ${what} from the site. Check them before you create the product.`
  return `Filled the ${what} from the site, and kept your ${applied.kept.join(' and your ')}. Check it before you create the product.`
}
