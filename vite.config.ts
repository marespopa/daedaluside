/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The CSP forbids inline scripts, so registration is explicit (src/pwa/register.ts).
      injectRegister: false,
      // Prompt only: the editor holds unsaved buffers, so never skipWaiting + auto-reload.
      registerType: 'prompt',
      manifest: false, // public/manifest.webmanifest
      workbox: {
        // Everything a built page needs, including the lazy language chunks, workers,
        // theme-init.js and favicon.svg (copied from public/).
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // ES-module workers: required for code-splitting and dynamic import inside workers.
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // Stable vendor chunks: app changes do not invalidate the cached libraries.
        advancedChunks: {
          groups: [
            { name: 'vim', test: /node_modules[\\/]@replit[\\/]codemirror-vim/ },
            {
              name: 'vendor-git',
              test: /node_modules[\\/](isomorphic-git|buffer|pako|fflate)[\\/]/,
            },
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|scheduler|jotai)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom workers are heavy and this dev box is slow under full parallelism: cap the
    // worker count and allow for slow async storage work (the default 5 s is too tight).
    maxWorkers: 4,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
