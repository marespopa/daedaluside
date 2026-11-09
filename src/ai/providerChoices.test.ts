import { describe, expect, it } from 'vitest'
import { configuredProviders, fallbackRoute } from './providerChoices'

describe('configuredProviders', () => {
  it('lists keyed providers only once their key is saved', () => {
    expect(configuredProviders([], false)).toEqual([])
    expect(configuredProviders(['anthropic'], false)).toEqual(['anthropic'])
  })

  it('lists Ollama only while its server is reachable', () => {
    expect(configuredProviders([], true)).toEqual(['ollama'])
    expect(configuredProviders(['gemini'], true)).toEqual(['gemini', 'ollama'])
  })
})

describe('fallbackRoute', () => {
  it('returns null when nothing is configured', () => {
    expect(fallbackRoute([])).toBeNull()
  })

  it('picks the first configured provider with its default model', () => {
    expect(fallbackRoute(['gemini', 'ollama'])).toEqual({
      provider: 'gemini',
      model: 'gemini-flash-latest',
    })
  })

  it('prefers the given provider when it is configured', () => {
    expect(fallbackRoute(['gemini', 'ollama'], 'ollama')?.provider).toBe('ollama')
    expect(fallbackRoute(['gemini'], 'ollama')?.provider).toBe('gemini')
  })
})
