import { describe, expect, it } from 'vitest'
import { postMissionPrompt } from './post-mission'
import type { ApprovedContent, PostAuthority, PostMissionRequest } from './post-submit'

function brief(platform: string, over: Partial<ApprovedContent> = {}): string {
  const content: ApprovedContent = {
    kind: 'post',
    title: null,
    text: 'A caption.',
    link: null,
    destination: `https://www.${platform}.com/brand/`,
    attachments: [{ name: 'picture-1.png', path: '/data/media/a.png', sha256: 'a'.repeat(64) }],
    ...over
  }
  const authority = { content } as unknown as PostAuthority
  const request: PostMissionRequest = { accountId: 'a1', accountLabel: 'Brand', authority, hosts: [`${platform}.com`], platform, facts: ['The owner\'s own approved post.'] }
  return postMissionPrompt(request, '2026-11-21')
}

describe('the brief of a quick post (one picture, a caption or none)', () => {
  it.each(['instagram', 'threads', 'facebook'])('%s: says the picture goes in with ONE browser_attach before browser_submit, and the application types the caption', (platform) => {
    const text = brief(platform)
    expect(text).toContain('The approved post has no title, a text of 10 characters, and 1 approved picture (picture-1.png)')
    expect(text).toContain('ONE call of browser_attach')
    expect(text).toContain('You do NOT type the text')
    expect(text).toContain('browser_attach')
    expect(text).not.toContain('The approved post has no caption')
  })

  it.each(['instagram', 'threads', 'facebook'])('%s: a picture alone is told to be published with the control only, naming no field', (platform) => {
    const text = brief(platform, { text: '' })
    expect(text).toContain('no text')
    expect(text).toContain('The approved post has no caption, so nothing is typed: call browser_submit with submit_ref only')
  })

  it('a post that has no pictures and no words is not given the caption-less line, and a picture with a link is not either', () => {
    expect(brief('instagram', { text: '', attachments: [] })).not.toContain('has no caption')
    expect(brief('facebook', { text: '', link: 'https://natalmystic.com' })).not.toContain('has no caption')
  })

  it('names the platform\'s form in the recipe: Instagram goes on with Next twice then Share, Facebook uses its Photo/video entry, Threads its attach-media entry', () => {
    expect(brief('instagram')).toMatch(/Create.*Next \(twice, to the caption step\).*Share/s)
    expect(brief('facebook')).toMatch(/Photo\/video.*file input.*"Post"/s)
    expect(brief('threads')).toMatch(/attach-media.*"Post"/s)
  })
})

describe('the brief of a video post', () => {
  const video = [{ name: 'video-1.mp4', path: '/data/media/v.mp4', sha256: 'b'.repeat(64) }]
  it.each(['instagram', 'facebook', 'threads', 'reddit'])('%s: names the file a video, puts it in with browser_attach, waits for the site to read it and never shrinks it', (platform) => {
    const text = brief(platform, { attachments: video })
    expect(text).toContain('1 approved video (video-1.mp4)')
    expect(text).toContain('ONE call of browser_attach')
    expect(text).toContain('The approved file is a VIDEO')
    expect(text).toContain('browser_wait_for')
    expect(text).toContain('shrink_to_kb is only for pictures')
  })

  it('a post with pictures is not told about videos', () => {
    const text = brief('instagram')
    expect(text).not.toContain('VIDEO')
    expect(text).toContain('1 approved picture (picture-1.png)')
  })
})

describe('what the brief says about clicking (DEC-051)', () => {
  const reply = (): string =>
    brief('reddit', { kind: 'reply', text: 'Thanks for the question.', attachments: [], destination: 'https://www.reddit.com/r/beginnerastrology/comments/1abc/a_post/def/' })
  const newPost = (): string => brief('reddit', { kind: 'post', title: 'A title', text: 'A body.', attachments: [], destination: 'https://www.reddit.com/r/beginnerastrology/' })

  it('a reply: the Reply control under the comment may be clicked (a link or a button), then the AI looks again and names the empty field and the button in browser_submit', () => {
    const text = reply()
    expect(text).toContain('click the "Reply" control under that comment (a link or a button)')
    expect(text).toContain('leave it empty')
    expect(text).toContain('look at the page again with browser_snapshot, find the empty reply field and the button that publishes in that form, and name them in browser_submit')
  })

  it('says the true rule: a control that publishes is clicked only while every field is empty, to open a form, and after that only browser_submit presses it', () => {
    for (const text of [reply(), newPost()]) {
      expect(text).toContain('is clicked by you only while every field is empty, to open a form; after that only browser_submit presses it')
      expect(text).toContain('While any field holds text nothing is clicked or chosen at all')
    }
  })

  it('does not say any more that such a control is never clicked or is refused whatever the page shows', () => {
    for (const text of [reply(), newPost(), brief('instagram')]) {
      expect(text).not.toContain('is never clicked by you')
      expect(text).not.toContain('it is refused')
      expect(text).not.toContain('publishes nothing')
    }
  })

  it('a new post: a "Create post" button opens the form, the form is left empty, and browser_submit does the rest', () => {
    const text = newPost()
    expect(text).toContain('a "Create post" button opens it')
    expect(text).toContain('Leave the form empty.')
    expect(text).toContain('call browser_submit ONCE with the labels of the fields and of the button')
    expect(text).toContain('do not click that button yourself')
  })

  it('with pictures the brief keeps its own rule: only Next and Continue are clicked once they are in', () => {
    const text = brief('instagram')
    expect(text).toContain('Once the approved pictures are in the form, only the controls named Next or Continue are clicked')
    expect(newPost()).not.toContain('Once the approved pictures are in the form')
  })
})
