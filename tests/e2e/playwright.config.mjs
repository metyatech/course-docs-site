import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const host = process.env.E2E_HOST ?? 'localhost';
const portFromEnv = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3101;
const port = Number.isFinite(portFromEnv) ? portFromEnv : 3101;

const baseURL = process.env.E2E_BASE_URL ?? `http://${host}:${port}`;
const maxFailuresEnv = process.env.PLAYWRIGHT_MAX_FAILURES;
const maxFailures =
  maxFailuresEnv && Number.isFinite(Number(maxFailuresEnv)) ? Number(maxFailuresEnv) : 1;

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  timeout: 60_000,
  maxFailures,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    cwd: process.cwd(),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

