/**
 * Playwright set-up for the PaySettle journeys (P12: requirement ids live in the test titles).
 * The server runs separately (production build on :3100 by default); this config never starts one.
 *   E2E_BASE_URL  base address of the running app   (default http://localhost:3100)
 *   CHROME_PATH   Chrome/Chromium binary to drive    (default /usr/bin/google-chrome if present, else Playwright's own)
 *   E2E_WORKERS   parallel workers                   (default 1 — the journeys share one seeded database)
 */
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

process.env.E2E_RUN_ID ??= new Date().toISOString(); // one id per run, inherited by the workers (a11y report merge)
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const chrome = process.env.CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: Number(process.env.E2E_WORKERS ?? 1),
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1360, height: 900 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 }, launchOptions: chrome ? { executablePath: chrome } : {} } },
  ],
});
