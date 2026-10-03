import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOperationalBackupManifest } from "../src/operational-backup-manifest";
import {
  OperationalBackupTargetReadinessError,
  verifyOperationalBackupTargetReadiness
} from "../src/operational-backup-target-readiness";

const mock = vi.hoisted(() => ({
  methods: {} as Record<string, (...args: unknown[]) => unknown>,
  calls: [] as string[]
}));

vi.mock("minio", () => ({
  Client: class {
    constructor() { Object.assign(this, mock.methods); }
  }
}));

const backupId = "10000000-0000-4000-8000-000000000001";
const storeId = "10000000-0000-4000-8000-000000000002";
const object = {
  storeId,
  key: "pm/10000000-0000-4000-8000-000000000004/20000000-0000-4000-8000-000000000001",
  versionId: "source-version-1",
  sha256: createHash("sha256").update("pm").digest("hex"),
  byteLength: 2
};

function stream(items: unknown[]): AsyncIterable<unknown> {
  return { async *[Symbol.asyncIterator]() { yield* items; } };
}

function setMethods(overrides: Record<string, (...args: unknown[]) => unknown> = {}): void {
  mock.calls.length = 0;
  mock.methods = {
    async listBuckets() { mock.calls.push("listBuckets"); return [{ name: "otid-pm-source" }]; },
    async getBucketVersioning() { mock.calls.push("getBucketVersioning"); return { Status: "Enabled" }; },
    async getBucketPolicy() { mock.calls.push("getBucketPolicy"); throw Object.assign(new Error("sensitive"), { code: "NoSuchBucketPolicy" }); },
    async getBucketReplication() { mock.calls.push("getBucketReplication"); throw Object.assign(new Error("sensitive"), { code: "ReplicationConfigurationNotFoundError" }); },
    listObjectsV2() { mock.calls.push("listObjectsV2"); return stream([]); },
    listObjects() { mock.calls.push("listObjects"); return stream([]); },
    listIncompleteUploads() { mock.calls.push("listIncompleteUploads"); return stream([]); },
    ...overrides
  };
}

function validInput() {
  const built = buildOperationalBackupManifest({
    backupId,
    createdAt: "2026-09-23T09:00:00+02:00",
    writeStopConfirmed: true,
    postgresDump: { identity: "synthetic.dump", sha256: "a".repeat(64), byteLength: 100 },
    migrationIdentity: "synthetic-migration",
    pmObjects: [object]
  });
  return {
    sourceCapture: {
      kind: "SOURCE_CAPTURE_EVIDENCE" as const,
      manifest: built.manifest,
      manifestSha256: built.sha256,
      verifiedPmObjectCount: 1
    },
    operationState: {
      formatVersion: 1,
      backupId,
      phase: "TARGET_PREPARATION_PENDING",
      manifestSha256: built.sha256,
      storeIds: [storeId]
    },
    backupId,
    targetFreshnessAttestation: {
      backupId,
      targetId: "30000000-0000-4000-8000-000000000001",
      freshlyProvisioned: true,
      exclusive: true
    },
    target: {
      endpoint: "https://target.example.test",
      region: "us-east-1",
      accessKey: "synthetic-access",
      secretKey: "synthetic-secret",
      mode: "production" as const
    },
    stores: [{
      storeId,
      sourceEndpoint: "https://source.example.test",
      sourceBucket: "otid-pm-source",
      targetBucket: "otid-pm-source"
    }]
  };
}

async function expectRejected(input: unknown): Promise<void> {
  await expect(verifyOperationalBackupTargetReadiness(input)).rejects.toEqual(expect.objectContaining({
    name: "OperationalBackupTargetReadinessError",
    message: "OPERATIONAL_BACKUP_TARGET_NOT_READY"
  } satisfies Partial<OperationalBackupTargetReadinessError>));
}

beforeEach(() => setMethods());

describe("private operational backup target readiness", () => {
  it("returns only backup-bound readiness evidence after every read-only check", async () => {
    const result = await verifyOperationalBackupTargetReadiness(validInput());
    expect(result).toEqual({
      kind: "TARGET_READY_EVIDENCE",
      backupId,
      manifestSha256: validInput().sourceCapture.manifestSha256,
      targetId: "30000000-0000-4000-8000-000000000001",
      storeIds: [storeId]
    });
    expect(mock.calls).toEqual([
      "listBuckets", "getBucketVersioning", "getBucketPolicy", "getBucketReplication",
      "listObjectsV2", "listObjects", "listIncompleteUploads"
    ]);
    expect(mock.calls.some(call => /makeBucket|setBucket|remove|replicate|putObject/i.test(call))).toBe(false);
  });

  it("rejects invalid source evidence, state, freshness and mapping before MinIO I/O", async () => {
    const input = validInput();
    await expectRejected({ ...input, sourceCapture: { ...input.sourceCapture, kind: "BACKUP_RECEIPT" } });
    await expectRejected({ ...input, operationState: { ...input.operationState, phase: "REPLICATION_MAY_EXIST" } });
    await expectRejected({ ...input, targetFreshnessAttestation: { ...input.targetFreshnessAttestation, backupId: "40000000-0000-4000-8000-000000000001" } });
    await expectRejected({ ...input, stores: [{ ...input.stores[0], targetBucket: "other-bucket" }] });
    await expectRejected({ ...input, stores: [] });
    await expectRejected({ ...input, stores: [input.stores[0], input.stores[0]] });
    await expectRejected({ ...input, stores: [input.stores[0], { ...input.stores[0], storeId: "50000000-0000-4000-8000-000000000001" }] });
    await expectRejected({ ...input, stores: [{ ...input.stores[0], sourceEndpoint: input.target.endpoint }] });
    expect(mock.calls).toEqual([]);
  });

  it("rejects extra buckets, non-enabled versioning, policy, replication, listing errors, and hidden objects", async () => {
    const input = validInput();
    setMethods({ async listBuckets() { return [{ name: "otid-pm-source" }, { name: "unexpected" }]; } });
    await expectRejected(input);
    setMethods({ async getBucketVersioning() { return { Status: "Suspended" }; } });
    await expectRejected(input);
    setMethods({ async getBucketPolicy() { return "{}"; } });
    await expectRejected(input);
    setMethods({ async getBucketReplication() { return { role: "replica" }; } });
    await expectRejected(input);
    setMethods({ listObjectsV2() { return stream([{ name: "current.pdf" }]); } });
    await expectRejected(input);
    setMethods({ listObjects() { return stream([{ name: "older.pdf", versionId: "old-version", isDeleteMarker: false }]); } });
    await expectRejected(input);
    setMethods({ listObjects() { return stream([{ name: "deleted.pdf", versionId: "delete-marker", isDeleteMarker: true }]); } });
    await expectRejected(input);
    setMethods({ listIncompleteUploads() { return stream([{ key: "pending.pdf", uploadId: "upload-1", size: 0 }]); } });
    await expectRejected(input);
  });

  it("treats ambiguous SDK errors as failure and never leaks their details", async () => {
    setMethods({ async getBucketPolicy() { throw Object.assign(new Error("https://user:secret@target/"), { code: "AccessDenied" }); } });
    await expect(verifyOperationalBackupTargetReadiness(validInput())).rejects.toEqual(expect.objectContaining({
      message: "OPERATIONAL_BACKUP_TARGET_NOT_READY"
    }));
  });
});
