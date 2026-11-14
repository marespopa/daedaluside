import { describe, expect, it } from 'vitest'
import { configuredProviders } from './providerChoices'

describe('configuredProviders', () => {
  it('lists keyed providers only once their key is saved', () => {
    expect(configuredProviders([])).toEqual([])
    expect(configuredProviders(['anthropic'])).toEqual(['anthropic'])
  })

  it('never lists Ollama, which is not offered for now', () => {
    expect(configuredProviders(['gemini', 'ollama'])).toEqual(['gemini'])
  })
})
