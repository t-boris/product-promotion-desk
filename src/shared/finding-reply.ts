/**
 * What the look of the AI writes in front of its note on a post it judged worth a reply: a finding is only ever a notice, and this is how a notice says it
 * is one to answer. The Feed's "Worth a reply" list is the notices that carry it.
 */
export const WATCH_REPLY_PREFIX = 'Worth a reply: '

/** Whether a finding's note says the AI judged it worth a reply. */
export const isReplyNote = (relation: string): boolean => relation.startsWith(WATCH_REPLY_PREFIX)
