import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildOperationalBackupManifest } from "../src/operational-backup-manifest";
import {
  OperationalBackupReplicationError,
  cleanupOperationalBackupStore,
  replicateOperationalBackupStore,
  type OperationalBackupReplicationInput
} from "../src/operational-backup-replication";

const backupId = "10000000-0000-4000-8000-000000000001";
const storeId = "10000000-0000-4000-8000-000000000002";
const targetId = "30000000-0000-4000-8000-000000000001";
const bytes = Buffer.from("synthetic private PM version");
const hash = createHash("sha256").update(bytes).digest("hex");
const targetArn = "arn:minio:replication::target:otid-pm";
const sdk = vi.hoisted(() => ({ getReplication: vi.fn() }));

vi.mock("minio", () => ({
  Client: class {
    getBucketReplication(bucketName: string): Promise<unknown> { return Promise.resolve(sdk.getReplication(bucketName) as unknown); }
  }
}));

function ruleRecord(id = backupId) {
  return {
    ID: id,
    Destination: { Bucket: targetArn },
    ExistingObjectReplication: { Status: "Enabled" }
  };
}

function validInput(overrides: Partial<OperationalBackupReplicationInput> = {}) {
  const object = {
    storeId,
    key: "pm/10000000-0000-4000-8000-000000000004/20000000-0000-4000-8000-000000000001",
    versionId: "source-version-1",
    sha256: hash,
    byteLength: bytes.length
  };
  const built = buildOperationalBackupManifest({
    backupId,
    createdAt: "2026-09-23T09:00:00+02:00",
    writeStopConfirmed: true,
    postgresDump: { identity: "synthetic.dump", sha256: "a".repeat(64), byteLength: 100 },
    migrationIdentity: "synthetic-migration",
    pmObjects: [object]
  });
  const store = { storeId, sourceEndpoint: "https://source.example.test", sourceBucket: "otid-pm", targetBucket: "otid-pm" };
  const target = { endpoint: "https://target.example.test", region: "us-east-1", mode: "production" as const,
    accessKey: "synthetic-target-access", secretKey: "synthetic-target-secret" };
  const state = { formatVersion: 1, backupId, phase: "TARGET_PREPARATION_PENDING", manifestSha256: built.sha256, storeIds: [storeId] };
  return {
    backupId,
    sourceCapture: { kind: "SOURCE_CAPTURE_EVIDENCE" as const, manifest: built.manifest,
      manifestSha256: built.sha256, verifiedPmObjectCount: 1 },
    operationState: state,
    readinessEvidence: { kind: "TARGET_READY_EVIDENCE" as const, backupId, manifestSha256: built.sha256, targetId, storeIds: [storeId] },
    targetBinding: { formatVersion: 2, backupId, manifestSha256: built.sha256, targetId,
      targetEndpoint: target.endpoint, targetMode: target.mode, stores: [store] },
    store,
    sourceCredentials: { accessKey: "synthetic-source-access", secretKey: "synthetic-source-secret" },
    target,
    targetPmReader: { async read() { return Buffer.from(bytes); } },
    mcBinary: "/private/path/pinned-mc",
    recordOperationState: async () => undefined,
    timeoutMs: 500,
    pollIntervalMs: 10,
    ...overrides
  } satisfies OperationalBackupReplicationInput;
}

function successfulRunner(initiallyExists = false) {
  let exists = initiallyExists;
  const calls: string[][] = [];
  const runMc: NonNullable<OperationalBackupReplicationInput["runMc"]> = async (_binary, args) => {
    calls.push(args);
    if (args[1] === "add") { exists = true; return { code: 0, signal: null, stdout: "" }; }
    if (args[1] === "resync") return { code: 0, signal: null, stdout: "" };
    if (args[1] === "remove") { exists = false; return { code: 0, signal: null, stdout: "" }; }
    return { code: 2, signal: null, stdout: "" };
  };
  const readRules: NonNullable<OperationalBackupReplicationInput["readRules"]> = async () => exists ? [ruleRecord()] : [];
  return { calls, runMc, readRules };
}

async function expectGeneric(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toEqual(expect.objectContaining({
    name: "OperationalBackupReplicationError",
    message: "OPERATIONAL_BACKUP_REPLICATION_FAILED"
  } satisfies Partial<OperationalBackupReplicationError>));
}

