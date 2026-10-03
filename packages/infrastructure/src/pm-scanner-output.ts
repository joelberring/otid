import type { PmScanEvidence } from "@o-tid/contracts";

export interface PmScannerProcessCapture {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
}
type Run = NonNullable<NonNullable<PmScanEvidence["qpdf"]>["check"]>;
const signals = new Set(["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGBUS"]);

function observation(capture: PmScannerProcessCapture): Run {
  const validCode = capture.exitCode === null || (Number.isInteger(capture.exitCode) && capture.exitCode >= 0 && capture.exitCode <= 255);
  const tooLarge = Buffer.byteLength(capture.stdout) + Buffer.byteLength(capture.stderr) > 256 * 1024;
  return { exitCode: validCode ? capture.exitCode : null,
    signal: capture.signal === null ? null : signals.has(capture.signal) ? capture.signal as Run["signal"] : "OTHER",
    timedOut: capture.timedOut, outputTruncated: capture.outputTruncated || tooLarge,
    hasErrors: !validCode || capture.exitCode === null || capture.signal !== null || capture.timedOut ||
      capture.outputTruncated || capture.stderr.length > 0 || tooLarge, hasWarnings: /warning/i.test(capture.stderr) };
}
function lines(stdout: string): string[] {
  const normalized = stdout.replaceAll("\r\n", "\n");
  if (!normalized.endsWith("\n") || [...normalized].some(char => (char.charCodeAt(0) < 32 && char !== "\n") || char.charCodeAt(0) === 127)) return [];
  return normalized.slice(0, -1).split("\n");
}
function validPath(path: string) { return path.startsWith("/") && path.length <= 4096 && ![...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127); }

export function parseQpdfCheckOutput(capture: PmScannerProcessCapture, targetPath: string): Run {
  const result = observation(capture), output = lines(capture.stdout);
  const recognized = validPath(targetPath) && output.length === 6 && output[0] === `checking ${targetPath}` &&
    /^PDF Version: [1-2]\.[0-9]$/.test(output[1]!) && output[2] === "File is not encrypted" &&
    ["File is linearized", "File is not linearized"].includes(output[3]!) &&
    output[4] === "No syntax or stream encoding errors found; the file may still contain" &&
    output[5] === "errors that qpdf cannot detect";
  return { ...result, hasErrors: result.hasErrors || !recognized, hasWarnings: result.hasWarnings || /warning/i.test(capture.stdout) };
}

export function parseQpdfEncryptionOutput(capture: PmScannerProcessCapture): Run {
  const result = observation(capture);
  return { ...result, hasErrors: result.hasErrors || capture.stdout !== "" || ![0, 2].includes(capture.exitCode ?? -1) };
}

function counter(line: string | undefined, label: string): number | null {
  if (!line?.startsWith(label)) return null;
  const value = line.slice(label.length);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function scanTime(line: string, prefix: string): number | null {
  if (!line.startsWith(prefix)) return null;
  const value = line.slice(prefix.length);
  if (!/^[0-9]{4}:[0-9]{2}:[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(value)) return null;
  const iso = `${value.slice(0, 10).replaceAll(":", "-")}T${value.slice(11)}.000Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso ? date.getTime() : null;
}

/** Recognizes the entire pinned C-locale output; unknown format never produces a clean summary. */
export function parseClamavScanOutput(capture: PmScannerProcessCapture, targetPath: string): {
  run: Run; summary: NonNullable<PmScanEvidence["clamav"]>["summary"];
} {
  const run = observation(capture), output = lines(capture.stdout);
  const failed = () => ({ run: { ...run, hasErrors: true }, summary: null });
  if (run.hasErrors || run.outputTruncated || !validPath(targetPath) || output.length !== 13 ||
    !output[0]!.startsWith(`${targetPath}: `) || output[1] !== "" || output[2] !== "----------- SCAN SUMMARY -----------" ||
    output[4] !== "Engine version: 1.5.4") return failed();
  const known = counter(output[3], "Known viruses: "), directories = counter(output[5], "Scanned directories: ");
  const scannedFiles = counter(output[6], "Scanned files: "), infectedFiles = counter(output[7], "Infected files: ");
  const fileStatus = output[0]!.slice(targetPath.length + 2);
  const clean = capture.exitCode === 0 && fileStatus === "OK" && infectedFiles === 0;
  const detected = capture.exitCode === 1 && /^[A-Za-z0-9_.-]{1,200}(?:\([A-Za-z0-9_.-]{1,32}\))? FOUND$/.test(fileStatus) && infectedFiles === 1;
  const startedAt = scanTime(output[11]!, "Start Date: "), finishedAt = scanTime(output[12]!, "End Date:   ");
  if (known === null || known === 0 || directories !== 0 || scannedFiles !== 1 || (!clean && !detected) ||
    !/^Data scanned: [0-9]+(?:\.[0-9]{1,3})? (?:B|KB|MB|GB)$/.test(output[8]!) ||
    !/^Data read: [0-9]+(?:\.[0-9]{1,3})? (?:B|KB|MB|GB) \(ratio [0-9]+\.[0-9]{2}:1\)$/.test(output[9]!) ||
    !/^Time: [0-9]+\.[0-9]{3} sec \([0-9]+ m [0-9]+ s\)$/.test(output[10]!) ||
    startedAt === null || finishedAt === null || finishedAt < startedAt) return failed();
  return { run, summary: { scannedFiles, infectedFiles } };
}

/** Metadata only after the actual verifier emits its complete successful output. */
export function parseSigtoolInfoOutput(capture: PmScannerProcessCapture, targetPath: string): { version: number; builtAt: string } | null {
  const run = observation(capture), output = lines(capture.stdout);
  if (run.hasErrors || run.outputTruncated || run.timedOut || run.signal !== null || run.exitCode !== 0 ||
    !validPath(targetPath) || output.length !== 9 || output[0] !== `File: ${targetPath}` || output[8] !== "Verification OK.") return null;
  const version = counter(output[2], "Version: "), signatures = counter(output[3], "Signatures: ");
  const level = counter(output[4], "Functionality level: ");
  const time = /^Build time: ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}) ([+-])([0-9]{2})([0-9]{2})$/.exec(output[1]!);
  if (!time || version === null || version < 1 || signatures === null || signatures < 1 || level === null ||
    !/^Builder: [A-Za-z0-9_.-]{1,128}$/.test(output[5]!) || !/^MD5: [a-f0-9]{32}$/.test(output[6]!) ||
    !/^Digital signature: [A-Za-z0-9+/=]{32,1024}$/.test(output[7]!)) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(time[2]!);
  const builtAt = `${time[3]}-${String(month + 1).padStart(2, "0")}-${time[1]}T${time[4]}:${time[5]}:00.000Z`;
  const date = new Date(builtAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== builtAt) return null;
  const hours = Number(time[7]), minutes = Number(time[8]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  const offset = (hours * 60 + minutes) * (time[6] === "+" ? 1 : -1);
  return { version, builtAt: new Date(date.getTime() - offset * 60_000).toISOString() };
}
