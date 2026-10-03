import { describe, expect, it } from "vitest";
import { pmScanEvidenceSchema } from "../src/pm-scan-evidence";
import { pmScanEvidenceFixture } from "./fixtures/pm-scan";

describe("PM server-only scan observations", () => {
  it("accepts complete observations and missing engines without fabricating evidence", () => {
    expect(pmScanEvidenceSchema.parse(pmScanEvidenceFixture())).toEqual(pmScanEvidenceFixture());
    expect(pmScanEvidenceSchema.safeParse({ ...pmScanEvidenceFixture(), qpdf: null, clamav: null, contentVerified: false }).success).toBe(true);
  });
  it.each(["outcome", "publishable", "stdout", "filename", "workerId"])("rejects caller field %s", field => {
    expect(pmScanEvidenceSchema.safeParse({ ...pmScanEvidenceFixture(), [field]: "injected" }).success).toBe(false);
  });
  it("rejects unknown profiles, policies, paths, invalid times and unsafe counts", () => {
    const fixture = pmScanEvidenceFixture();
    for (const extra of [
      { executionProfile: "production" }, { scanPolicy: "pm-pdf-v2" },
      { startedAt: "2026-09-08T00:00:00Z" }, { finishedAt: "2026-09-07T00:00:00.000Z" },
      { qpdf: { ...fixture.qpdf, path: "/tmp/private.pdf" } },
      { clamav: { ...fixture.clamav, summary: { scannedFiles: Number.MAX_SAFE_INTEGER + 1, infectedFiles: 0 } } }
    ]) expect(pmScanEvidenceSchema.safeParse({ ...fixture, ...extra }).success).toBe(false);
  });
});
