import { describe, expect, it } from 'vitest'
import { resolveKongApiUrl } from './kong'

describe('resolveKongApiUrl', () => {
  it.each([
    undefined,
    '',
    '  ',
    'https://kong.yearn.fi/api/rest',
    ' https://kong.yearn.fi/api/rest/// ',
    'https://kong.yearn.farm/api/rest/',
  ])('uses the Worker-compatible endpoint for %s', (value) => {
    expect(resolveKongApiUrl(value)).toBe('https://kong.yearn.farm/api/rest')
  })

  it.each([
    'https://example.com/api/rest',
    'http://localhost:3000/api/rest',
    'https://kong.yearn.fi/custom/api',
  ])('preserves custom base %s', (value) => {
    expect(resolveKongApiUrl(value)).toBe(value)
  })
})
