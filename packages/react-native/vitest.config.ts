import { defineConfig } from 'vitest/config'

// Node only: the timeline model is platform-free by design (see
// src/dependencyRules.test.ts), and the engine it drives runs in plain Node.
// Component tests, when they arrive, mock react-native rather than pulling a
// renderer into this suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
