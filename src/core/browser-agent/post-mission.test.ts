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
