import type { PmScanEvidence } from "../../src/pm-scan-evidence";

/** Synthetic observations only; never evidence from a real scanner. */
export function pmScanEvidenceFixture(): PmScanEvidence {
  const run = { exitCode: 0, signal: null, timedOut: false, outputTruncated: false, hasErrors: false, hasWarnings: false };
  const database = { version: 1, sha256: "a".repeat(64), builtAt: "2026-09-07T23:00:00.000Z" };
  return {
    formatVersion: 1, executionProfile: "native-probe-v1", scanPolicy: "pm-pdf-v1",
    manifest: { formatVersion: 1, storeId: "11111111-1111-4111-8111-111111111111",
      key: "pm/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222", versionId: "v1", sha256: "a".repeat(64), byteLength: 346 },
    startedAt: "2026-09-08T00:00:00.000Z", finishedAt: "2026-09-08T00:00:01.000Z",
    contentVerified: true, cleanupSucceeded: true,
    qpdf: { engine: { version: "12.4.1", sha256: "0326859206213694229c4b0917cc0eedf11d023dc5b1aa517eeab7ba3e94aec4" },
      check: { ...run }, encryption: { ...run, exitCode: 2 } },
    clamav: { engine: { version: "1.5.4", sha256: "56d3158a49bc23a4fe6dea301705bb57f08d69c98cf0bdfd02dfcf9907071bd2" },
      run: { ...run }, summary: { scannedFiles: 1, infectedFiles: 0 },
      databases: { signaturesVerified: true, daily: { ...database }, main: { ...database }, bytecode: { ...database } } }
  };
}
