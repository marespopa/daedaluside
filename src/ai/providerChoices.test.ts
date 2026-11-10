import { describe, expect, it } from 'vitest'
import { configuredProviders, fallbackRoute } from './providerChoices'

describe('configuredProviders', () => {
  it('lists keyed providers only once their key is saved', () => {
    expect(configuredProviders([])).toEqual([])
    expect(configuredProviders(['anthropic'])).toEqual(['anthropic'])
  })

  it('never lists Ollama, which is not offered for now', () => {
    expect(configuredProviders(['gemini', 'ollama'])).toEqual(['gemini'])
  })
})

describe('fallbackRoute', () => {
  it('returns null when nothing is configured', () => {
    expect(fallbackRoute([])).toBeNull()
  })

  it('picks the first configured provider with its default model', () => {
    expect(fallbackRoute(['gemini', 'anthropic'])).toEqual({
      provider: 'gemini',
      model: 'gemini-flash-latest',
    })
  })

  it('prefers the given provider when it is configured', () => {
    expect(fallbackRoute(['gemini', 'anthropic'], 'anthropic')?.provider).toBe(
      'anthropic',
    )
    expect(fallbackRoute(['gemini'], 'anthropic')?.provider).toBe('gemini')
  })
})
