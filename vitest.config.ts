import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    // Avoid worker threads which can hang under some Bun setups
    pool: 'forks',
    maxThreads: 1,
    minThreads: 1,
    watch: false,
  },
  // Avoid loading project PostCSS/Tailwind config during isolated unit tests
  css: {
    postcss: {
      plugins: [],
    },
  },
})
