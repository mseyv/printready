import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the locally installed Chrome; set PW_CHANNEL="" to use Playwright's bundled Chromium.
    channel: process.env.PW_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: process.env.PW_CHANNEL ?? "chrome" } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
