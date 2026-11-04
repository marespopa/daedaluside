import type { createStore } from 'jotai'
import { registerSW } from 'virtual:pwa-register'
import { pendingUpdateAtom } from './updateAtom'

type Store = ReturnType<typeof createStore>

/**
 * Registers the service worker (production only: vite-plugin-pwa emits nothing in dev
 * and `registerSW` is then a no-op). A waiting worker surfaces as a prompt; it is only
 * activated, and the page reloaded, when the user accepts.
 */
export function registerServiceWorker(store: Store) {
  const updateSW = registerSW({
    onNeedRefresh() {
      store.set(pendingUpdateAtom, {
        message: 'A new version is available.',
        apply: () => void updateSW(true),
      })
    },
  })
  return updateSW
}

/**
 * A stale tab can ask for a hashed chunk that a newer deploy removed. Offer a reload
 * instead of failing silently; never reload on its own, as that would drop unsaved text.
 */
export function handlePreloadError(store: Store, target: Window = window) {
  const onError = (event: Event) => {
    event.preventDefault()
    store.set(pendingUpdateAtom, {
      message: 'Part of the app failed to load. Reload to get the latest version.',
      apply: () => target.location.reload(),
    })
  }
  target.addEventListener('vite:preloadError', onError)
  return () => target.removeEventListener('vite:preloadError', onError)
}