describe("private operational backup replication adapter", () => {
  it("uses deterministic ownership, resyncs the verified ARN, reads exact PM bytes, then confirms zero rules", async () => {
    const fixture = successfulRunner();
    const states: unknown[] = [];
    await replicateOperationalBackupStore(validInput({
      runMc: fixture.runMc,
      readRules: fixture.readRules,
      recordOperationState: async state => { states.push(state); }
    }));
    expect(fixture.calls).toEqual([
      ["replicate", "add", "--id", backupId, "--remote-bucket", "target/otid-pm", "--replicate", "existing-objects", "source/otid-pm"],
      ["replicate", "resync", "start", "--remote-bucket", targetArn, "source/otid-pm"],
      ["replicate", "remove", "--all", "--force", "source/otid-pm"]
    ]);
    expect(states.map(state => (state as { phase: string }).phase)).toEqual([
      "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"
    ]);
    expect(JSON.stringify(states)).not.toMatch(/endpoint|bucket|arn|credential|secret/i);
  });

  it("performs no add when preflight finds any existing source rule", async () => {
    const fixture = successfulRunner();
    let added = false;
    const runMc: NonNullable<OperationalBackupReplicationInput["runMc"]> = async (binary, args, env, timeout) => {
      if (args[1] === "add") added = true;
      return fixture.runMc(binary, args, env, timeout);
    };
    await expectGeneric(() => replicateOperationalBackupStore(validInput({ runMc,
      readRules: async () => [ruleRecord("other-owned-rule")] })));
    expect(added).toBe(false);
  });

  it("reads the MinIO SDK replication response shape and rejects a preexisting rule", async () => {
    const fixture = successfulRunner();
    sdk.getReplication.mockResolvedValue({ ReplicationConfiguration: { role: "synthetic", rules: [ruleRecord("foreign-rule")] } });
    await expectGeneric(() => replicateOperationalBackupStore(validInput({ runMc: fixture.runMc })));
    expect(sdk.getReplication).toHaveBeenCalledWith("otid-pm");
    expect(fixture.calls).toEqual([]);
  });

  it("cleans its rule after an ambiguous add failure and records the verified empty result", async () => {
    const fixture = successfulRunner();
    let addAttempted = false;
    const runMc: NonNullable<OperationalBackupReplicationInput["runMc"]> = async (binary, args, env, timeout) => {
      if (args[1] === "add") {
        addAttempted = true;
        await fixture.runMc(binary, args, env, timeout);
        throw new Error("credential-bearing arbitrary process error");
      }
      return fixture.runMc(binary, args, env, timeout);
    };
    const states: unknown[] = [];
    await expectGeneric(() => replicateOperationalBackupStore(validInput({
      runMc,
      readRules: fixture.readRules,
      recordOperationState: async state => { states.push(state); }
    })));
    expect(addAttempted).toBe(true);
    expect(states.map(state => (state as { phase: string }).phase)).toEqual([
      "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"
    ]);
  });

  it("does not remove an unknown rule after ownership verification fails", async () => {
    const calls: string[][] = [];
    let listings = 0;
    const runMc: NonNullable<OperationalBackupReplicationInput["runMc"]> = async (_binary, args) => {
      calls.push(args);
      return { code: 0, signal: null, stdout: "" };
    };
    const readRules: NonNullable<OperationalBackupReplicationInput["readRules"]> = async () => {
      listings += 1;
      return listings === 1 ? [] : [ruleRecord("someone-else")];
    };
    const states: unknown[] = [];
    await expectGeneric(() => replicateOperationalBackupStore(validInput({
      runMc,
      readRules,
      recordOperationState: async state => { states.push(state); }
    })));
    expect(calls.some(args => args[1] === "remove")).toBe(false);
    expect(states.map(state => (state as { phase: string }).phase)).toEqual([
      "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED"
    ]);
  });

  it("rejects source proof or store mismatch before any command", async () => {
    const fixture = successfulRunner();
    await expectGeneric(() => replicateOperationalBackupStore(validInput({
      operationState: { formatVersion: 1, backupId, phase: "CLEANUP_REQUIRED",
        manifestSha256: "a".repeat(64), storeIds: [storeId] }, runMc: fixture.runMc
    })));
    expect(fixture.calls).toEqual([]);
  });

  it("recovery cleanup removes only its deterministic rule and confirms a new empty listing", async () => {
    const input = validInput();
    const fixture = successfulRunner(true);
    const states: unknown[] = [];
    await cleanupOperationalBackupStore({
      backupId,
      operationState: { formatVersion: 1, backupId, phase: "CLEANUP_REQUIRED",
        manifestSha256: (input.sourceCapture as { manifestSha256: string }).manifestSha256, storeIds: [storeId] },
      targetBinding: input.targetBinding,
      store: input.store,
      sourceCredentials: input.sourceCredentials,
      mcBinary: input.mcBinary,
      runMc: fixture.runMc,
      readRules: fixture.readRules
    });
    expect(fixture.calls).toEqual([["replicate", "remove", "--all", "--force", "source/otid-pm"]]);
    expect(states).toEqual([]);
  });

  it("recovery cleanup rejects a foreign rule and never issues remove", async () => {
    const input = validInput();
    const calls: string[][] = [];
    const runMc: NonNullable<OperationalBackupReplicationInput["runMc"]> = async (_binary, args) => {
      calls.push(args);
      return { code: 0, signal: null, stdout: "" };
    };
    await expectGeneric(() => cleanupOperationalBackupStore({
      backupId,
      operationState: { formatVersion: 1, backupId, phase: "CLEANUP_REQUIRED",
        manifestSha256: (input.sourceCapture as { manifestSha256: string }).manifestSha256, storeIds: [storeId] },
      targetBinding: input.targetBinding,
      store: input.store,
      sourceCredentials: input.sourceCredentials,
      mcBinary: input.mcBinary,
      runMc,
      readRules: async () => [ruleRecord("foreign-rule")]
    }));
    expect(calls.some(args => args[1] === "remove")).toBe(false);
  });

  it("never uses remove-all when an additional unowned rule is present", async () => {
    const calls: string[][] = [];
    let listCount = 0;
    const runMc: NonNullable<OperationalBackupReplicationInput["runMc"]> = async (_binary, args) => {
      calls.push(args);
      return { code: 0, signal: null, stdout: "" };
    };
    const states: unknown[] = [];
    await expectGeneric(() => replicateOperationalBackupStore(validInput({
      runMc,
      readRules: async () => {
        listCount += 1;
        return listCount === 1 ? [] : [ruleRecord(), ruleRecord("another-private-rule")];
      },
      recordOperationState: async state => { states.push(state); }
    })));
    expect(calls.some(args => args[1] === "remove")).toBe(false);
    expect(states.map(state => (state as { phase: string }).phase)).toEqual([
      "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED"
    ]);
  });
});
