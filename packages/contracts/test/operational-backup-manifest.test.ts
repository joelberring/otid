import { describe, expect, it } from "vitest";
import {
  canonicalOperationalBackupOperationStateBytes,
  normalizeOperationalBackupOperationState,
  canonicalOperationalBackupManifestBytes,
  operationalBackupCaptureIntentSchema,
  operationalBackupManifestSchema,
  operationalBackupOperationStateSchema,
  operationalBackupRunIntentSchema
} from "../src";

const manifest = {
  formatVersion: 1 as const,
  backupId: "a0000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-19T10:00:00.000Z",
  writeStopConfirmed: true as const,
  postgresDump: { identity: "otid-prod-2026-09-19.dump", sha256: "a".repeat(64), byteLength: 42 },
  migrationIdentity: "0061_task_098_testeventor_entry_import_grant",
  pmObjects: [{
    storeId: "b0000000-0000-4000-8000-000000000002",
    key: "pm/b0000000-0000-4000-8000-000000000002/c0000000-0000-4000-8000-000000000003",
    versionId: "version-1",
    sha256: "b".repeat(64),
    byteLength: 7
  }]
};
const primaryPmObject = manifest.pmObjects[0]!;

describe("TASK099 operational backup manifest contract", () => {
  it("accepts the secret-free backup binding and canonicalizes it", () => {
    const parsed = operationalBackupManifestSchema.parse(manifest);
    expect(parsed).toEqual(manifest);
    expect(new TextDecoder().decode(canonicalOperationalBackupManifestBytes(parsed))).toContain("writeStopConfirmed");
  });

  it("rejects missing write stop, malformed hashes, duplicate objects and secrets", () => {
    const malformed = [
      { ...manifest, writeStopConfirmed: false },
      { ...manifest, postgresDump: { ...manifest.postgresDump, sha256: "A".repeat(64) } },
      { ...manifest, pmObjects: [manifest.pmObjects[0], manifest.pmObjects[0]] },
      { ...manifest, apiKey: "secret" }
    ];
    for (const value of malformed) expect(operationalBackupManifestSchema.safeParse(value).success).toBe(false);
  });

  it("accepts only secret-free, explicitly stopped capture intent before source reads", () => {
    const intent = {
      backupId: manifest.backupId,
      createdAt: manifest.createdAt,
      writeStopConfirmed: true,
      postgresDump: manifest.postgresDump
    };
    expect(operationalBackupCaptureIntentSchema.parse(intent)).toEqual(intent);
    expect(operationalBackupCaptureIntentSchema.safeParse({ ...intent, endpoint: "https://secret.example" }).success).toBe(false);
    expect(operationalBackupCaptureIntentSchema.safeParse({ ...intent, writeStopConfirmed: false }).success).toBe(false);
    expect(operationalBackupRunIntentSchema.parse({
      backupId: intent.backupId, createdAt: intent.createdAt, writeStopConfirmed: true
    })).toEqual({ backupId: intent.backupId, createdAt: intent.createdAt, writeStopConfirmed: true });
    expect(operationalBackupRunIntentSchema.safeParse(intent).success).toBe(false);
  });

  it("canonicalizes verified recovery state and permits a missing hash only before the dump", () => {
    const state = normalizeOperationalBackupOperationState({
      formatVersion: 1,
      backupId: manifest.backupId,
      phase: "TARGET_PREPARATION_PENDING",
      manifestSha256: "c".repeat(64),
      storeIds: ["d0000000-0000-4000-8000-000000000004", primaryPmObject.storeId]
    });
    expect(state.storeIds).toEqual([primaryPmObject.storeId, "d0000000-0000-4000-8000-000000000004"]);
    expect(new TextDecoder().decode(canonicalOperationalBackupOperationStateBytes(state))).toContain("TARGET_PREPARATION_PENDING");
    expect(operationalBackupOperationStateSchema.parse({
      formatVersion: 1, backupId: manifest.backupId, phase: "DUMP_PENDING", manifestSha256: null, storeIds: []
    })).toEqual({ formatVersion: 1, backupId: manifest.backupId, phase: "DUMP_PENDING", manifestSha256: null, storeIds: [] });
  });

  it("rejects ambiguous or secret-bearing recovery state", () => {
    const verified = {
      formatVersion: 1,
      backupId: manifest.backupId,
      phase: "REPLICATION_MAY_EXIST",
      manifestSha256: "c".repeat(64),
      storeIds: [primaryPmObject.storeId]
    };
    const invalid = [
      { ...verified, manifestSha256: null },
      { ...verified, storeIds: [primaryPmObject.storeId, primaryPmObject.storeId] },
      { ...verified, endpoint: "https://private.example" },
      { ...verified, targetArn: "arn:minio:replication::private" },
      { ...verified, phase: "DUMP_PENDING", manifestSha256: "c".repeat(64), storeIds: [] }
    ];
    for (const value of invalid) expect(operationalBackupOperationStateSchema.safeParse(value).success).toBe(false);
  });
});
