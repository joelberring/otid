import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 4096;
const ROOT = fileURLToPath(new URL("../", import.meta.url));

export type OrganizerAccountCommand =
  | { command: "provision"; outputPath: string; confirmation: string }
  | { command: "rotate"; outputPath: string; confirmation: string };

export function parseOrganizerAccountArguments(args: readonly string[]): OrganizerAccountCommand {
  const [command, ...flags] = args;
  if (command !== "provision" && command !== "rotate") throw new Error("ORGANIZER_ARGUMENTS_INVALID");
  const values = new Map<string, string>();
  if (flags.length !== 4) throw new Error("ORGANIZER_ARGUMENTS_INVALID");
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index]!, value = flags[index + 1]!;
    if (!new Set(["--private-output", "--confirm"]).has(key) || values.has(key) || !value || value.startsWith("--")) {
      throw new Error("ORGANIZER_ARGUMENTS_INVALID");
    }
    values.set(key, value);
  }
  const outputPath = values.get("--private-output");
  const confirmation = values.get("--confirm");
  if (!outputPath || !confirmation) throw new Error("ORGANIZER_ARGUMENTS_INVALID");
  return { command, outputPath, confirmation };
}

export function validateOrganizerAccountTarget(input: {
  command: OrganizerAccountCommand;
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  testDatabaseUrl: string | undefined;
}): string {
  if (!input.databaseUrl) throw new Error("ORGANIZER_TARGET_INVALID");
  if (input.nodeEnv === "production") {
    if (input.command.confirmation !== "production-organizer-account") throw new Error("ORGANIZER_TARGET_INVALID");
    return input.databaseUrl;
  }
  if (input.nodeEnv === "test" && input.testDatabaseUrl && input.databaseUrl === input.testDatabaseUrl
    && input.command.confirmation === "synthetic-test-database" && isSyntheticOrganizerTestDatabase(input.databaseUrl)) {
    return input.databaseUrl;
  }
  throw new Error("ORGANIZER_TARGET_INVALID");
}

function isSyntheticOrganizerTestDatabase(connectionString: string): boolean {
  try {
    const target = new URL(connectionString);
    return (target.protocol === "postgres:" || target.protocol === "postgresql:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
      /^\/(?:otid_task150_|otid_test_)[a-z0-9][a-z0-9_-]*$/.test(target.pathname);
  } catch {
    return false;
  }
}

export async function readPrivateInput(stream: AsyncIterable<Uint8Array | string>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_INPUT_BYTES) throw new Error("ORGANIZER_INPUT_INVALID");
    chunks.push(bytes);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("ORGANIZER_INPUT_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ORGANIZER_INPUT_INVALID");
  return parsed as Record<string, unknown>;
}

type FileIdentity = { dev: number; ino: number };
function sameIdentity(a: FileIdentity, b: FileIdentity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function within(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

/** Creates a new private file outside the repository; never follows or overwrites a path. */
export async function reserveOrganizerPrivateOutput(outputPath: string): Promise<{
  write(value: unknown): Promise<void>;
  close(): Promise<void>;
}> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!outputPath.startsWith(sep) || resolve(outputPath) !== outputPath) throw new Error();
    const target = outputPath;
    const parent = dirname(target);
    const root = await realpath(ROOT);
    if (within(target, root) || await realpath(parent) !== parent) throw new Error();
    const dir = await stat(parent);
    if (!dir.isDirectory() || dir.uid !== process.getuid?.() || (dir.mode & 0o077) !== 0) throw new Error();
    try { await lstat(target); throw new Error(); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") { /* expected */ }
      else throw error;
    }
    file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.chmod(0o600);
    const initial = await file.stat();
    const identity = { dev: initial.dev, ino: initial.ino };
    if (!initial.isFile() || initial.nlink !== 1 || initial.uid !== process.getuid?.() || (initial.mode & 0o777) !== 0o600) throw new Error();
    let written = false;
    let closed = false;
    return {
      async write(value: unknown) {
        if (written || closed) throw new Error("ORGANIZER_OUTPUT_INVALID");
        written = true;
        const bytes = Buffer.from(JSON.stringify(value), "utf8");
        if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error("ORGANIZER_OUTPUT_INVALID");
        const current = await file!.stat();
        const named = await lstat(target);
        if (!sameIdentity(identity, current) || !sameIdentity(identity, named) || current.size !== 0
          || current.nlink !== 1 || (current.mode & 0o777) !== 0o600) throw new Error("ORGANIZER_OUTPUT_INVALID");
        let offset = 0;
        while (offset < bytes.byteLength) {
          const result = await file!.write(bytes, offset, bytes.byteLength - offset, offset);
          if (result.bytesWritten <= 0) throw new Error("ORGANIZER_OUTPUT_INVALID");
          offset += result.bytesWritten;
        }
        await file!.sync();
      },
      async close() { if (!closed) { closed = true; await file!.close(); } }
    };
  } catch {
    if (file) { try { await file.close(); } catch { /* preserve the reservation */ } }
    throw new Error("ORGANIZER_OUTPUT_INVALID");
  }
}
