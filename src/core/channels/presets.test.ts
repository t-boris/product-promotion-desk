import { describe, expect, it } from 'vitest'
import { PLATFORM_PRESETS, handleOf, presetFor } from './presets'

const preset = (platform: string) => {
  const found = presetFor(platform)
  if (!found) throw new Error(`no preset for ${platform}`)
  return found
}

describe('the handle an address stands for (DEC-034)', () => {
  it('is the one name after the platform host, written the way an owner writes it', () => {
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/brand/')).toBe('@brand')
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/boris_chart_notebook')).toBe('@boris_chart_notebook')
    expect(handleOf(preset('instagram'), 'https://instagram.com/brand.official')).toBe('@brand.official')
    expect(handleOf(preset('threads'), 'https://www.threads.net/@brand')).toBe('@brand')
    expect(handleOf(preset('facebook'), 'https://www.facebook.com/brandpage')).toBe('@brandpage')
  })

  it('is nothing for a page that is not one handle: a group, a tag, the home page, a script', () => {
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/')).toBeNull()
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/explore/tags/charts')).toBeNull()
    expect(handleOf(preset('facebook'), 'https://www.facebook.com/groups/astrologyclub')).toBeNull()
    expect(handleOf(preset('facebook'), 'https://www.facebook.com/profile.php')).toBeNull()
    expect(handleOf(preset('instagram'), 'not an address')).toBeNull()
  })

  it('is nothing for a page of the platform itself that has the shape of a handle: explore, home, search, the web app', () => {
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/explore/')).toBeNull()
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/reels/')).toBeNull()
    expect(handleOf(preset('x'), 'https://x.com/home')).toBeNull()
    expect(handleOf(preset('x'), 'https://x.com/search')).toBeNull()
    expect(handleOf(preset('x'), 'https://x.com/Explore')).toBeNull() // in any case
    expect(handleOf(preset('facebook'), 'https://www.facebook.com/marketplace')).toBeNull()
    expect(handleOf(preset('pinterest'), 'https://www.pinterest.com/ideas/')).toBeNull()
    expect(handleOf(preset('telegram'), 'https://web.telegram.org/k/')).toBeNull()
    expect(handleOf(preset('threads'), 'https://www.threads.net/@search')).toBeNull()
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/@explore')).toBeNull() // written the way a handle is, still a page
    // …and a real handle that merely begins with such a word is still a handle.
    expect(handleOf(preset('instagram'), 'https://www.instagram.com/explorer_of_charts/')).toBe('@explorer_of_charts')
    expect(handleOf(preset('x'), 'https://x.com/homebrew')).toBe('@homebrew')
  })

  it('is nothing for an address that is not on the platform, however much it looks like a handle page', () => {
    expect(handleOf(preset('instagram'), 'https://evil.example/brand')).toBeNull()
    expect(handleOf(preset('instagram'), 'https://www.instagram.com.evil.example/brand')).toBeNull()
    expect(handleOf(preset('instagram'), 'http://www.instagram.com/brand')).toBeNull()
  })

  it('is nothing when the platform\'s address of a handle has more after the handle', () => {
    // "brand.html" would otherwise pass for the handle "@brand.html".
    const odd = { ...preset('instagram'), handleUrl: 'https://www.instagram.com/{handle}.html' }
    expect(handleOf(odd, 'https://www.instagram.com/brand.html')).toBeNull()
  })

  it('is defined only for presets whose address ends with the handle', () => {
    for (const p of PLATFORM_PRESETS) {
      const sample = p.handleUrl.replace('{handle}', 'brand')
      const handle = handleOf(p, sample)
      expect(handle === null || handle === '@brand', `${p.platform}: ${sample} → ${handle}`).toBe(true)
    }
  })
})
