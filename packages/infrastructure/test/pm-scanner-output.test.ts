import { describe, expect, it } from "vitest";
import { parseClamavScanOutput, parseQpdfCheckOutput, parseQpdfEncryptionOutput, parseSigtoolInfoOutput, type PmScannerProcessCapture } from "../src/pm-scanner-output";

const path = "/private/tmp/synthetic/clean.pdf";
function capture(stdout = ""): PmScannerProcessCapture {
  return { stdout, stderr: "", exitCode: 0, signal: null, timedOut: false, outputTruncated: false };
}
const qpdf = `checking ${path}\nPDF Version: 1.4\nFile is not encrypted\nFile is not linearized\nNo syntax or stream encoding errors found; the file may still contain\nerrors that qpdf cannot detect\n`;
const clamav = `${path}: OK\n\n----------- SCAN SUMMARY -----------\nKnown viruses: 3628052\nEngine version: 1.5.4\nScanned directories: 0\nScanned files: 1\nInfected files: 0\nData scanned: 346 B\nData read: 346 B (ratio 1.00:1)\nTime: 11.273 sec (0 m 11 s)\nStart Date: 2026:09:07 22:30:02\nEnd Date:   2026:09:07 22:30:13\n`;
const info = `File: ${path}\nBuild time: 07 Sep 2026 06:24 +0000\nVersion: 28116\nSignatures: 355647\nFunctionality level: 90\nBuilder: svc.clamav-publisher\nMD5: ${"a".repeat(32)}\nDigital signature: ${"A".repeat(64)}\nVerification OK.\n`;

describe("pinned scanner output boundary", () => {
  it("recognizes the complete clean qpdf output and strips private paths from the observation", () => {
    const result = parseQpdfCheckOutput(capture(qpdf), path);
    expect(result.hasErrors).toBe(false); expect(result.hasWarnings).toBe(false);
    expect(JSON.stringify(result)).not.toContain(path);
    expect(parseQpdfCheckOutput(capture(qpdf.replaceAll("\n", "\r\n")), path)).toEqual(result);
  });
  it.each([qpdf + "WARNING: bad\n", qpdf + qpdf, qpdf.replace("PDF Version: 1.4", "PDF Version: unknown"), qpdf.slice(0, -1), qpdf.replace("checking", "checking\0")])("fails unknown qpdf output %#", stdout => {
    expect(parseQpdfCheckOutput(capture(stdout), path).hasErrors).toBe(true);
  });
  it("requires exact target, empty stderr and independent encryption exit semantics", () => {
    expect(parseQpdfCheckOutput(capture(qpdf), `${path}.other`).hasErrors).toBe(true);
    expect(parseQpdfCheckOutput({ ...capture(qpdf), stderr: "WARNING: diagnostic\n" }, path).hasErrors).toBe(true);
    for (const exitCode of [0, 2]) expect(parseQpdfEncryptionOutput({ ...capture(), exitCode }).hasErrors).toBe(false);
    for (const exitCode of [1, 17, null]) expect(parseQpdfEncryptionOutput({ ...capture(), exitCode }).hasErrors).toBe(true);
    expect(parseQpdfEncryptionOutput(capture("unexpected\n")).hasErrors).toBe(true);
  });
  it("recognizes clean and detection summaries with matching exit and counts", () => {
    const clean = parseClamavScanOutput(capture(clamav), path);
    expect(clean.summary).toEqual({ scannedFiles: 1, infectedFiles: 0 }); expect(clean.run.hasErrors).toBe(false);
    const detected = clamav.replace(`${path}: OK`, `${path}: Eicar-Test-Signature FOUND`).replace("Infected files: 0", "Infected files: 1");
    expect(parseClamavScanOutput({ ...capture(detected), exitCode: 1 }, path).summary).toEqual({ scannedFiles: 1, infectedFiles: 1 });
    expect(parseClamavScanOutput(capture(detected), path).summary).toBeNull();
    expect(JSON.stringify(clean)).not.toContain(path);
  });
  it.each([
    ["Scanned files: 1", "Scanned files: 0"], ["Infected files: 0", "Infected files: 1"],
    ["Known viruses: 3628052", "Known viruses: 0"], ["Known viruses: 3628052", "Known viruses: 9007199254740992"],
    ["Engine version: 1.5.4", "Engine version: 1.5.5"], ["Scanned directories: 0", "Scanned directories: 1"],
    ["Scanned files: 1", "Scanned files: 1\nScanned files: 1"], ["Time: 11.273", "Time: NaN"],
    ["2026:09:07", "2026:02:30"], ["22:30:13", "22:29:00"], ["Data scanned: 346 B", "Data scanned: unknown"],
    [": OK", ": OTHER OK"], ["SCAN SUMMARY", "SCAN SUMMARY ERROR"]
  ])("fails an altered ClamAV field %s", (from, to) => {
    expect(parseClamavScanOutput(capture(clamav.replace(from, to)), path).summary).toBeNull();
  });
  it("does not ignore extra lines, a second summary, missing newline or any stderr", () => {
    for (const stdout of [clamav + "ERROR: hidden\n", clamav + clamav, clamav.slice(0, -1), "extra\n" + clamav]) {
      expect(parseClamavScanOutput(capture(stdout), path).run.hasErrors).toBe(true);
    }
    expect(parseClamavScanOutput({ ...capture(clamav), stderr: "ERROR: database\n" }, path).summary).toBeNull();
  });
  it("preserves timeout/signal/truncation and normalizes invalid process metadata to failure", () => {
    const timed = parseClamavScanOutput({ ...capture(clamav), timedOut: true, signal: "SIGKILL" }, path);
    expect(timed.run).toMatchObject({ timedOut: true, signal: "SIGKILL" });
    expect(timed.summary).toBeNull();
    expect(parseClamavScanOutput({ ...capture(clamav), outputTruncated: true }, path).summary).toBeNull();
    expect(parseQpdfCheckOutput({ ...capture(qpdf), exitCode: 256, signal: "SIGUNKNOWN" }, path)).toMatchObject({ exitCode: null, signal: "OTHER", hasErrors: true });
    expect(parseClamavScanOutput(capture("x".repeat(256 * 1024 + 1)), path).run.outputTruncated).toBe(true);
  });
  it("extracts metadata only with the complete successful signature verification marker", () => {
    expect(parseSigtoolInfoOutput(capture(info), path)).toEqual({ version: 28116, builtAt: "2026-09-07T06:24:00.000Z" });
    for (const stdout of [info.replace("Verification OK.\n", ""), info + "ERROR: bad trust\n", info.replace("07 Sep", "31 Feb"), info.replace("+0000", "+1460"), info.replace("Version: 28116", "Version: 0"), info + info]) {
      expect(parseSigtoolInfoOutput(capture(stdout), path)).toBeNull();
    }
    expect(parseSigtoolInfoOutput({ ...capture(info), exitCode: 1 }, path)).toBeNull();
    expect(parseSigtoolInfoOutput({ ...capture(info), timedOut: true }, path)).toBeNull();
    expect(parseSigtoolInfoOutput({ ...capture(info), stderr: "ERROR: certs" }, path)).toBeNull();
  });
  it("converts the authenticated build timezone rather than assuming process TZ", () => {
    expect(parseSigtoolInfoOutput(capture(info.replace("07 Sep 2026 06:24 +0000", "11 Sep 2025 08:29 -0400")), path)?.builtAt).toBe("2025-09-11T12:29:00.000Z");
    expect(parseSigtoolInfoOutput(capture(info.replace("+0000", "+0200")), path)?.builtAt).toBe("2026-09-07T04:24:00.000Z");
  });
});
