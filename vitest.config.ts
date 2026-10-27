import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      AUTH_REQUIRED: "1",
      SPARRING_STORE: "memory",
      E2E_TEST_AUTH: "1",
      AUTH_SECRET: "unit-test-secret",
      ADMIN_EMAILS: "admin@10kicks.test",
      COACH_EMAILS: "coach@10kicks.test",
      VIEWER_EMAILS: "viewer@10kicks.test",
      APP_TIMEZONE: "America/New_York",
    },
  },
});
