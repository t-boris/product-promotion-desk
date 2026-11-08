import { describe, expect, it } from 'vitest'
import { missionPrompt, type Mission } from './mission'

const base: Mission = { goal: 'Fill in the profile.', facts: ['The account is called "A".'], startUrl: null, hosts: ['instagram.com'], values: {} }

describe('mission brief: what the owner taught the AI', () => {
  it('lists the rules the owner taught, before the way of working, and tells the AI to follow them and not to ask again', () => {
    const prompt = missionPrompt({ ...base, lessons: ['Shrink a picture to under 500 KB before uploading it.', 'Edit only the editable fields.'] }, '2026-11-08')
    const taught = prompt.indexOf('WHAT THE OWNER TAUGHT YOU EARLIER')
    expect(taught).toBeGreaterThan(-1)
    expect(taught).toBeLessThan(prompt.indexOf('HOW TO WORK'))
    expect(prompt).toContain('- Shrink a picture to under 500 KB before uploading it.')
    expect(prompt).toContain('- Edit only the editable fields.')
    expect(prompt).toContain('do not ask the owner about them again')
  })

  it('has no such section when nothing was taught, but still tells the AI how to keep a new rule', () => {
    const prompt = missionPrompt(base, '2026-11-08')
    expect(prompt).not.toContain('WHAT THE OWNER TAUGHT YOU EARLIER')
    expect(prompt).toContain('remember_lesson')
    expect(prompt).toContain('Not for a one-time answer')
  })
})
