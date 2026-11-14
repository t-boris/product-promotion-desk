// Which on-demand forms are open on a screen, oldest first, and which of them owns the screen's one filled button (BUG-040).
// Pure, so the rule is tested without the interface; `OpenFormsScope` in ui.tsx keeps the list.

/** The ids of the open forms, in the order they were opened. */
export type OpenFormIds = readonly string[]

/** A form opened: it joins the end of the list. A form already in the list keeps its place, so registering twice neither doubles it nor takes the filled button from a newer form. */
export function openForm(forms: OpenFormIds, id: string): OpenFormIds {
  return forms.includes(id) ? forms : [...forms, id]
}

/** A form closed: it leaves the list, and the form opened before it owns the filled button again. */
export function closeForm(forms: OpenFormIds, id: string): OpenFormIds {
  return forms.includes(id) ? forms.filter((form) => form !== id) : forms
}

/** The form that owns the filled button: the one opened last, or none when no form is open. */
export function mainForm(forms: OpenFormIds): string | null {
  return forms.length > 0 ? forms[forms.length - 1] : null
}
