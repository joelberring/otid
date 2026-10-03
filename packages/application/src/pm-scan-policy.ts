import type { PmScanEvidence } from "@o-tid/contracts";

const qpdfHash = "0326859206213694229c4b0917cc0eedf11d023dc5b1aa517eeab7ba3e94aec4";
const clamHash = "56d3158a49bc23a4fe6dea301705bb57f08d69c98cf0bdfd02dfcf9907071bd2";
type Run = NonNullable<NonNullable<PmScanEvidence["qpdf"]>["check"]>;
const completed = (run: Run | null) => run !== null && run.exitCode !== null && run.signal === null && !run.timedOut && !run.outputTruncated;

/** Classification of validated observations only. Native PASSED is never publication authority. */
export function classifyPmScanEvidence(evidence: PmScanEvidence): "PASSED" | "REJECTED" | "FAILED" {
  const { qpdf, clamav } = evidence;
  if (!evidence.contentVerified || !evidence.cleanupSucceeded) return "FAILED";
  if (!qpdf || qpdf.engine.version !== "12.4.1" || qpdf.engine.sha256 !== qpdfHash) return "FAILED";
  if (!completed(qpdf.encryption) || !qpdf.encryption || qpdf.encryption.hasErrors || qpdf.encryption.hasWarnings) return "FAILED";
  if (qpdf.encryption.exitCode === 0) return "REJECTED";
  if (qpdf.encryption.exitCode !== 2 || !completed(qpdf.check) || !qpdf.check) return "FAILED";
  if ([2, 3].includes(qpdf.check.exitCode!)) return "REJECTED";
  if (qpdf.check.exitCode !== 0 || qpdf.check.hasErrors || qpdf.check.hasWarnings) return "FAILED";
  if (!clamav || clamav.engine.version !== "1.5.4" || clamav.engine.sha256 !== clamHash ||
    !completed(clamav.run) || clamav.run.hasErrors || clamav.run.hasWarnings) return "FAILED";
  const { databases, summary } = clamav;
  const start = Date.parse(evidence.startedAt), finish = Date.parse(evidence.finishedAt);
  if (!databases?.signaturesVerified || !summary || summary.scannedFiles !== 1 ||
    [databases.daily, databases.main, databases.bytecode].some(file => Date.parse(file.builtAt) > start) ||
    finish - Date.parse(databases.daily.builtAt) > 3 * 24 * 60 * 60 * 1000) return "FAILED";
  if (clamav.run.exitCode === 1 && summary.infectedFiles === 1) return "REJECTED";
  if (clamav.run.exitCode !== 0 || summary.infectedFiles !== 0) return "FAILED";
  return "PASSED";
}
