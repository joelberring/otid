import { describe, expect, it } from "vitest";
import { classifyPmScanEvidence } from "../src/pm-scan-policy";
import { pmScanEvidenceFixture } from "../../contracts/test/fixtures/pm-scan";

describe("PM observation classification; PASSED is not native publication permission", () => {
  it("passes the complete pinned synthetic observations", () => {
    expect(classifyPmScanEvidence(pmScanEvidenceFixture())).toBe("PASSED");
  });
  it("rejects encrypted, malformed and detected content", () => {
    const encrypted = pmScanEvidenceFixture(); encrypted.qpdf!.encryption!.exitCode = 0; encrypted.qpdf!.check = null; encrypted.clamav = null;
    expect(classifyPmScanEvidence(encrypted)).toBe("REJECTED");
    for (const exitCode of [2, 3]) {
      const broken = pmScanEvidenceFixture(); broken.qpdf!.check!.exitCode = exitCode;
      expect(classifyPmScanEvidence(broken)).toBe("REJECTED");
    }
    const detected = pmScanEvidenceFixture(); detected.clamav!.run.exitCode = 1; detected.clamav!.summary!.infectedFiles = 1;
    expect(classifyPmScanEvidence(detected)).toBe("REJECTED");
  });
  it.each(["contentVerified", "cleanupSucceeded"] as const)("fails when %s is false", field => {
    expect(classifyPmScanEvidence({ ...pmScanEvidenceFixture(), [field]: false })).toBe("FAILED");
  });
  it("fails missing engines, summaries, signatures and unpinned tools", () => {
    const cases = [pmScanEvidenceFixture(), pmScanEvidenceFixture(), pmScanEvidenceFixture(), pmScanEvidenceFixture(), pmScanEvidenceFixture(), pmScanEvidenceFixture()];
    cases[0]!.qpdf = null; cases[1]!.clamav = null;
    cases[2]!.clamav!.summary = null; cases[3]!.clamav!.databases = null;
    cases[4]!.qpdf!.engine.sha256 = "b".repeat(64); cases[5]!.clamav!.engine.version = "1.5.3";
    for (const evidence of cases) expect(classifyPmScanEvidence(evidence)).toBe("FAILED");
  });
  it.each(["timedOut", "outputTruncated", "hasErrors", "hasWarnings"] as const)("fails a clean exit with %s", field => {
    const evidence = pmScanEvidenceFixture(); evidence.clamav!.run[field] = true;
    expect(classifyPmScanEvidence(evidence)).toBe("FAILED");
  });
  it("fails unknown exits, signals, incomplete coverage and contradictory infection counts", () => {
    const cases = [pmScanEvidenceFixture(), pmScanEvidenceFixture(), pmScanEvidenceFixture(), pmScanEvidenceFixture()];
    cases[0]!.qpdf!.encryption!.exitCode = 17; cases[1]!.clamav!.run.signal = "SIGKILL";
    cases[2]!.clamav!.summary!.scannedFiles = 0; cases[3]!.clamav!.summary!.infectedFiles = 1;
    for (const evidence of cases) expect(classifyPmScanEvidence(evidence)).toBe("FAILED");
  });
  it("checks daily freshness at scan end while allowing older verified main/bytecode", () => {
    const evidence = pmScanEvidenceFixture();
    evidence.clamav!.databases!.main.builtAt = "2021-01-01T00:00:00.000Z";
    evidence.clamav!.databases!.daily.builtAt = "2026-09-05T00:00:01.000Z";
    expect(classifyPmScanEvidence(evidence)).toBe("PASSED");
    evidence.clamav!.databases!.daily.builtAt = "2026-09-05T00:00:00.999Z";
    expect(classifyPmScanEvidence(evidence)).toBe("FAILED");
    evidence.clamav!.databases!.daily.builtAt = "2026-09-08T00:00:00.001Z";
    expect(classifyPmScanEvidence(evidence)).toBe("FAILED");
  });
});
