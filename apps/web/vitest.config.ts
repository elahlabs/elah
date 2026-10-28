import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Only covers the pure logic under `lib/`: nothing here needs a DOM, and `@/`
 * is resolved by hand because Next owns the tsconfig path mapping.
 *
 * vitest is resolved from the hoisted root install, so no dependency is
 * declared in this package's package.json.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    // Same source aliases as next.config.mjs, so tests see the 1.0 code.
    alias: [
      { find: /^@elah\/core\/engine$/, replacement: fileURLToPath(new URL('../../packages/core/src/engine.ts', import.meta.url)) },
      { find: /^@elah\/core\/spec$/, replacement: fileURLToPath(new URL('../../packages/core/src/spec/index.ts', import.meta.url)) },
      { find: /^@elah\/core\/html$/, replacement: fileURLToPath(new URL('../../packages/core/src/vector/html/index.ts', import.meta.url)) },
      { find: /^@elah\/core\/ops$/, replacement: fileURLToPath(new URL('../../packages/core/src/ops/index.ts', import.meta.url)) },
      { find: /^@elah\/core\/icons$/, replacement: fileURLToPath(new URL('../../packages/core/src/icons/index.ts', import.meta.url)) },
      { find: /^@elah\/core$/, replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('.', import.meta.url)) },
    ],
  },
})
