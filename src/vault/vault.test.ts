import { beforeEach, describe, expect, it } from 'vitest'
import {
  VaultLockedError,
  WrongPassphraseError,
  createVault,
  getKey,
  isUnlocked,
  listProviders,
  lock,
  removeKey,
  resetVaultForTests,
  setKey,
  unlock,
  vaultExists,
  vaultStatus,
} from './vault'

beforeEach(() => resetVaultForTests())

describe('vault', () => {
  it('starts without a vault', async () => {
    expect(await vaultExists()).toBe(false)
    expect(isUnlocked()).toBe(false)
  })

  it('reports none, unlocked and locked', async () => {
    expect(await vaultStatus()).toBe('none')
    await createVault('p')
    expect(await vaultStatus()).toBe('unlocked')
    lock()
    expect(await vaultStatus()).toBe('locked')
  })

  it('round-trips a key through lock and unlock', async () => {
    await createVault('correct horse')
    await setKey('gemini', 'sk-secret')
    expect(getKey('gemini')).toBe('sk-secret')
    lock()
    expect(isUnlocked()).toBe(false)
    await unlock('correct horse')
    expect(getKey('gemini')).toBe('sk-secret')
    expect(listProviders()).toEqual(['gemini'])
  })

  it('rejects a wrong passphrase and stays locked', async () => {
    await createVault('right')
    await setKey('anthropic', 'k')
    lock()
    await expect(unlock('wrong')).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(isUnlocked()).toBe(false)
  })

  it('clears secrets on lock', async () => {
    await createVault('p')
    await setKey('gemini', 'k')
    lock()
    expect(() => getKey('gemini')).toThrow(VaultLockedError)
    await expect(setKey('gemini', 'x')).rejects.toBeInstanceOf(VaultLockedError)
  })

  it('removes a key', async () => {
    await createVault('p')
    await setKey('a', '1')
    await setKey('b', '2')
    await removeKey('a')
    lock()
    await unlock('p')
    expect(listProviders()).toEqual(['b'])
  })

  it('never stores the secret in plain text', async () => {
    await createVault('p')
    await setKey('gemini', 'PLAINTEXT-MARKER')
    const raw = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('daedalus')
      open.onsuccess = () => {
        const get = open.result.transaction('vault').objectStore('vault').get('keys')
        get.onsuccess = () => resolve(get.result)
        get.onerror = () => reject(get.error)
      }
      open.onerror = () => reject(open.error)
    })
    const bytes = new Uint8Array((raw as { data: ArrayBuffer }).data)
    expect(new TextDecoder().decode(bytes)).not.toContain('PLAINTEXT-MARKER')
  })
})
