import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { browserName: "chromium" },
  projects: [
    {
      name: "production",
      testMatch: [
        "import.spec.ts",
        "training.spec.ts",
        "whole-training.spec.ts",
        "document.spec.ts",
      ],
      use: { baseURL: "http://127.0.0.1:4173" },
    },
    {
      name: "development-fault",
      testMatch: "dev-fault.spec.ts",
      use: { baseURL: "http://127.0.0.1:5174" },
    },
  ],
  webServer: [
    {
      command: "npm run preview -- --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
});
