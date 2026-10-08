import { expect, it } from 'vitest'
import { bannerHref } from './banners'

it('opens configured banner links, including legacy bare domains, without accepting script URLs', () => {
  expect(bannerHref('example.org/story')).toBe('https://example.org/story')
  expect(bannerHref('https://example.org/story')).toBe('https://example.org/story')
  expect(bannerHref('/alliance')).toBe('/alliance')
  expect(bannerHref('javascript:alert(1)')).toBe('')
  expect(bannerHref('')).toBe('')
})
