import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, mkdtemp, mkdir, open, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { pmObjectManifestSchema, type PmObjectManifest, type PmScanEvidence } from "@o-tid/contracts";
import { parseClamavScanOutput, parseQpdfCheckOutput, parseQpdfEncryptionOutput, parseSigtoolInfoOutput, type PmScannerProcessCapture } from "./pm-scanner-output";

const configuration = z.object({ mode: z.literal("native-compatibility-probe"),
  root: z.string().regex(/^\/private\/tmp\/otid-pm-scanners\.[A-Za-z0-9]+$/) }).strict();
const qpdfHash = "0326859206213694229c4b0917cc0eedf11d023dc5b1aa517eeab7ba3e94aec4";
const clamHash = "56d3158a49bc23a4fe6dea301705bb57f08d69c98cf0bdfd02dfcf9907071bd2";
const sigtoolHash = "e1fa10f39533544bd0584cd4f504182919397c7f023985135a845f1c91f137a0";
const certificateHash = "60200e4b4b1b1b7257bb4550487aeb142034341f3300a8526e77a3134a940e9d";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function boundedFile(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error("NATIVE_INPUT_INVALID");
    const bytes = Buffer.alloc(stat.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const part = await file.read(bytes, read, bytes.length - read, read);
      if (part.bytesRead === 0) break;
      read += part.bytesRead;
    }
    if (read !== stat.size) throw new Error("NATIVE_INPUT_CHANGED");
    return bytes.subarray(0, read);
  } finally { await file.close(); }
}

