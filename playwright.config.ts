import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1, timeout: 60_000,
  use: { baseURL: "http://localhost:3011", trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "node --import tsx scripts/test-seed.ts && npx next dev --hostname 127.0.0.1 --port 3011",
    url: "http://localhost:3011/api/health", reuseExistingServer: false, timeout: 120_000,
    env: { NODE_OPTIONS: `--require=${process.cwd()}/tests/e2e/catalog-network.cjs`, NEXT_DIST_DIR: ".next-e2e", DATA_DIR: "./.local/e2e", BETTER_AUTH_URL: "http://localhost:3011", BETTER_AUTH_SECRET: "test-only-e2e-secret-not-for-production-0123456789", ENABLE_DEMO_LOGIN: "false" },
  },
});
