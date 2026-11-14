// The decisions of "Draft with AI" in the new-publication form that need no screen: when the whole-post helper is offered, when its text
// may still be put in, and when "Undo" is still honest. Pure, so they are tested without the interface (lesson 101).

/** The two fields the whole-post helper writes. */
export interface PostText {
  title: string
  text: string
}

/** The helper writes a post from nothing: it is offered while the title and the text are both empty (per-field help covers the rest). */
export function postFormEmpty(form: PostText): boolean {
  return form.title.trim() === '' && form.text.trim() === ''
}

/** The AI's post is put in only if both fields still hold what they held when the question was asked: typing meanwhile wins (lesson 84). */
export function canApplyPost(asked: PostText, now: PostText): boolean {
  return asked.title === now.title && asked.text === now.text
}

/** Undo is offered only while both fields still hold exactly what the AI wrote; once the owner types, the text is theirs again. */
export function postUndoable(now: PostText, applied: PostText | null): boolean {
  return applied !== null && canApplyPost(applied, now)
}

/** The helper stays on the screen while it is offered or while its note and "Undo" are, so the buttons do not vanish under the pointer. */
export function showPostHelper(form: PostText, applied: PostText | null): boolean {
  return postFormEmpty(form) || postUndoable(form, applied)
}
