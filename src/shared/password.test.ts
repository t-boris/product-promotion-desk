import { describe, expect, it } from 'vitest'
import { generatePassword, secureRandomBelow } from './password'

describe('generatePassword', () => {
  it('is 20 characters by default, with every kind of character, and never the confusing ones', () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword()
      expect(password).toHaveLength(20)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[-_!@#%&*]/)
      expect(password).not.toMatch(/[0OlI1]/)
    }
  })

  it('is different every time', () => {
    expect(new Set(Array.from({ length: 100 }, () => generatePassword())).size).toBe(100)
  })

  it('keeps at least one of each kind even for a short length', () => {
    expect(generatePassword(2)).toHaveLength(4)
  })

  it('draws every position from the whole alphabet, evenly enough', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i++) for (const c of generatePassword(20)) counts.set(c, (counts.get(c) ?? 0) + 1)
    const values = [...counts.values()]
    // 80000 draws over ~58 characters: nothing should be far from the average of ~1380.
    expect(Math.min(...values)).toBeGreaterThan(900)
    expect(Math.max(...values)).toBeLessThan(2000)
  })

  it('secureRandomBelow stays inside its limit', () => {
    for (let i = 0; i < 1000; i++) expect(secureRandomBelow(7)).toBeLessThan(7)
  })
})
