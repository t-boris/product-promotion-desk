// The flair of a post (Reddit's label a community asks of a post, often requires): how the application finds the control that opens the picker, the
// option of the approved name, the control that confirms it, and reads back that the form shows it. Everything here is judged by the words and the roles
// of the page's own elements, as the rest of the post mission is, and is the same on any site that has such a picker. The AI never gives a flair and never
// clicks inside the picker: the approved name is the only one the application chooses.

import { sameFlair } from '../../shared/flair'
import type { SnapshotElement } from './snapshot'

type Control = Pick<SnapshotElement, 'ref' | 'role' | 'name'> & Partial<Pick<SnapshotElement, 'value' | 'checked' | 'disabled' | 'required'>>

export { sameFlair }

/** The words of a control that opens a picker of flairs, tags or labels. English and Russian, whole words. */
const OPENER = /(?<![\p{L}\p{N}])(?:flairs?|tags?|labels?|фл[еэ]й?р\p{L}*|тег\p{L}*|метк\p{L}*)(?![\p{L}\p{N}])/iu
const OPENER_ROLE = /^(?:button|combobox|select|listbox)$/
/** Roles of a choice in a picker; a button is one only when nothing better has the name (the chosen flair is a button too once it is set). */
const CHOICE_ROLE = /^(?:radio|option|menuitem|menuitemradio|checkbox|listitem)$/
const EXPANDER = /^\s*(?:view|show|see|load)\s+(?:all|more)\b/i
const CONFIRM = /^\s*(?:add|apply|done|save|select|choose|ok|confirm)\s*$/i

/** Why this control is not one that opens a flair picker, or null when it is. */
export function openerProblem(control: Control): string | null {
  if (!OPENER_ROLE.test(control.role) || !OPENER.test(control.name)) {
    return `"${control.name || control.ref}" is not the control that opens the flair picker (a button or a list named like flair, tag or label). Look at the page again with browser_snapshot and name that control, or report needs_owner when the form has none.`
  }
  return null
}

/** The controls that choose a flair by a plain list (a select or a combobox): the application opens it and picks the option itself. */
export const choosesFromList = (control: Control): boolean => control.role === 'select' || control.role === 'combobox'

/**
 * Whether the form shows the flair as set: a button that carries its name (what Reddit shows in place of "Add flair and tags"), a list that holds it, or a
 * choice that is made when no control is left to confirm it (a radio in an open picker is not applied until its "Add" is pressed).
 */
export function flairShown(elements: readonly Control[], flair: string): boolean {
  const pending = elements.some((e) => e.role === 'button' && CONFIRM.test(e.name) && e.disabled !== true)
  return elements.some((e) => {
    if (e.role === 'button') return sameFlair(e.name, flair)
    if (choosesFromList(e)) return typeof e.value === 'string' && sameFlair(e.value, flair)
    if (e.role === 'radio' || e.role === 'checkbox' || e.role === 'option') return e.checked === true && sameFlair(e.name, flair) && !pending
    return false
  })
}

/** The choice of the approved name in an open picker, or null. A list item is preferred to a button of the same name. */
export function findFlairOption(elements: readonly Control[], flair: string, openerRef: string): Control | null {
  const named = elements.filter((e) => e.ref !== openerRef && e.disabled !== true && sameFlair(e.name, flair))
  return named.find((e) => CHOICE_ROLE.test(e.role)) ?? named.find((e) => e.role === 'button') ?? null
}

/** The control that shows more of a short list ("View all flairs"), or null. */
export const findExpander = (elements: readonly Control[]): Control | null => elements.find((e) => (e.role === 'button' || e.role === 'link') && EXPANDER.test(e.name) && e.disabled !== true) ?? null

/** The control that applies the choice of a picker ("Add", "Apply", "Done"), by its whole name, or null. */
export const findConfirm = (elements: readonly Control[]): Control | null => elements.find((e) => e.role === 'button' && CONFIRM.test(e.name) && e.disabled !== true) ?? null

/** The names a picker offers now, for the AI to say which ones it saw. */
export function offeredFlairs(elements: readonly Control[]): string[] {
  return elements.filter((e) => CHOICE_ROLE.test(e.role) && e.name.trim() !== '' && !/^no flair$/i.test(e.name.trim())).map((e) => e.name.trim())
}

/**
 * A control the form marks as required (a star at the end of its name, a list that is required and empty) and that nothing the application fills answers:
 * a press now is one the site is sure to refuse, whatever the words of the post. The fields the application types into and the control that publishes are
 * `exclude`d.
 */
export function requiredUnmet(elements: readonly Control[], exclude: ReadonlySet<string>): Control | null {
  return (
    elements.find((e) => {
      if (exclude.has(e.ref)) return false
      if (OPENER_ROLE.test(e.role) && /\*\s*$/.test(e.name.trim())) return true
      return (e.role === 'select' || e.role === 'combobox') && e.required === true && (e.value ?? '').trim() === ''
    }) ?? null
  )
}
