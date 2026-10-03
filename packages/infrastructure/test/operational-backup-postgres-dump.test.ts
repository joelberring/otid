import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalOperationalBackupManifestBytes, type OperationalBackupManifest, type OperationalBackupOperationState } from "@o-tid/contracts";
import { captureOperationalBackupSource } from "@o-tid/application";
import { afterEach, describe, expect, it } from "vitest";
import { createOperationalBackupPostgresDumpPort, OperationalBackupPostgresDumpPortError } from "../src";

const roots: string[] = [];
const repositoryRoot = process.cwd();
const backupId = "a0000000-0000-4000-8000-000000000001";
const payload = "synthetic PostgreSQL custom dump";
const connection = { host: "127.0.0.1", port: 5432, user: "synthetic", password: "private-test-secret", database: "otid_test", sslMode: "disable" as const };

async function privateDirectory(): Promise<string> {
  const directory = await mkdtemp("/private/tmp/otid-pg-dump-port-");
  roots.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

async function fakePgDump(directory: string): Promise<string> {
  const path = join(directory, "pg_dump-test");
  await writeFile(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'pg_dump (PostgreSQL) 17.4 (Homebrew)\\n'; exit 0; fi\nprintf '${payload}'; exit 0\n`, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function manifest(dump: { identity: string; sha256: string; byteLength: number }): OperationalBackupManifest {
  return {
    formatVersion: 1,
    backupId,
    createdAt: "2026-09-23T10:00:00.000Z",
    writeStopConfirmed: true,
    postgresDump: dump,
    migrationIdentity: "migration-0001",
    pmObjects: []
  };
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("operational backup PostgreSQL dump port", () => {
  it("reserves, dumps, syncs, and measures a private one-use file", async () => {
    const directory = await privateDirectory();
    const port = await createOperationalBackupPostgresDumpPort({
      repositoryRoot, directory, backupId, pgDumpPath: await fakePgDump(directory), connection,
      readServerMajor: async () => 17
    });
    expect(port.dumpPath).toBe(join(directory, `${backupId}.dump`));
    await expect(port.createPostgresDump()).resolves.toEqual({
      identity: `${backupId}.dump`, sha256: createHash("sha256").update(payload).digest("hex"), byteLength: Buffer.byteLength(payload)
    });
    await expect(port.createPostgresDump()).rejects.toBeInstanceOf(OperationalBackupPostgresDumpPortError);
  });

  it("rejects version mismatch and duplicate backup id without overwriting the reservation", async () => {
    const directory = await privateDirectory();
    const input = { repositoryRoot, directory, backupId, pgDumpPath: await fakePgDump(directory), connection, readServerMajor: async () => 16 };
    const port = await createOperationalBackupPostgresDumpPort(input);
    await expect(port.createPostgresDump()).rejects.toBeInstanceOf(OperationalBackupPostgresDumpPortError);
    const duplicate = await createOperationalBackupPostgresDumpPort(input);
    await expect(duplicate.createPostgresDump()).rejects.toBeInstanceOf(OperationalBackupPostgresDumpPortError);
  });

  it("keeps a partial private dump after pg_dump fails and exposes no connection secret", async () => {
    const directory = await privateDirectory();
    const pgDumpPath = join(directory, "pg_dump-fails");
    await writeFile(pgDumpPath, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'pg_dump (PostgreSQL) 17.4\\n'; exit 0; fi\nprintf 'partial'; exit 7\n`, { mode: 0o700 });
    await chmod(pgDumpPath, 0o700);
    const port = await createOperationalBackupPostgresDumpPort({ repositoryRoot, directory, backupId, pgDumpPath, connection, readServerMajor: async () => 17 });
    let error: unknown;
    try { await port.createPostgresDump(); } catch (caught: unknown) { error = caught; }
    expect(error).toBeInstanceOf(OperationalBackupPostgresDumpPortError);
    expect((error as Error).message).not.toContain(connection.password);
    const { readFile, stat } = await import("node:fs/promises");
    expect(await readFile(port.dumpPath, "utf8")).toBe("partial");
    expect((await stat(port.dumpPath)).mode & 0o777).toBe(0o600);
  });

  it("records DUMP_PENDING before invoking this real dump port through capture composition", async () => {
    const directory = await privateDirectory();
    const dumpPort = await createOperationalBackupPostgresDumpPort({
      repositoryRoot, directory, backupId, pgDumpPath: await fakePgDump(directory), connection, readServerMajor: async () => 17
    });
    const calls: string[] = [];
    const phases: OperationalBackupOperationState["phase"][] = [];
    const expectedDump = {
      identity: `${backupId}.dump`, sha256: createHash("sha256").update(payload).digest("hex"), byteLength: Buffer.byteLength(payload)
    };
    const preparedManifest = manifest(expectedDump);
    const manifestSha256 = createHash("sha256").update(canonicalOperationalBackupManifestBytes(preparedManifest)).digest("hex");

    await captureOperationalBackupSource(
      { backupId, createdAt: preparedManifest.createdAt, writeStopConfirmed: true },
      { async prepare(input) {
        calls.push("preflight");
        expect(input.postgresDump).toEqual(expectedDump);
        return { manifest: preparedManifest, manifestSha256, verifiedPmObjectCount: 0 };
      } },
      {
        createPostgresDump: async () => { calls.push("dump"); return dumpPort.createPostgresDump(); },
        async recordOperationState(state) {
          phases.push(state.phase);
          if (state.phase === "DUMP_PENDING") {
            await expect(access(dumpPort.dumpPath)).rejects.toBeDefined();
            calls.push("pending");
          }
        }
      }
    );

    expect(calls.slice(0, 2)).toEqual(["pending", "dump"]);
    expect(phases[0]).toBe("DUMP_PENDING");
  });

  it("rejects an invalid backup id before creating a dump", async () => {
    const directory = await privateDirectory();
    await expect(createOperationalBackupPostgresDumpPort({
      repositoryRoot, directory, backupId: "../unsafe", pgDumpPath: await fakePgDump(directory), connection, readServerMajor: async () => 17
    })).rejects.toBeInstanceOf(OperationalBackupPostgresDumpPortError);
  });

  it("rejects a connection string in the database-name field", async () => {
    const directory = await privateDirectory();
    await expect(createOperationalBackupPostgresDumpPort({
      repositoryRoot, directory, backupId, pgDumpPath: await fakePgDump(directory),
      connection: { ...connection, database: "postgresql://user:secret@host/db" }, readServerMajor: async () => 17
    })).rejects.toBeInstanceOf(OperationalBackupPostgresDumpPortError);
  });
});
