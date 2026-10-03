import { chmod, link, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationalBackupOperationState } from "@o-tid/contracts";
import {
  createOperationalBackupOperationStateRecorder,
  OperationalBackupOperationStateFileError,
  readOperationalBackupOperationState,
  recoverOperationalBackupOperationState
} from "../src/operational-backup-operation-state";

const roots: string[] = [];
const backupId = "a0000000-0000-4000-8000-000000000001";
const otherBackupId = "b0000000-0000-4000-8000-000000000002";
const storeId = "c0000000-0000-4000-8000-000000000003";

async function privateDirectory(): Promise<string> {
  const root = await mkdtemp("/private/tmp/otid-operational-backup-state-");
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

function state(phase: OperationalBackupOperationState["phase"], id = backupId): OperationalBackupOperationState {
  if (phase === "DUMP_PENDING") {
    return { formatVersion: 1, backupId: id, phase, manifestSha256: null, storeIds: [] };
  }
  return { formatVersion: 1, backupId: id, phase, manifestSha256: "d".repeat(64), storeIds: [storeId] };
}

async function expectGeneric(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toEqual(expect.objectContaining({
    name: "OperationalBackupOperationStateFileError",
    message: "OPERATIONAL_BACKUP_OPERATION_STATE_INVALID"
  } satisfies Partial<OperationalBackupOperationStateFileError>));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("private operational backup state", () => {
  it("writes monotone canonical state atomically in a new 0600 file and reads its final recovery phase", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    const phases: OperationalBackupOperationState["phase"][] = [
      "DUMP_PENDING", "TARGET_PREPARATION_PENDING", "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"
    ];
    for (const phase of phases) {
      await recorder.record(state(phase));
      expect((await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase).toBe(phase);
    }
    const file = join(directory, `${backupId}.json`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).not.toMatch(/credential|endpoint|targetArn|secret/i);
  });

  it("refuses another backup id or a non-monotone phase without changing the reserved state", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await recorder.record(state("DUMP_PENDING"));
    await expectGeneric(() => recorder.record(state("CLEANUP_REQUIRED")));
    await expectGeneric(() => recorder.record(state("TARGET_PREPARATION_PENDING", otherBackupId)));
    expect((await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase).toBe("DUMP_PENDING");
  });

  it("rejects an existing, symlinked or insecure private state path without exposing it", async () => {
    const directory = await privateDirectory();
    const existing = join(directory, `${backupId}.json`);
    await writeFile(existing, "keep", { mode: 0o600 });
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await expectGeneric(() => recorder.record(state("DUMP_PENDING")));
    expect(await readFile(existing, "utf8")).toBe("keep");

    const symlinked = join(directory, "linked");
    await symlink(directory, symlinked);
    const symlinkedRecorder = createOperationalBackupOperationStateRecorder({ directory: symlinked, repositoryRoot: process.cwd() });
    await expectGeneric(() => symlinkedRecorder.record(state("DUMP_PENDING", otherBackupId)));

    await chmod(directory, 0o755);
    const insecureRecorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await expectGeneric(() => insecureRecorder.record(state("DUMP_PENDING", otherBackupId)));
  });

  it("rejects a malformed, permissive or hardlinked persisted recovery state", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await recorder.record(state("DUMP_PENDING"));
    const file = join(directory, `${backupId}.json`);

    await chmod(file, 0o640);
    await expectGeneric(() => readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }));
    await chmod(file, 0o600);
    await link(file, join(directory, "second-link.json"));
    await expectGeneric(() => readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }));
  });

  it("recovers only cleanup phases under a private exclusive marker after the original worker stopped", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await recorder.record(state("DUMP_PENDING"));
    await recorder.record(state("TARGET_PREPARATION_PENDING"));
    await recorder.record(state("REPLICATION_MAY_EXIST"));
    let observedRequired = false;
    const result = await recoverOperationalBackupOperationState({
      directory, repositoryRoot: process.cwd(), backupId,
      manifestSha256: "d".repeat(64), storeIds: [storeId], originalWorkerStopped: true,
      async cleanup(persisted) {
        observedRequired = persisted.phase === "CLEANUP_REQUIRED" &&
          (await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase === "CLEANUP_REQUIRED";
        expect((await stat(join(directory, `${backupId}.recovery.lock`))).mode & 0o777).toBe(0o600);
      }
    });
    expect(observedRequired).toBe(true);
    expect(result.phase).toBe("CLEANUP_VERIFIED");
    expect((await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase)
      .toBe("CLEANUP_VERIFIED");
    await expect(lstat(join(directory, `${backupId}.recovery.lock`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves CLEANUP_REQUIRED after a failed cleanup and permits an exact retry", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await recorder.record(state("DUMP_PENDING"));
    await recorder.record(state("TARGET_PREPARATION_PENDING"));
    await recorder.record(state("REPLICATION_MAY_EXIST"));
    const input = {
      directory, repositoryRoot: process.cwd(), backupId,
      manifestSha256: "d".repeat(64), storeIds: [storeId], originalWorkerStopped: true as const
    };
    await expectGeneric(() => recoverOperationalBackupOperationState({ ...input,
      async cleanup() { throw new Error("private endpoint detail must not escape"); }
    }));
    expect((await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase)
      .toBe("CLEANUP_REQUIRED");
    await expect(lstat(join(directory, `${backupId}.recovery.lock`))).rejects.toMatchObject({ code: "ENOENT" });
    await recoverOperationalBackupOperationState({ ...input, async cleanup() { /* No rule remains. */ } });
    expect((await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase)
      .toBe("CLEANUP_VERIFIED");
  });

  it("rejects mismatched proof or another recovery marker without invoking cleanup", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    await recorder.record(state("DUMP_PENDING"));
    await recorder.record(state("TARGET_PREPARATION_PENDING"));
    await recorder.record(state("REPLICATION_MAY_EXIST"));
    let called = false;
    const input = {
      directory, repositoryRoot: process.cwd(), backupId, storeIds: [storeId],
      originalWorkerStopped: true as const,
      async cleanup() { called = true; }
    };
    await expectGeneric(() => recoverOperationalBackupOperationState({ ...input, manifestSha256: "e".repeat(64) }));
    const marker = join(directory, `${backupId}.recovery.lock`);
    await writeFile(marker, "keep", { mode: 0o600, flag: "wx" });
    await expectGeneric(() => recoverOperationalBackupOperationState({ ...input, manifestSha256: "d".repeat(64) }));
    expect(called).toBe(false);
    expect(await readFile(marker, "utf8")).toBe("keep");
    expect((await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId }))?.phase)
      .toBe("REPLICATION_MAY_EXIST");
  });
});
