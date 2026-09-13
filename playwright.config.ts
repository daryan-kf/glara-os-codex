import { defineConfig, devices } from "@playwright/test";
const live = process.env.E2E_LIVE === "1";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: "http://localhost:3000",
    trace: live ? "off" : "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    ...(!live
      ? [
          {
            command: "npx tsx tests/support/auth-server.ts",
            url: "http://127.0.0.1:54329/health",
            reuseExistingServer: false,
          },
        ]
      : []),
    {
      command: "npm run start -- --hostname 127.0.0.1",
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 120000,
      env: live
        ? {}
        : {
            NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
              "fictional-publishable-test-key",
          },
    },
  ],
});
