import { defineConfig } from "@playwright/test";

// Synthetic public-result markup plus mounted route, comparison and map components with synthetic HTTP data.
// Visual and focused interaction proof only; no server, database or physical device.
export default defineConfig({
  testDir: ".", testMatch: ["task-236-public-results-visual.spec.ts", "task-237-public-detail-visual.spec.ts", "task-238-public-route-visual.spec.ts", "task-239-public-route-zoom.spec.ts", "task-240-public-route-comparison-view.spec.ts", "task-241-public-map-view.spec.ts"], workers: 1, timeout: 30_000,
  use: { browserName: "chromium", trace: "off", video: "off" },
});
