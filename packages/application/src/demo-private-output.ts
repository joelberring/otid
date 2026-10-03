import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const MAX_OUTPUT_BYTES = 256 * 1024;

/** Deliberately does not disclose an output path, filesystem state, or payload. */
export class DemoPrivateOutputError extends Error {
  public constructor() {
    super("DEMO_PRIVATE_OUTPUT_INVALID");
    this.name = "DemoPrivateOutputError";
  }
}

type Identity = { dev: number; ino: number };

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

async function validateParent(parent: string, expected?: Identity): Promise<{ path: string; identity: Identity }> {
  const actual = await realpath(parent);
  if (actual !== parent) throw new DemoPrivateOutputError();
  const details = await stat(parent);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid === undefined || !details.isDirectory() || details.uid !== uid
    || (details.mode & 0o077) !== 0
    || (expected && !sameIdentity(details, expected))) {
    throw new DemoPrivateOutputError();
  }
  return { path: actual, identity: { dev: details.dev, ino: details.ino } };
}

/**
 * Reserves a new private file for the trusted demo CLI. This mitigates ordinary
 * same-UID mistakes; it is not a claim of complete defence against a hostile filesystem.
 */
export async function reserveDemoPrivateOutput(
  outputPath: string,
  repositoryRoot: string
): Promise<{ write(value: unknown): Promise<void>; close(): Promise<void> }> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (typeof outputPath !== "string" || typeof repositoryRoot !== "string" || !outputPath.startsWith(sep)) {
      throw new DemoPrivateOutputError();
    }
    const target = resolve(outputPath);
    if (target !== outputPath) throw new DemoPrivateOutputError();
    const parent = resolve(dirname(target));
    const root = await realpath(repositoryRoot);
    if (isWithin(target, root)) throw new DemoPrivateOutputError();
    const verifiedParent = await validateParent(parent);
    try {
      await lstat(target);
      throw new DemoPrivateOutputError();
    } catch (error) {
      if (error instanceof DemoPrivateOutputError) throw error;
      // ENOENT is the only acceptable lstat result; all other filesystem errors are unsafe.
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw new DemoPrivateOutputError();
    }
    file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const reservedFile = file;
    await reservedFile.chmod(0o600);
    await reservedFile.sync();
    const directory = await open(verifiedParent.path, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }

    const reserved = await reservedFile.stat();
    if (!reserved.isFile() || reserved.nlink !== 1 || reserved.uid !== process.getuid?.() || (reserved.mode & 0o777) !== 0o600) throw new DemoPrivateOutputError();
    const fileIdentity = { dev: reserved.dev, ino: reserved.ino };
    let writeAttempted = false;
    let closed = false;

    return {
      async write(value: unknown): Promise<void> {
        if (writeAttempted || closed) throw new DemoPrivateOutputError();
        writeAttempted = true;
        try {
          const json = JSON.stringify(value);
          if (json === undefined) throw new DemoPrivateOutputError();
          const bytes = Buffer.from(json, "utf8");
          if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new DemoPrivateOutputError();
          const currentParent = await validateParent(parent, verifiedParent.identity);
          const namedFile = await lstat(target);
          const openFile = await reservedFile.stat();
          if (!namedFile.isFile() || !openFile.isFile() || !sameIdentity(namedFile, fileIdentity) || !sameIdentity(openFile, fileIdentity)
            || currentParent.path !== verifiedParent.path || openFile.nlink !== 1 || openFile.uid !== process.getuid?.()
            || (openFile.mode & 0o777) !== 0o600 || openFile.size !== 0) {
            throw new DemoPrivateOutputError();
          }
          let offset = 0;
          while (offset < bytes.byteLength) {
            const result = await reservedFile.write(bytes, offset, bytes.byteLength - offset, offset);
            if (result.bytesWritten <= 0) throw new DemoPrivateOutputError();
            offset += result.bytesWritten;
          }
          await reservedFile.sync();
          const directory = await open(verifiedParent.path, constants.O_RDONLY | constants.O_DIRECTORY);
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        } catch {
          throw new DemoPrivateOutputError();
        }
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        try {
          await reservedFile.close();
        } catch {
          throw new DemoPrivateOutputError();
        }
      }
    };
  } catch {
    if (file) {
      try { await file.close(); } catch { /* reservation failure leaves the file intact */ }
    }
    throw new DemoPrivateOutputError();
  }
}
