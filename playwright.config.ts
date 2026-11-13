import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3018",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "artifacts/test-results",
});
