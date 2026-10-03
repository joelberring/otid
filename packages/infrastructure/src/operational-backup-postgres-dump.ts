import { constants, type Stats } from "node:fs";
import { open, lstat, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { measureOperationalBackupPostgresDump } from "./operational-backup-dump";
import type { OperationalBackupPostgresDump } from "@o-tid/contracts";

const genericError = "OPERATIONAL_BACKUP_POSTGRES_DUMP_PORT_INVALID";

/** Connection values remain in trusted process memory and are copied only to pg_dump's environment. */
export type OperationalBackupPostgresConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: "disable" | "require" | "verify-ca" | "verify-full";
};

export type OperationalBackupPostgresDumpPort = {
  dumpPath: string;
  createPostgresDump(): Promise<OperationalBackupPostgresDump>;
};

export type OperationalBackupPostgresDumpPortInput = {
  repositoryRoot: string;
  directory: string;
  backupId: string;
  pgDumpPath: string;
  connection: OperationalBackupPostgresConnection;
  readServerMajor(): Promise<number>;
};

export class OperationalBackupPostgresDumpPortError extends Error {
  constructor() {
    super(genericError);
    this.name = "OperationalBackupPostgresDumpPortError";
  }
}

type Identity = { dev: number; ino: number };

function fail(): never { throw new OperationalBackupPostgresDumpPortError(); }
function currentUid(): number { const uid = process.getuid?.(); if (uid === undefined) return fail(); return uid; }
function isWithin(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}
function assertPrivateFile(details: Stats): Identity {
  if (!details.isFile() || details.nlink !== 1 || details.uid !== currentUid() || (details.mode & 0o777) !== 0o600) return fail();
  return { dev: details.dev, ino: details.ino };
}
function sameIdentity(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function assertString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail();
}
function pgVersionMajor(output: string): number {
  const match = /^pg_dump \(PostgreSQL\) (\d+)(?:\.\d+)+(?: \([^()\r\n]+\))?\s*$/m.exec(output);
  if (!match) return fail();
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value < 1) return fail();
  return value;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, outputFd?: number): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let child;
    try {
      child = spawn(command, args, {
        env,
        shell: false,
        stdio: outputFd === undefined ? ["ignore", "pipe", "ignore"] : ["ignore", outputFd, "ignore"]
      });
    } catch { rejectPromise(new OperationalBackupPostgresDumpPortError()); return; }
    if (outputFd === undefined) {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 1024) child.kill("SIGKILL");
      });
    }
    child.once("error", () => rejectPromise(new OperationalBackupPostgresDumpPortError()));
    child.once("close", (code: number | null) => {
      if (code === null) rejectPromise(new OperationalBackupPostgresDumpPortError());
      else resolvePromise({ code, stdout });
    });
  });
}

async function* fileChunks(handle: Awaited<ReturnType<typeof open>>): AsyncGenerator<Uint8Array> {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) return;
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

