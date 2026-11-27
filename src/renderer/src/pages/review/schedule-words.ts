// The words of the "Send at" control, kept apart from the component so they are tested as text.

export const NO_SLOTS_TITLE = 'This channel has no posting times yet.'

/** What a planned time means for the item, by whether it is approved. The Mac has to be awake at that time: nothing is sent while it sleeps. */
export function scheduleHint(approved: boolean): string {
  return approved
    ? 'Approved: it is sent at this time by itself if the checks still pass. The Mac must be awake then.'
    : 'It is sent at this time by itself only if you approve it before that time. The Mac must be awake then.'
}
