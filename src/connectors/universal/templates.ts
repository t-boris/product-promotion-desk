import type { PlaceholderName } from './profile'

export type PlaceholderValues = Partial<Record<PlaceholderName, string>>

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g
/** Values substituted into selectors must be identifier-like, so they can never alter the selector's structure. */
const SAFE_IN_SELECTOR = /^[A-Za-z0-9_:.-]{1,100}$/

/**
 * Fills `{{name}}` placeholders. `selector` context accepts identifier-like values only; `url` context
 * percent-encodes values (except a lone placeholder, which stands for a whole URL); `value` is verbatim text.
 */
export function renderTemplate(template: string, values: PlaceholderValues, context: 'selector' | 'url' | 'value'): string {
  const lone = /^\s*\{\{\s*[a-zA-Z]+\s*\}\}\s*$/.test(template)
  return template.replace(PLACEHOLDER, (_all, name: string) => {
    const value = values[name as PlaceholderName]
    if (value === undefined) throw new Error(`No value is available for {{${name}}}`)
    if (context === 'selector') {
      if (!SAFE_IN_SELECTOR.test(value)) throw new Error(`The value for {{${name}}} cannot be used inside a selector`)
      return value
    }
    if (context === 'url') return lone ? value : encodeURIComponent(value)
    return value
  })
}
