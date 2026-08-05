import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Browser suites.
 *
 * `smoke` is the gate: fast, read-only, and safe against production — it
 * proves a deploy is alive without writing anything. `e2e` exercises the real
 * flows and does write, so it only runs against a local server.
 */
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "smoke",
      testMatch: /smoke\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // A phone viewport, but only against the specs written for one. Running
      // the whole desktop suite at 390px tests the test, not the app.
      name: "mobile",
      testMatch: /e2e\/responsive\.spec\.ts/,
      use: { ...devices["iPhone 14"] },
    },
  ],

  // Only start a server when pointing at localhost; a smoke run against
  // production must not try to boot one.
  webServer: BASE_URL.includes("localhost")
    ? {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