/** Creates a one-use trusted dump port; reservation happens only after DUMP_PENDING. */
export async function createOperationalBackupPostgresDumpPort(
  input: OperationalBackupPostgresDumpPortInput
): Promise<OperationalBackupPostgresDumpPort> {
  let reservation: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
    const { repositoryRoot, directory, backupId, pgDumpPath, connection } = input;
    assertString(repositoryRoot); assertString(directory); assertString(pgDumpPath);
    if (resolve(repositoryRoot) !== repositoryRoot || resolve(directory) !== directory || resolve(pgDumpPath) !== pgDumpPath
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(backupId)) return fail();
    const [actualRoot, actualDirectory, directoryInfo] = await Promise.all([
      realpath(repositoryRoot), realpath(directory), lstat(directory)
    ]);
    if (actualRoot !== repositoryRoot || actualDirectory !== directory || isWithin(directory, actualRoot)
      || directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory() || directoryInfo.uid !== currentUid()
      || (directoryInfo.mode & 0o777) !== 0o700) return fail();
    const toolInfo = await stat(pgDumpPath);
    if (!toolInfo.isFile()) return fail();
    if (!connection || typeof connection !== "object" || Array.isArray(connection)) return fail();
    assertString(connection.host); assertString(connection.user); assertString(connection.database);
    if (typeof connection.password !== "string" || connection.password.includes("\0")) return fail();
    if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(connection.database)
      || !["disable", "require", "verify-ca", "verify-full"].includes(connection.sslMode)) return fail();
    if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535
      || Object.keys(connection).some(key => !["host", "port", "user", "password", "database", "sslMode"].includes(key))) return fail();
    if (typeof input.readServerMajor !== "function") return fail();

    const dumpPath = join(directory, `${backupId}.dump`);
    const directoryIdentity = { dev: directoryInfo.dev, ino: directoryInfo.ino };
    const env: NodeJS.ProcessEnv = {
      ...(typeof process.env.PATH === "string" ? { PATH: process.env.PATH } : {}),
      ...(typeof process.env.LANG === "string" ? { LANG: process.env.LANG } : {}),
      PGHOST: connection.host,
      PGPORT: String(connection.port),
      PGUSER: connection.user,
      PGPASSWORD: connection.password,
      PGSSLMODE: connection.sslMode
    };
    let called = false;
    return {
      dumpPath,
      async createPostgresDump() {
        if (called) return fail();
        called = true;
        let result: OperationalBackupPostgresDump | undefined;
        let failed = false;
        try {
          const [resolvedDirectory, currentDirectory] = await Promise.all([realpath(directory), lstat(directory)]);
          if (resolvedDirectory !== directory || currentDirectory.isSymbolicLink() || !currentDirectory.isDirectory()
            || currentDirectory.uid !== currentUid() || (currentDirectory.mode & 0o777) !== 0o700
            || !sameIdentity(directoryIdentity, { dev: currentDirectory.dev, ino: currentDirectory.ino })) throw new OperationalBackupPostgresDumpPortError();
          reservation = await open(dumpPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          await reservation.chmod(0o600);
          const original = assertPrivateFile(await reservation.stat());
          const serverMajor = await input.readServerMajor();
          if (!Number.isSafeInteger(serverMajor) || serverMajor < 1) throw new OperationalBackupPostgresDumpPortError();
          const version = await run(pgDumpPath, ["--version"], env);
          if (version.code !== 0 || pgVersionMajor(version.stdout) !== serverMajor) throw new OperationalBackupPostgresDumpPortError();
          const dumped = await run(pgDumpPath, ["--format=custom", `--dbname=${connection.database}`], env, reservation.fd);
          if (dumped.code !== 0) throw new OperationalBackupPostgresDumpPortError();
          await reservation.sync();
          const openedIdentity = assertPrivateFile(await reservation.stat());
          const named = assertPrivateFile(await lstat(dumpPath));
          if (!sameIdentity(original, openedIdentity) || !sameIdentity(original, named)) throw new OperationalBackupPostgresDumpPortError();
          const measured = await measureOperationalBackupPostgresDump({ identity: `${backupId}.dump`, chunks: fileChunks(reservation) });
          const afterStats = await reservation.stat();
          const after = assertPrivateFile(afterStats);
          const namedAfter = assertPrivateFile(await lstat(dumpPath));
          if (!sameIdentity(original, after) || !sameIdentity(original, namedAfter)
            || afterStats.size !== measured.byteLength || afterStats.size === 0) throw new OperationalBackupPostgresDumpPortError();
          result = measured;
        } catch { failed = true; }
        if (reservation) {
          try { await reservation.sync(); } catch { failed = true; }
          try { await reservation.close(); } catch { failed = true; }
        }
        if (failed || !result) return fail();
        return result;
      }
    };
  } catch {
    if (reservation) {
      try { await reservation.close(); } catch { /* Retain the generic construction failure. */ }
    }
    throw new OperationalBackupPostgresDumpPortError();
  }
}
