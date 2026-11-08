// The role a draft was written in (DEC-010) is part of the draft's basis: the owner sees which voice was used.

import type { RoleView } from './context'

/** Appends which role the AI wrote in to the rationale shown with the draft; unchanged when the login has no role. */
export function withRole(rationale: string, role: RoleView | null): string {
  if (!role) return rationale
  const note = `Role used: ${role.name}.`
  return rationale ? `${rationale}\n${note}` : note
}
