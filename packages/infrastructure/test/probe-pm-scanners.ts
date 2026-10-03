import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseClamavScanOutput, parseQpdfCheckOutput, parseQpdfEncryptionOutput, parseSigtoolInfoOutput } from "../src/pm-scanner-output";

// Opt-in engine compatibility probe, never a production scan/publication proof.
const root = process.argv[2];
if (!root || !/^\/private\/tmp\/otid-pm-scanners\.[A-Za-z0-9]+$/.test(root) || process.platform !== "darwin" || process.arch !== "arm64" || process.getuid?.() === 0) {
  throw new Error("Private native scanner fixture directory and non-root darwin-arm64 required");
}
const qpdf = join(root, "qpdf/12.4.1/bin/qpdf"), clam = join(root, "clamav/1.5.4/bin/clamscan");
const sigtool = join(root, "clamav/1.5.4/bin/sigtool");
for (const [file, expected] of [
  [qpdf, "0326859206213694229c4b0917cc0eedf11d023dc5b1aa517eeab7ba3e94aec4"],
  [clam, "56d3158a49bc23a4fe6dea301705bb57f08d69c98cf0bdfd02dfcf9907071bd2"],
  [sigtool, "e1fa10f39533544bd0584cd4f504182919397c7f023985135a845f1c91f137a0"]
] as const) {
  if (createHash("sha256").update(await readFile(file)).digest("hex") !== expected) throw new Error("Scanner binary hash mismatch");
}
const directory = await mkdtemp("/private/tmp/otid-pm-engine-probe-");
await chmod(directory, 0o700);
const certificates = join(root, "clamav-expanded/clamav-1.5.4.macos.universal-programs.pkg/Payload/usr/local/clamav/etc/certs");
if (createHash("sha256").update(await readFile(join(certificates, "clamav.crt"))).digest("hex") !==
  "60200e4b4b1b1b7257bb4550487aeb142034341f3300a8526e77a3134a940e9d") throw new Error("CVD trust anchor mismatch");
