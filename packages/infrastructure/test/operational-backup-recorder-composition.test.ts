import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalOperationalBackupManifestBytes,
  type OperationalBackupManifest,
  type OperationalBackupOperationState
} from "@o-tid/contracts";
import { captureOperationalBackup } from "@o-tid/application";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOperationalBackupOperationStateRecorder,
  readOperationalBackupOperationState
} from "../src/operational-backup-operation-state";

const roots: string[] = [];
const backupId = "a0000000-0000-4000-8000-000000000001";
const firstStoreId = "b0000000-0000-4000-8000-000000000002";

async function privateDirectory(): Promise<string> {
  const root = await mkdtemp("/private/tmp/otid-operational-backup-composition-");
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

function manifest(): OperationalBackupManifest {
  return {
    formatVersion: 1,
    backupId,
    createdAt: "2026-09-22T12:00:00.000Z",
    writeStopConfirmed: true,
    postgresDump: { identity: "otid.sql", sha256: "a".repeat(64), byteLength: 7 },
    migrationIdentity: "migration-0001",
    pmObjects: [
      {
        storeId: firstStoreId,
        key: "pm/d0000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000005",
        versionId: "v-1",
        sha256: "b".repeat(64),
        byteLength: 3
      },
      {
        storeId: firstStoreId,
        key: "pm/f0000000-0000-4000-8000-000000000006/a0000000-0000-4000-8000-000000000007",
        versionId: "v-2",
        sha256: "c".repeat(64),
        byteLength: 4
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("operational backup recorder composition", () => {
  it("persists each source and managed cleanup phase exactly once before a safe receipt", async () => {
    const directory = await privateDirectory();
    const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
    const preparedManifest = manifest();
    const manifestSha256 = createHash("sha256")
      .update(canonicalOperationalBackupManifestBytes(preparedManifest))
      .digest("hex");
    const phases: OperationalBackupOperationState["phase"][] = [];
    const calls: string[] = [];

    const receipt = await captureOperationalBackup(
      { backupId, createdAt: preparedManifest.createdAt, writeStopConfirmed: true },
      {
        async prepare(input) {
          calls.push("source-preflight");
          expect(input).toEqual({
            backupId,
            createdAt: preparedManifest.createdAt,
            writeStopConfirmed: true,
            postgresDump: preparedManifest.postgresDump
          });
          return { manifest: preparedManifest, manifestSha256, verifiedPmObjectCount: preparedManifest.pmObjects.length };
        }
      },
      {
        async createPostgresDump() {
          calls.push("dump");
          return preparedManifest.postgresDump;
        },
        async prepareEmptyTarget(evidence) {
          calls.push("target");
          expect(evidence).toMatchObject({ manifest: preparedManifest, manifestSha256 });
        },
        async replicateAndCleanup(evidence) {
          calls.push("managed-replication");
          expect(evidence).toMatchObject({ manifestSha256 });
          for (const phase of ["REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"] as const) {
            const state: OperationalBackupOperationState = {
              formatVersion: 1, backupId, phase, manifestSha256, storeIds: [firstStoreId]
            };
            phases.push(phase);
            await recorder.record(state);
          }
        },
        async verifyCompletion(evidence) {
          calls.push("final-proof");
          expect(evidence).toMatchObject({ manifestSha256 });
          const persisted = await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId });
          expect(persisted?.phase).toBe("CLEANUP_VERIFIED");
          return { backupId, manifestSha256, verifiedPmObjectCount: preparedManifest.pmObjects.length };
        },
        async recordOperationState(state) {
          phases.push(state.phase);
          await recorder.record(state);
        }
      }
    );

    expect(calls).toEqual(["dump", "source-preflight", "target", "managed-replication", "final-proof"]);
    expect(phases).toEqual([
      "DUMP_PENDING", "TARGET_PREPARATION_PENDING", "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"
    ]);
    expect(receipt).toEqual({ backupId, manifestSha256, verifiedPmObjectCount: 2 });

    const persisted = await readOperationalBackupOperationState({ directory, repositoryRoot: process.cwd(), backupId });
    expect(persisted).toEqual({
      formatVersion: 1,
      backupId,
      phase: "CLEANUP_VERIFIED",
      manifestSha256,
      storeIds: [firstStoreId]
    });
    expect(await readFile(join(directory, `${backupId}.json`), "utf8")).not.toMatch(/credential|endpoint|targetArn|secret/i);
  });
});
