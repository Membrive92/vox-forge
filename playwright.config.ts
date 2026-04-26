/**
 * Playwright config for VoxForge end-to-end tests.
 *
 * Boots the Vite dev server only; backend calls are mocked per-test via
 * `page.route('**\/api/**', ...)`. This keeps the suite fast and avoids
 * needing GPU/torch/whisper to run on CI. Tests that need the real
 * backend should live elsewhere (manual QA or a separate suite).
 *
 * Run with: `npm run e2e` (headless) or `npm run e2e:headed`.
 */
import { defineConfig, devices } from "@playwright/test";

const FRONTEND_PORT = 5180;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 60_000,

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
    url: `http://localhost:${FRONTEND_PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
