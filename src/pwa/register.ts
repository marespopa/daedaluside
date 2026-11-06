import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the service worker (production only: vite-plugin-pwa emits nothing in dev
 * and `registerSW` is then a no-op). There is no update prompt: a new version waits and
 * takes over on the next launch, so the editor's unsaved buffers are never reloaded away.
 */
export function registerServiceWorker() {
  return registerSW({})
}
