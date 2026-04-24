import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const isCI = (process.env.CI ?? "").length > 0;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(__dirname, "specs"),
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : 4,
  timeout: 90000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.resolve(__dirname, "../../playwright-report/ui-harness") }]
  ],
  use: {
    baseURL: "http://127.0.0.1:5184",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["clipboard-read", "clipboard-write"]
      }
    }
  ],
  webServer: {
    command: "npm run dev:ui-harness",
    url: "http://127.0.0.1:5184",
    reuseExistingServer: !isCI,
    timeout: isCI ? 180000 : 120000,
    cwd: path.resolve(__dirname, "../..")
  }
});