export async function captureNativeScannerProcess(binary: string, args: string[], directory: string,
  env: Record<string, string>, signal: AbortSignal): Promise<PmScannerProcessCapture> {
  if (signal.aborted) throw new Error("NATIVE_ABORTED");
  const deadline = performance.now() + 60_000;
  const child = spawn(binary, args, { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let size = 0, outputTruncated = false, timedOut = false, spawnFailed = false;
  for (const [stream, target] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 256 * 1024) { outputTruncated = true; child.kill("SIGKILL"); } else target.push(chunk);
  });
  const abort = () => { child.kill("SIGKILL"); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, 60_000);
  try {
    const result = await new Promise<{ exitCode: number | null; signal: string | null }>(resolve => {
      child.once("error", () => { spawnFailed = true; });
      child.once("close", (exitCode, terminationSignal) => resolve({ exitCode, signal: terminationSignal }));
    });
    if (performance.now() >= deadline) timedOut = true;
    return { ...result, stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: spawnFailed || signal.aborted ? "NATIVE_PROCESS_FAILED" : Buffer.concat(stderr).toString("utf8"), timedOut, outputTruncated };
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

/** Explicit local compatibility tool, never a production-isolation implementation. */
export function createNativePmScannerProbe(input: unknown) {
  const parsed = configuration.safeParse(input);
  if (!parsed.success || !["test", "development"].includes(process.env.NODE_ENV ?? "") ||
    process.platform !== "darwin" || process.arch !== "arm64" || process.getuid?.() === 0) throw new Error("NATIVE_PROBE_CONFIGURATION_REQUIRED");
  const root = parsed.data.root;
  const qpdf = join(root, "qpdf/12.4.1/bin/qpdf"), clam = join(root, "clamav/1.5.4/bin/clamscan"), sigtool = join(root, "clamav/1.5.4/bin/sigtool");
  const certs = join(root, "clamav-expanded/clamav-1.5.4.macos.universal-programs.pkg/Payload/usr/local/clamav/etc/certs");
  const libraries = ["qpdf/12.4.1/lib", "clamav/1.5.4/lib", "yara/4.5.8/lib", "jansson/2.15.1/lib", "libmagic/5.48/lib"].map(path => join(root, path));
  libraries.push(...["jpeg-turbo", "json-c", "openssl@3", "pcre2", "protobuf-c"].map(name => `/opt/homebrew/opt/${name}/lib`));

  return { async scan(input: { manifest: PmObjectManifest; bytes: Uint8Array; signal: AbortSignal }): Promise<PmScanEvidence> {
    const manifest = pmObjectManifestSchema.parse(input.manifest);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength !== manifest.byteLength) throw new Error("NATIVE_BYTES_INVALID");
    const bytes = Buffer.from(input.bytes);
    const evidence: PmScanEvidence = { formatVersion: 1, executionProfile: "native-probe-v1", scanPolicy: "pm-pdf-v1", manifest,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), contentVerified: hash(bytes) === manifest.sha256,
      cleanupSucceeded: false, qpdf: null, clamav: null };
    let directory: string | undefined, snapshot: string | undefined;
    const ownFiles: string[] = [];
    try {
      if (!evidence.contentVerified || input.signal.aborted) throw new Error("NATIVE_INPUT_INVALID");
      for (const [path, expected] of [[qpdf, qpdfHash], [clam, clamHash], [sigtool, sigtoolHash], [join(certs, "clamav.crt"), certificateHash]] as const) {
        if (hash(await boundedFile(path, 32 * 1024 * 1024)) !== expected) throw new Error("NATIVE_PIN_MISMATCH");
      }
      directory = await mkdtemp("/private/tmp/otid-pm-scan-"); await chmod(directory, 0o700);
      const target = join(directory, "input.pdf");
      await writeFile(target, bytes, { mode: 0o600, flag: "wx" }); ownFiles.push(target);
      const env = { PATH: "/usr/bin:/bin", DYLD_LIBRARY_PATH: libraries.join(":"), CVD_CERTS_DIR: certs,
        TMPDIR: directory, LC_ALL: "C", TZ: "UTC" };
      const run = (binary: string, args: string[]) => captureNativeScannerProcess(binary, args, directory!, env, input.signal);
      const encryption = parseQpdfEncryptionOutput(await run(qpdf, ["--is-encrypted", target]));
      evidence.qpdf = { engine: { version: "12.4.1", sha256: qpdfHash }, encryption, check: null };
      if (encryption.hasErrors || encryption.exitCode !== 2) return evidence;
      evidence.qpdf.check = parseQpdfCheckOutput(await run(qpdf, ["--check", target]), target);
      if (evidence.qpdf.check.hasErrors || evidence.qpdf.check.exitCode !== 0) return evidence;

      snapshot = join(directory, "signatures"); await mkdir(snapshot, { mode: 0o700 });
      const names = await readdir(join(root, "signatures")), hashes = new Map<string, string>();
      let total = 0;
      for (const name of names) {
        if (name === "freshclam.dat") continue;
        if (!/^(daily|main|bytecode)(?:-[0-9]+\.cvd\.sign|\.cvd)$/.test(name)) throw new Error("NATIVE_SIGNATURE_INVENTORY");
        const data = await boundedFile(join(root, "signatures", name), name.endsWith(".sign") ? 1024 * 1024 : 128 * 1024 * 1024);
        total += data.length; if (total > 256 * 1024 * 1024) throw new Error("NATIVE_SIGNATURE_LIMIT");
        const path = join(snapshot, name); await writeFile(path, data, { mode: 0o400, flag: "wx" }); ownFiles.push(path); hashes.set(name, hash(data));
      }
      await chmod(snapshot, 0o500);
      const databases = {} as NonNullable<NonNullable<PmScanEvidence["clamav"]>["databases"]>;
      databases.signaturesVerified = true;
      for (const name of ["daily", "main", "bytecode"] as const) {
        if (!hashes.has(`${name}.cvd`) || names.filter(file => file.startsWith(`${name}-`) && file.endsWith(".cvd.sign")).length !== 1) throw new Error("NATIVE_SIGNATURE_INVENTORY");
        const path = join(snapshot, `${name}.cvd`), metadata = parseSigtoolInfoOutput(await run(sigtool, ["--info", path]), path);
        if (!metadata || !hashes.has(`${name}-${metadata.version}.cvd.sign`)) throw new Error("NATIVE_SIGNATURE_VERIFICATION");
        databases[name] = { ...metadata, sha256: hashes.get(`${name}.cvd`)! };
      }
      const capture = await run(clam, [`--database=${snapshot}`, "--official-db-only=yes", "--fail-if-cvd-older-than=3",
        "--scan-pdf=yes", "--alert-encrypted=yes", "--alert-exceeds-max=yes", "--max-filesize=10M", "--max-scansize=50M", "--max-files=100", "--max-recursion=8", target]);
      const antivirus = parseClamavScanOutput(capture, target);
      evidence.clamav = { engine: { version: "1.5.4", sha256: clamHash }, ...antivirus, databases };
      if ((await readdir(snapshot)).length !== hashes.size) throw new Error("NATIVE_SIGNATURE_CHANGED");
      for (const [name, expected] of hashes) {
        if (hash(await boundedFile(join(snapshot, name), 128 * 1024 * 1024)) !== expected) throw new Error("NATIVE_SIGNATURE_CHANGED");
      }
      if (hash(await boundedFile(target, 10 * 1024 * 1024)) !== manifest.sha256) evidence.contentVerified = false;
      return evidence;
    } catch {
      // Preserve observed failures but never accidentally retain a clean AV
      // assertion when subsequent provenance or file-integrity checks failed.
      if (evidence.clamav) evidence.clamav.run.hasErrors = true;
      return evidence;
    } finally {
      let cleaned = true;
      if (snapshot) { try { await chmod(snapshot, 0o700); } catch { cleaned = false; } }
      for (const path of ownFiles.reverse()) { try { await unlink(path); } catch { cleaned = false; } }
      if (snapshot) { try { await rmdir(snapshot); } catch { cleaned = false; } }
      if (directory) { try { await rmdir(directory); } catch { cleaned = false; } }
      evidence.cleanupSucceeded = cleaned;
      if (input.signal.aborted) evidence.contentVerified = false;
      evidence.finishedAt = new Date().toISOString();
    }
  } };
}
