// The picture viewer rendered to markup (the renderer has no test runner of its own): a picture that opens large, and the viewer over a single picture and over a group.
// Keys and focus are the pure helpers of picture-viewer.test.ts, and were looked at in the real window. Listed in tsconfig.web.json beside the other render tests.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ViewableImage } from '../renderer/src/pictures/ViewableImage'
import { ViewerSheet } from '../renderer/src/pictures/PictureViewer'
import { drawnPicture, mediaPicture, postPicture } from '../renderer/src/pictures/picture-viewer'

// The viewer asks the core for its large copy, so it imports the application's transport, which wants the window of the preload script: stubbed before the imports run.
vi.hoisted(() => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
})

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
const none = (): void => undefined

const chart = drawnPicture('data:image/png;base64,AAAA', 'Screenshot of reddit.com', 'A screenshot')
const post = (place: number) => postPicture({ id: `i${place}`, alt: `Picture ${place}`, width: 1080, height: 1350 }, place)

describe('a picture that opens large', () => {
  it('is the same picture as before, reachable from the keyboard as a button, with the cursor of a picture that can be enlarged', () => {
    const markup = html(createElement(ViewableImage, { src: 'data:image/png;base64,AAAA', alt: 'A chart', className: 'stream-img', picture: chart }))
    expect(markup).toMatch(/^<img /)
    expect(markup).toContain('class="stream-img viewable"')
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('aria-label="View larger: A screenshot"')
    expect(markup).not.toContain('picture-viewer')
  })

  it('is a plain press of the mouse, and no second button, where it sits inside a button', () => {
    const markup = html(createElement(ViewableImage, { src: 'data:image/png;base64,AAAA', alt: '', className: 'posts-thumb', keyboard: false, picture: chart }))
    expect(markup).toContain('class="posts-thumb viewable"')
    expect(markup).not.toContain('role=')
    expect(markup).not.toContain('tabindex')
  })
})

describe('the viewer over a picture that stands alone', () => {
  const sheet = html(createElement(ViewerSheet, { pictures: [chart], onClose: none }))

  it('says what it is, names the picture, and has Download and Close', () => {
    expect(sheet).toContain('role="dialog"')
    expect(sheet).toContain('aria-modal="true"')
    expect(sheet).toContain('aria-label="Picture viewer"')
    expect(sheet).toContain('Screenshot of reddit.com')
    expect(sheet).toMatch(/data-testid="picture-download"[^>]*>Download</)
    expect(sheet).toMatch(/data-testid="picture-close"[^>]*>Close</)
  })

  it('shows the picture itself and no walk through a group, no "saved" line', () => {
    expect(sheet).toContain('data-testid="picture-viewer-image"')
    expect(sheet).toContain('src="data:image/png;base64,AAAA"')
    expect(sheet).not.toContain('picture-viewer-walk')
    expect(sheet).not.toContain('picture-viewer-saved')
  })
})

describe('the viewer over the pictures of one post', () => {
  it('counts the picture, names it with its size, and stops the walk at the first picture', () => {
    const sheet = html(createElement(ViewerSheet, { pictures: [post(1), post(2), post(3)], start: 0, onClose: none }))
    expect(sheet).toContain('post-picture-1 · 1080 × 1350')
    expect(sheet).toMatch(/data-testid="picture-viewer-count"[^>]*>1 of 3</)
    expect(sheet).toMatch(/<button[^>]*disabled=""[^>]*data-testid="picture-previous"/)
    expect(sheet).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="picture-next"/)
  })

  it('opens at the picture that was pressed, and stops the walk at the last one', () => {
    const sheet = html(createElement(ViewerSheet, { pictures: [post(1), post(2), post(3)], start: 2, onClose: none }))
    expect(sheet).toContain('post-picture-3 · 1080 × 1350')
    expect(sheet).toMatch(/data-testid="picture-viewer-count"[^>]*>3 of 3</)
    expect(sheet).toMatch(/<button[^>]*disabled=""[^>]*data-testid="picture-next"/)
  })

  it('says it is opening the picture while the large copy is made, and shows no picture yet', () => {
    const sheet = html(createElement(ViewerSheet, { pictures: [mediaPicture({ id: 'm1', name: 'shot.png' })], onClose: none }))
    expect(sheet).toContain('Opening the picture…')
    expect(sheet).not.toContain('data-testid="picture-viewer-image"')
  })
})
