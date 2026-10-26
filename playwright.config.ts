import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "npx vite build && npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: true, timeout: 120_000 },
});
