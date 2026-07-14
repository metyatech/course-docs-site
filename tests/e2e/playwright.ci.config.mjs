import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { createPlaywrightWebServerEnv } from "../test-harness-env.mjs";

const host = process.env.E2E_HOST ?? "localhost";
const portFromEnv = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3101;
const port = Number.isFinite(portFromEnv) ? portFromEnv : 3101;

const baseURL = process.env.E2E_BASE_URL ?? `http://${host}:${port}`;
const maxFailuresEnv = process.env.PLAYWRIGHT_MAX_FAILURES;
const maxFailures =
  maxFailuresEnv && Number.isFinite(Number(maxFailuresEnv)) ? Number(maxFailuresEnv) : 1;

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  timeout: 120_000,
  // Course CI runs a complete matrix under the ten-minute workflow cap. The
  // specs are isolated by browser context and can safely run in parallel,
  // preserving the full suite without extending the job timeout.
  workers: 4,
  fullyParallel: true,
  maxFailures,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -- --port ${port}`,
    cwd: process.cwd(),
    env: createPlaywrightWebServerEnv({ label: "playwright-webserver-ci", env: process.env }),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
