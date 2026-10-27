import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3210",
    url: "http://127.0.0.1:3210/signin",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      AUTH_REQUIRED: "1",
      SPARRING_STORE: "memory",
      E2E_TEST_AUTH: "1",
      AUTH_SECRET: "e2e-only-secret",
      ADMIN_EMAILS: "admin@10kicks.test",
      COACH_EMAILS: "coach@10kicks.test",
      VIEWER_EMAILS: "viewer@10kicks.test",
      APP_TIMEZONE: "America/New_York",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
