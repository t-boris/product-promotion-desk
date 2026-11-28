// The topic of a post (Threads files a post under one topic, typed into a field of its composer): what a topic may be, and which platforms have the
// field. One rule for the editor that takes it, the core that stores it, the AI that proposes it and the application that types it on the site, so a
// topic the owner approved is one the site's field holds as it was typed. The limits are Meta's published ones for a Threads topic (1 to 50
// characters, no periods, no ampersands).

import { formOf } from './post-format'

export const TOPIC_TAG_LIMIT = 50

/** Whether the platform's composer has a field for one topic (Threads). The editor shows its Topic line, and a draft may carry a topic, only there. */
export const hasTopicField = (platform: string): boolean => formOf(platform).topic === 'field'

/** A topic as it is kept: without the "#" people write before it, on one line, with single spaces. Empty when nothing is left. */
export const cleanTopicTag = (raw: string): string => raw.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '')

/** Why this text cannot be a topic, in words, or null. Asked of a cleaned, non-empty topic. */
export function topicTagProblem(tag: string): string | null {
  if (Array.from(tag).length > TOPIC_TAG_LIMIT) return `The topic is longer than ${TOPIC_TAG_LIMIT} characters.`
  if (/[.&]/.test(tag)) return 'A topic cannot hold a period or an ampersand (&): Threads does not take them.'
  return null
}

/** What the AI that writes a post is told about the topic, for a platform that has the field; null for one that has none. */
export function topicRuleOf(platform: string): string | null {
  if (!hasTopicField(platform)) return null
  return `This platform files a post under ONE topic. Give it in "topicTag": one to three words, the subject a reader would follow (not the product's name), in the language of the post, at most ${TOPIC_TAG_LIMIT} characters, with no "#", no period and no "&". The owner sees it and may change it.`
}
