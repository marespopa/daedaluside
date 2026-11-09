import { idbGet, idbPut, openDB } from '../workspace/db'

/** PBKDF2-SHA-256 work factor, per ARCHITECTURE.md (>= 600,000). */
export const PBKDF2_ITERATIONS = 600_000

const RECORD_KEY = 'keys'

/** What is stored in the IDB `vault` store. Only ciphertext; never the passphrase or plain keys. */
interface VaultRecord {
  v: 1
  iterations: number
  salt: Uint8Array
  iv: Uint8Array
  data: ArrayBuffer
}

export type KeyMap = Record<string, string>

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase')
    this.name = 'WrongPassphraseError'
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked')
    this.name = 'VaultLockedError'
  }
}

// Decrypted state lives only in this module, never in React state or storage.
let cryptoKey: CryptoKey | null = null
let salt: Uint8Array | null = null
let iterations = PBKDF2_ITERATIONS
let keys: KeyMap | null = null
let dbPromise: Promise<IDBDatabase> | null = null

function db() {
  return (dbPromise ??= openDB())
}

/** Drops the cached connection; used by tests that swap in a fresh IndexedDB. */
export function resetVaultForTests() {
  lock()
  dbPromise = null
}

async function derive(passphrase: string, s: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: s as BufferSource, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function persist() {
  if (!cryptoKey || !salt || !keys) throw new VaultLockedError()
  // A fresh IV for every write: AES-GCM must never reuse one under the same key.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(keys)),
  )
  const record: VaultRecord = { v: 1, iterations, salt, iv, data }
  await idbPut(await db(), 'vault', RECORD_KEY, record)
}

export async function vaultExists(): Promise<boolean> {
  return (await idbGet<VaultRecord>(await db(), 'vault', RECORD_KEY)) !== undefined
}

export type VaultStatus = 'none' | 'locked' | 'unlocked'

export async function vaultStatus(): Promise<VaultStatus> {
  if (keys) return 'unlocked'
  return (await vaultExists()) ? 'locked' : 'none'
}

export function isUnlocked(): boolean {
  return keys !== null
}

/** Creates an empty vault protected by `passphrase` and leaves it unlocked. Replaces any existing one. */
export async function createVault(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('Passphrase is required')
  salt = crypto.getRandomValues(new Uint8Array(16))
  iterations = PBKDF2_ITERATIONS
  cryptoKey = await derive(passphrase, salt, iterations)
  keys = {}
  await persist()
}

/** Decrypts the stored vault. Throws WrongPassphraseError when the passphrase does not match. */
export async function unlock(passphrase: string): Promise<void> {
  const record = await idbGet<VaultRecord>(await db(), 'vault', RECORD_KEY)
  if (!record) throw new Error('No vault exists')
  const key = await derive(passphrase, record.salt, record.iterations)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as BufferSource },
      key,
      record.data,
    )
  } catch {
    throw new WrongPassphraseError()
  }
  cryptoKey = key
  salt = record.salt
  iterations = record.iterations
  keys = JSON.parse(new TextDecoder().decode(plain)) as KeyMap
}

/** Forgets the derived key and every decrypted secret. */
export function lock(): void {
  cryptoKey = null
  salt = null
  keys = null
}

export async function setKey(provider: string, secret: string): Promise<void> {
  if (!keys) throw new VaultLockedError()
  keys = { ...keys, [provider]: secret }
  await persist()
}

export async function removeKey(provider: string): Promise<void> {
  if (!keys) throw new VaultLockedError()
  const next = { ...keys }
  delete next[provider]
  keys = next
  await persist()
}

export function getKey(provider: string): string | undefined {
  if (!keys) throw new VaultLockedError()
  return keys[provider]
}

/** Provider names that have a stored key. Names only; secrets never leave this module in bulk. */
export function listProviders(): string[] {
  if (!keys) throw new VaultLockedError()
  return Object.keys(keys)
}
