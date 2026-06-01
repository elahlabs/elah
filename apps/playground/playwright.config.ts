/**
 * Playwright configuration for the playground E2E suite.
 *
 * - Chromium-only (WebGL2 + WebCodecs are well-supported and deterministic on Chromium).
 * - Headless by default; set PW_HEADED=1 to watch the test run.
 * - Spins up `vite dev` automatically; tests wait for the server before executing.
 * - All tests in the `e2e/` directory.
 *
 * Commands:
 *   npx playwright test                   Run E2E suite (headless)
 *   PW_HEADED=1 npx playwright test       Headed run
 *   npx playwright test --debug           Debug mode with inspector
 *
 * To update golden hashes after intentional rendering changes:
 *   Run the test once with --update-snapshots or update GOLDEN_HEX in realPlayback.spec.ts.
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    headless: !process.env.PW_HEADED,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