const libraries = ["qpdf/12.4.1/lib", "clamav/1.5.4/lib", "yara/4.5.8/lib", "jansson/2.15.1/lib", "libmagic/5.48/lib"].map(path => join(root, path));
libraries.push(...["jpeg-turbo", "json-c", "openssl@3", "pcre2", "protobuf-c"].map(name => `/opt/homebrew/opt/${name}/lib`));
const environment = { PATH: "/usr/bin:/bin", DYLD_LIBRARY_PATH: libraries.join(":"), CVD_CERTS_DIR: certificates, TMPDIR: directory, LC_ALL: "C", TZ: "UTC" };
const observations: Array<{ label: string; code: number | null; signal: string | null; outputValidated: boolean }> = [];
const parsedObservations: Record<string, unknown> = {};
const signatureSnapshot = join(directory, "signature-snapshot");
await mkdir(signatureSnapshot, { mode: 0o700 });
const sourceNames = await readdir(join(root, "signatures"));
const snapshotHashes = new Map<string, string>();
for (const name of sourceNames) {
  if (name === "freshclam.dat") continue; // updater state is never passed to the scanner
  if (!/^(daily|main|bytecode)(?:-[0-9]+\.cvd\.sign|\.cvd)$/.test(name)) throw new Error("Unexpected signature source file");
  const bytes = await readFile(join(root, "signatures", name));
  snapshotHashes.set(name, createHash("sha256").update(bytes).digest("hex"));
  await writeFile(join(signatureSnapshot, name), bytes, { mode: 0o400, flag: "wx" });
}
for (const name of ["daily", "main", "bytecode"]) {
  if (!snapshotHashes.has(`${name}.cvd`) || sourceNames.filter(file => file.startsWith(`${name}-`) && file.endsWith(".cvd.sign")).length !== 1) {
    throw new Error("Signature snapshot requires one CVD and one detached signature per database");
  }
}
await chmod(signatureSnapshot, 0o500);
async function run(label: string, binary: string, args: string[], allowed: number[], validate?: (output: string) => boolean) {
  const child = spawn(binary, args, { cwd: directory, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [], stdout: Buffer[] = [], stderr: Buffer[] = [];
  let size = 0, outputTruncated = false, timedOut = false;
  for (const [stream, output] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 256 * 1024) { outputTruncated = true; child.kill("SIGKILL"); } else { chunks.push(chunk); output.push(chunk); }
  });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 60_000);
  const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  await writeFile(join(directory, `${label}.log`), Buffer.concat(chunks), { mode: 0o600, flag: "wx" });
  const outputValidated = validate?.(Buffer.concat(chunks).toString("utf8")) ?? true;
  observations.push({ label, ...result, outputValidated });
  console.log(`${label}: exit ${result.code}, signal ${result.signal ?? "none"}`);
  if (timedOut || outputTruncated || result.signal !== null || result.code === null || !allowed.includes(result.code) || !outputValidated) throw new Error(`Native probe failed: ${label}; inspect private logs`);
  return { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"),
    exitCode: result.code, signal: result.signal, timedOut, outputTruncated };
}
console.log(`Private probe directory: ${directory}`);
const clean = join(directory, "clean.pdf"), encrypted = join(directory, "encrypted.pdf"), broken = join(directory, "broken.pdf");
try {
  await run("qpdf-version", qpdf, ["--version"], [0]);
  await run("clam-version", clam, ["--version"], [0]);
  for (const name of ["daily", "main", "bytecode"] as const) {
    const path = join(signatureSnapshot, `${name}.cvd`);
    const beforeHash = createHash("sha256").update(await readFile(path)).digest("hex");
    const capture = await run(`verify-${name}`, sigtool, ["--info", path], [0]);
    const metadata = parseSigtoolInfoOutput(capture, path);
    const afterHash = createHash("sha256").update(await readFile(path)).digest("hex");
    if (!metadata || beforeHash !== afterHash || !snapshotHashes.has(`${name}-${metadata.version}.cvd.sign`)) throw new Error("Native signature verification/provenance failed");
    parsedObservations[name] = { ...metadata, sha256: afterHash, verification: "sigtool-default-cvd",
      detachedSignatureSha256: snapshotHashes.get(`${name}-${metadata.version}.cvd.sign`) };
  }
  // Independently generated one-page fixture with exact byte offsets; qpdf
  // deliberately rejects its own --empty output because it has no pages.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(clean, pdf, { mode: 0o600, flag: "wx" });
  const cleanSummary = "No syntax or stream encoding errors found; the file may still contain\nerrors that qpdf cannot detect";
  const structure = parseQpdfCheckOutput(await run("clean-structure", qpdf, ["--check", clean], [0], output => output.includes(cleanSummary) && !/warning|error/i.test(output.replace(cleanSummary, ""))), clean);
  const encryption = parseQpdfEncryptionOutput(await run("clean-encryption", qpdf, ["--is-encrypted", clean], [2]));
  if (structure.hasErrors || encryption.hasErrors) throw new Error("Native qpdf output not recognized");
  parsedObservations.qpdf = { check: structure, encryption };
  await run("create-encrypted", qpdf, ["--encrypt", "synthetic-user", "synthetic-owner", "256", "--", clean, encrypted], [0]);
  await run("encrypted-status", qpdf, ["--is-encrypted", encrypted], [0]);
  await writeFile(broken, "%PDF-1.4\nintentionally truncated\n", { mode: 0o600, flag: "wx" });
  await run("broken-structure", qpdf, ["--check", broken], [2, 3]);
  const missing = join(directory, "empty-signatures"); await mkdir(missing, { mode: 0o700 });
  await run("missing-database", clam, [`--database=${missing}`, clean], [2]);
  const options = [`--database=${signatureSnapshot}`, "--official-db-only=yes", "--fail-if-cvd-older-than=3",
    "--scan-pdf=yes", "--alert-encrypted=yes", "--alert-exceeds-max=yes", "--max-filesize=10M", "--max-scansize=50M", "--max-files=100", "--max-recursion=8"];
  const scanSummary = (output: string, infected: number) =>
    /^Engine version: 1\.5\.4\r?$/m.test(output) &&
    /^Scanned files: 1\r?$/m.test(output) &&
    new RegExp(`^Infected files: ${infected}\\r?$`, "m").test(output) &&
    !/error|warning|limits? exceeded/i.test(output);
  const antivirus = parseClamavScanOutput(await run("clean-antivirus", clam, [...options, clean], [0], output => scanSummary(output, 0)), clean);
  if (antivirus.run.hasErrors || antivirus.summary?.infectedFiles !== 0) throw new Error("Native clean output not recognized");
  parsedObservations.antivirus = antivirus;
  // Harmless standard antivirus test string, stored only in this new private fixture directory.
  const eicar = join(directory, "eicar-test.txt");
  await writeFile(eicar, "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", { mode: 0o600, flag: "wx" });
  const detection = parseClamavScanOutput(await run("antivirus-test-detection", clam, [...options, eicar], [1], output => scanSummary(output, 1) && output.includes("Eicar-Test-Signature FOUND")), eicar);
  if (detection.run.hasErrors || detection.summary?.infectedFiles !== 1) throw new Error("Native detection output not recognized");
  parsedObservations.detection = detection;
  const finalNames = await readdir(signatureSnapshot);
  if (finalNames.length !== snapshotHashes.size) throw new Error("Signature snapshot inventory changed");
  for (const [name, hash] of snapshotHashes) {
    if (createHash("sha256").update(await readFile(join(signatureSnapshot, name))).digest("hex") !== hash) {
      throw new Error("Signature snapshot changed during scan");
    }
  }
  console.log("Native engines passed. This is not a production sandbox or scan report.");
} finally {
  await writeFile(join(directory, "observations.json"), JSON.stringify(observations, null, 2), { mode: 0o600, flag: "wx" });
  await writeFile(join(directory, "parsed-observations.json"), JSON.stringify(parsedObservations, null, 2), { mode: 0o600, flag: "wx" });
}
