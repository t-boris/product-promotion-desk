// The pure part of the picture viewer (owner, 2026-11-21: "Add ability to maximize images and download them"): where each kind of picture is saved from, the line that
// names it, the walk through a group, and the focus that stays inside the viewer.

import { describe, expect, it } from 'vitest'
import {
  VIEWER_SIDE,
  canStep,
  MAX_ENLARGE,
  drawnPicture,
  fitSize,
  groupLabel,
  infoLine,
  mediaPicture,
  nextFocus,
  postPicture,
  profilePicture,
  savedLine,
  sizeLabel,
  startIndex,
  stepIndex
} from '../renderer/src/pictures/picture-viewer'

describe('the copy the viewer asks for', () => {
  it('has at most 2048 pixels on its longest side', () => {
    expect(VIEWER_SIDE).toBe(2048)
  })
})

describe('the pictures the viewer is given', () => {
  it('names a post picture by its place in the post, the way the Save dialog does, and keeps the size of the original', () => {
    expect(postPicture({ id: 'i2', alt: '', width: 1080, height: 1350 }, 2, 'data:x')).toEqual({
      key: 'i2',
      source: { kind: 'finding', id: 'i2' },
      name: 'post-picture-2',
      alt: 'A picture of the post',
      width: 1080,
      height: 1350,
      preview: 'data:x'
    })
    expect(postPicture({ id: 'i1', alt: 'A natal chart', width: null, height: null }, 1).alt).toBe('A natal chart')
  })

  it('takes a library picture by its name, and its description as the alternative text when it has one', () => {
    expect(mediaPicture({ id: 'm1', name: 'shot.png', description: '', width: 64, height: 48 })).toMatchObject({ name: 'shot.png', alt: 'shot.png', width: 64, height: 48, source: { kind: 'media', id: 'm1' } })
    expect(mediaPicture({ id: 'm1', name: 'shot.png', description: 'A chart wheel' }).alt).toBe('A chart wheel')
  })

  it('shows a profile picture and a drawn one from what the screen holds', () => {
    expect(profilePicture('p1', 'data:y')).toMatchObject({ source: { kind: 'profile', id: 'p1' }, name: 'Profile picture', preview: 'data:y' })
    expect(drawnPicture('data:z', 'Screenshot of reddit.com', 'Screenshot')).toMatchObject({ source: { kind: 'drawn', dataUrl: 'data:z' }, name: 'Screenshot of reddit.com' })
  })
})

describe('the size a picture is shown at', () => {
  it('makes a picture larger than the room smaller to fit it, keeping its proportions', () => {
    expect(fitSize({ width: 2000, height: 1000 }, { width: 1000, height: 800 })).toEqual({ width: 1000, height: 500 })
    expect(fitSize({ width: 1000, height: 2000 }, { width: 1000, height: 800 })).toEqual({ width: 400, height: 800 })
  })

  it('enlarges a small picture to fill the room, as far as four times its own size and no farther', () => {
    expect(MAX_ENLARGE).toBe(4)
    expect(fitSize({ width: 216, height: 216 }, { width: 1280, height: 760 })).toEqual({ width: 760, height: 760 })
    expect(fitSize({ width: 100, height: 50 }, { width: 1280, height: 760 })).toEqual({ width: 400, height: 200 })
    expect(fitSize({ width: 640, height: 615 }, { width: 1280, height: 760 })).toEqual({ width: 790, height: 760 })
  })

  it('never crops: the result fits inside the room, and has no size when there is no picture or no room', () => {
    const size = fitSize({ width: 333, height: 777 }, { width: 901, height: 413 })
    expect(size && size.width <= 901 && size.height <= 413).toBe(true)
    expect(fitSize({ width: 0, height: 10 }, { width: 100, height: 100 })).toBeNull()
    expect(fitSize({ width: 10, height: 10 }, { width: 0, height: 100 })).toBeNull()
  })
})

describe('the line that names a picture', () => {
  it('says the size of the original, or the size of what the viewer measured, and just the name when neither is known', () => {
    expect(sizeLabel(1080, 1350)).toBe('1080 × 1350')
    expect(sizeLabel(null, 100)).toBe('')
    expect(infoLine({ name: 'post-picture-2', width: 1080, height: 1350 }, null)).toBe('post-picture-2 · 1080 × 1350')
    expect(infoLine({ name: 'a.png', width: null, height: null }, { width: 640, height: 480 })).toBe('a.png · 640 × 480')
    expect(infoLine({ name: 'a.png', width: undefined, height: undefined }, null)).toBe('a.png')
    expect(infoLine({ name: 'a.png', width: 800, height: 600 }, { width: 640, height: 480 })).toBe('a.png · 800 × 600')
  })

  it('counts a picture of a group, and says nothing for one that stands alone', () => {
    expect(groupLabel(1, 5)).toBe('2 of 5')
    expect(groupLabel(0, 2)).toBe('1 of 2')
    expect(groupLabel(0, 1)).toBeNull()
  })

  it('says where a picture was saved', () => {
    expect(savedLine('/Users/anna/Downloads/post-picture-2.webp')).toBe('Saved to /Users/anna/Downloads/post-picture-2.webp')
  })
})

describe('walking through a group', () => {
  it('stops at the first and the last picture instead of going round', () => {
    expect(canStep(0, -1, 3)).toBe(false)
    expect(canStep(2, 1, 3)).toBe(false)
    expect(canStep(1, 1, 3)).toBe(true)
    expect(canStep(1, -1, 3)).toBe(true)
    expect(stepIndex(0, -1, 3)).toBe(0)
    expect(stepIndex(2, 1, 3)).toBe(2)
    expect(stepIndex(1, 1, 3)).toBe(2)
    expect(stepIndex(0, 1, 1)).toBe(0)
  })

  it('opens at the picture that was pressed, the first when it is not in the group', () => {
    const group = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
    expect(startIndex(group, 'c')).toBe(2)
    expect(startIndex(group, 'zzz')).toBe(0)
    expect(startIndex([], 'a')).toBe(0)
  })
})

describe('the focus inside the viewer', () => {
  it('goes round the places of the viewer and never leaves it', () => {
    expect(nextFocus(4, 0, false)).toBe(1)
    expect(nextFocus(4, 3, false)).toBe(0)
    expect(nextFocus(4, 0, true)).toBe(3)
    expect(nextFocus(4, 2, true)).toBe(1)
  })

  it('enters at the first place from the front and at the last from the back when the focus was outside, and has nothing to do with no places', () => {
    expect(nextFocus(4, -1, false)).toBe(0)
    expect(nextFocus(4, -1, true)).toBe(3)
    expect(nextFocus(0, -1, false)).toBe(-1)
  })
})
