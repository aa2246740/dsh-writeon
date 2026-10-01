import { defineConfig } from '@playwright/test'

/**
 * E2E runs against a REAL `dsh web` host with dsh-writeon link-installed.
 * DSH_URL carries the one-time token URL minted by the runner script
 * (scripts/run-e2e.mjs restarts the host and exports it).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1, // one IndexedDB-backed doc store per run; serial keeps state predictable
  reporter: [['list'], ['json', { outputFile: process.env.WO_VERIFY_DIR === undefined ? 'verification/latest/results.json' : `${process.env.WO_VERIFY_DIR}/results.json` }]],
  use: {
    baseURL: process.env.DSH_URL ?? 'http://127.0.0.1:3080',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
})
