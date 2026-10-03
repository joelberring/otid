import { defineConfig } from "@playwright/test";

// Real Next UI; browser intercepts finalization/recalculation/DNS HTTP contracts. No database is involved.
const origin = "http://127.0.0.1:3127";
export default defineConfig({
  tsconfig: "tsconfig.result-finalization-public-link.json",
  testDir: ".",
  testMatch: ["task-128-result-finalization-public-link.spec.ts", "task-254-recalculation-visual.spec.ts",
    "task-255-did-not-start-visual.spec.ts", "task-256-did-not-start-withdrawal-visual.spec.ts",
    "task-257-disqualification-visual.spec.ts", "task-258-disqualification-withdrawal-visual.spec.ts",
    "task-259-result-approval-visual.spec.ts", "task-260-approval-withdrawal-visual.spec.ts",
    "task-261-did-not-finish-visual.spec.ts", "task-262-dnf-withdrawal-visual.spec.ts",
    "task-263-out-of-competition-visual.spec.ts", "task-264-out-of-competition-withdrawal-visual.spec.ts",
    "task-265-without-timing-visual.spec.ts", "task-266-without-timing-withdrawal-visual.spec.ts",
    "task-267-class-start-draw-visual.spec.ts", "task-268-start-list-publication-visual.spec.ts",
    "task-269-readout-history-visual.spec.ts", "task-270-event-creation-visual.spec.ts"],
  timeout: 45_000,
  workers: 1,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web exec next dev --hostname 127.0.0.1 --port 3127",
    cwd: "../..",
    url: `${origin}/admin/10000000-0000-4000-8000-000000000001/finalization`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      O_TID_DEMO_E2E: "1",
      O_TID_LOCAL_DEMO: "0",
      O_TID_PUBLIC_ORIGIN: origin,
      DATABASE_URL: "",
      TEST_DATABASE_URL: ""
    }
  }
});
