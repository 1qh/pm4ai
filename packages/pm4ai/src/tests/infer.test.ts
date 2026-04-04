import { describe, expect, test } from 'bun:test'
import { parseFrontmatter } from '../infer.js'
describe('parseFrontmatter', () => {
  test('standard frontmatter', () => {
    expect(parseFrontmatter('---\ntitle: Hello\ninfer: always\n---\ncontent')).toEqual({
      infer: 'always',
      title: 'Hello'
    })
  })
  test('no frontmatter returns empty object', () => {
    expect(parseFrontmatter('just content')).toEqual({})
  })
  test('missing closing --- returns empty object', () => {
    expect(parseFrontmatter('---\ntitle: Hello\n')).toEqual({})
  })
  test('values with colons keeps full value', () => {
    expect(parseFrontmatter('---\nurl: https://example.com\n---\n')).toEqual({
      url: 'https://example.com'
    })
  })
  test('empty file returns empty object', () => {
    expect(parseFrontmatter('')).toEqual({})
  })
})
