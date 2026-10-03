import { describe, expect, it } from "vitest";
import { createDemoSummary, DemoInstallationSchema, DemoSummarySchema } from "../src/demo-installation";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const base = { formatVersion: 1, eventId: id(1), raceId: id(2), expiresAt: "2026-09-06T11:00:00.000Z" };
const installation = { ...base, credentials: [
  ["VIEW_RACE_OVERVIEW", "otid_org_race_overview_v1"], ["START_CHECKIN", "otid_org_start_checkin_v1"], ["FINISH_FOREST_WATCH", "otid_org_finish_forest_watch_v1"], ["MANAGE_RACE", "otid_org_race_admin_v1"]
].map(([capability, prefix], index) => ({ formatVersion: 1, credentialId: id(index + 3), raceId: base.raceId, label: "Synthetic",
  capability, accessCredential: `${prefix}.${id(index + 3)}.${"a".repeat(43)}`, issuedAt: "2026-09-06T10:00:00.000Z", expiresAt: base.expiresAt })) };
describe("private demo installation and public summary", () => {
  it("accepts exact scoped roles and only secret-free scope-bound summary paths", () => {
    expect(DemoInstallationSchema.parse(installation)).toEqual(installation);
    const summary = createDemoSummary(base);
    expect(summary.paths.checkin).toBe(`/checkin/index.html#${base.raceId}`);
    expect(summary.paths.manage).toBe(`/admin/${base.raceId}/manage`);
    expect(DemoSummarySchema.safeParse({ ...summary, paths: { ...summary.paths, results: "https://external.test/" } }).success).toBe(false);
    expect(() => createDemoSummary(installation)).toThrow();
    expect(DemoSummarySchema.safeParse({ ...summary, accessCredential: "secret" }).success).toBe(false);
  });
  it("rejects wrong scope, token identity, lifetime, duplicate or missing roles", () => {
    for (const changed of [{ raceId: id(8) }, { credentialId: id(8) }, { expiresAt: "2026-09-06T12:00:00.000Z" },
      { issuedAt: "2026-09-06T09:00:00.000Z" }, { issuedAt: base.expiresAt }, { capability: "START_CHECKIN" }]) {
      expect(DemoInstallationSchema.safeParse({ ...installation, credentials: [{ ...installation.credentials[0], ...changed }, ...installation.credentials.slice(1)] }).success).toBe(false);
    }
    expect(DemoInstallationSchema.safeParse({ ...installation, credentials: installation.credentials.slice(1) }).success).toBe(false);
  });
});
