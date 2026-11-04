/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
