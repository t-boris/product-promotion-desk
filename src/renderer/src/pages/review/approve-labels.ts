// The words of the two approving buttons of a review card. Pure, so the labels are tested without the interface.

/**
 * "Approve" and "Approve and send", and when the owner has edited the draft since it was saved (`dirty`) the buttons save it first, so
 * they say so. The send button names its three steps with commas, "Save, approve and send"; "Save and approve and send" read as two
 * "and"s in a row (BUG-057).
 */
export function approveLabels(dirty: boolean): { approve: string; approveAndSend: string } {
  return dirty ? { approve: 'Save and approve', approveAndSend: 'Save, approve and send' } : { approve: 'Approve', approveAndSend: 'Approve and send' }
}
