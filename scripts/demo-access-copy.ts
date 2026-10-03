import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { DemoInstallationSchema } from "../packages/contracts/src/demo-installation.ts";

const maxManifestBytes = 256 * 1024;

async function main() {
  const args = process.argv.slice(2);
  if (process.platform !== "darwin" || args.length !== 2 || args[0] !== "--private-manifest") throw new Error("invalid");
  const path = args[1];
  if (!path || !isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) throw new Error("invalid");
  const parent = await stat(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0) throw new Error("invalid");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: unknown;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() ||
      (before.mode & 0o777) !== 0o600 || before.size < 1 || before.size > maxManifestBytes) throw new Error("invalid");
    const contents = await file.readFile({ encoding: "utf8" });
    const after = await file.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs) throw new Error("invalid");
    value = JSON.parse(contents);
  } finally { await file.close(); }
  const manifest = DemoInstallationSchema.parse(value);
  if (Date.parse(manifest.expiresAt) <= Date.now()) throw new Error("expired");
  const credential = manifest.credentials.find(row => row.capability === "MANAGE_RACE");
  if (!credential) throw new Error("invalid");
  execFileSync("pbcopy", [], { input: credential.accessCredential, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 });
  process.stdout.write(`Demobehörigheten för lopp ${manifest.raceId} är kopierad till urklipp. Klistra in den i Administratörsbehörighet och skriv sedan över urklippet.\n`);
}

main().catch(() => {
  process.stderr.write("Demobehörigheten kunde inte kopieras. Kontrollera att manifestet är privat, giltigt och skapat av demo:provision på denna Mac.\n");
  process.exitCode = 1;
});
