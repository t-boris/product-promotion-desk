// The Reddit page surface used for writing. This is the part that must be confirmed against the live
// site in the real-site prototype (plan item I-3, DEC-008): every selector lives here so a correction
// never touches the logic. Reading never depends on the page layout (it uses the JSON endpoints).
//
// Text, link and reply forms use old.reddit.com: its forms are plain server-rendered HTML with stable
// names. Image posts only exist in the current Reddit UI (shadow DOM), reached through the deep query
// the browser service applies to every selector.

export const OLD_ORIGIN = 'https://old.reddit.com'
export const NEW_ORIGIN = 'https://www.reddit.com'

export const oldSubmitUrl = (subreddit: string, kind: 'self' | 'link'): string =>
  `${OLD_ORIGIN}/r/${subreddit}/submit${kind === 'self' ? '?selftext=true' : ''}`

export const oldThreadUrl = (subreddit: string, postId: string, commentId?: string): string =>
  commentId ? `${OLD_ORIGIN}/r/${subreddit}/comments/${postId}/_/${commentId}/` : `${OLD_ORIGIN}/r/${subreddit}/comments/${postId}/`

export const imageSubmitUrl = (subreddit: string): string => `${NEW_ORIGIN}/r/${subreddit}/submit/?type=IMAGE`

export const SEL = {
  postForm: 'form#newlink',
  postTitle: 'form#newlink textarea[name="title"]',
  postUrl: 'form#newlink input[name="url"]',
  postText: 'form#newlink textarea[name="text"]',
  postSubmit: 'form#newlink button[name="submit"]',
  /** Any top-level comment box on a thread page (reachability check only). */
  commentBox: 'div.commentarea form.usertext textarea[name="text"]',
  replyLink: (fullname: string): string => `div.thing[data-fullname="${fullname}"] > div.entry ul.flat-list a[onclick*="reply"]`,
  replyText: (fullname: string): string => `form[id^="form-${fullname}"] textarea[name="text"]`,
  replySave: (fullname: string): string => `form[id^="form-${fullname}"] button.save`,
  imageFile: 'input[type="file"]',
  imageTitle: 'textarea[name="title"]',
  imageSubmit: '#inner-post-submit-button'
}

/** Visible validation / rate-limit messages on the old Reddit forms. */
export function formErrorsScript(scopeSelector: string): string {
  return `(() => {
  const scope = document.querySelector(${JSON.stringify(scopeSelector)}) || document;
  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
  return Array.from(scope.querySelectorAll('.error, .status.error, [id^="error-"]'))
    .filter((el) => visible(el) && el.textContent.trim())
    .map((el) => el.textContent.trim().slice(0, 200));
})()`
}

/** The newest comment by `author` below a given parent thing (old Reddit DOM), after a reply was saved. */
export function postedReplyScript(parentFullname: string, author: string): string {
  return `(() => {
  const parent = document.querySelector('div.thing[data-fullname=' + ${JSON.stringify(JSON.stringify(parentFullname))} + ']');
  const scope = parent ? parent.querySelector(':scope > div.child') : null;
  if (!scope) return null;
  const mine = Array.from(scope.querySelectorAll('div.thing.comment')).filter((el) => (el.getAttribute('data-author') || '').toLowerCase() === ${JSON.stringify(author.toLowerCase())});
  const last = mine[mine.length - 1];
  return last ? { fullname: last.getAttribute('data-fullname'), permalink: last.getAttribute('data-permalink') } : null;
})()`
}
