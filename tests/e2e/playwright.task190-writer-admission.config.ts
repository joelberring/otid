import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:3190";
export default defineConfig({
  tsconfig: "tsconfig.task190-writer-admission.json",
  testDir: ".", testMatch: "task-190-writer-admission.spec.ts", workers: 1, timeout: 30_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "node apps/web/node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3190",
    cwd: "../..", port: 3190, reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0", O_TID_PUBLIC_ORIGIN: origin,
      OTID_WRITER_STOP_PROFILE: "systemd-v1", OTID_WRITER_STOP_FILE: "/var/lib/o-tid/controller/closed",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/no-database" }
  }
});
