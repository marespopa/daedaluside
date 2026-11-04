import { describe, expect, it } from 'vitest'
import { imageKind, imageMime, sniffImage } from './image'

const bytes = (...n: number[]) => new Uint8Array(n)
const text = (s: string) => new TextEncoder().encode(s)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0)

describe('imageKind', () => {
  it('maps allowlisted extensions case-insensitively', () => {
    expect(imageKind('a.PNG')).toBe('png')
    expect(imageKind('d/a.jpg')).toBe('jpeg')
    expect(imageKind('a.jpeg')).toBe('jpeg')
    expect(imageKind('a.svg')).toBe('svg')
  })
  it('rejects everything else', () => {
    for (const p of ['a.gif', 'a.html', 'png', 'a.png.txt', '.png.bak'])
      expect(imageKind(p)).toBeNull()
  })
  it('fixes the MIME type', () => {
    expect(imageMime('svg')).toBe('image/svg+xml')
  })
})

describe('sniffImage', () => {
  it('accepts real signatures', () => {
    expect(sniffImage('png', PNG)).toBe(true)
    expect(sniffImage('jpeg', JPG)).toBe(true)
    expect(sniffImage('svg', text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true)
    expect(sniffImage('svg', text('<?xml version="1.0"?>\n<!-- c -->\n<svg>'))).toBe(true)
  })
  it('rejects spoofed content', () => {
    expect(sniffImage('png', JPG)).toBe(false)
    expect(sniffImage('jpeg', PNG)).toBe(false)
    expect(sniffImage('png', text('<svg/>'))).toBe(false)
    expect(sniffImage('svg', PNG)).toBe(false)
    expect(sniffImage('svg', text('<html><svg></svg></html>'))).toBe(false)
    expect(sniffImage('svg', text('<script>alert(1)</script>'))).toBe(false)
    expect(sniffImage('svg', bytes(0xff, 0xfe, 0x3c))).toBe(false)
    expect(sniffImage('png', bytes())).toBe(false)
  })
})
