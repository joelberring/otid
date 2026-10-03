import { randomUUID, createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, lstat, open, realpath, stat, unlink } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  canonicalOperationalBackupManifestBytes,
  operationalBackupManifestSchema,
  type OperationalBackupManifest
} from "@o-tid/contracts";
import {
  verifyOperationalBackupCompletion,
  verifyOperationalBackupDumpFile,
  type OperationalBackupCompletionReceipt,
  type OperationalBackupCompletionInput
} from "./operational-backup-completion";
import { readOperationalBackupOperationState } from "./operational-backup-operation-state";
import { readOperationalBackupTargetBinding } from "./operational-backup-target-binding";

const MAX_RECORD_BYTES = 1024 * 1024;
type Identity = { dev: number; ino: number };

export type OperationalBackupCompletionRecord = {
  formatVersion: 1;
  backupId: string;
  manifestSha256: string;
  verifiedPmObjectCount: number;
  manifest: OperationalBackupManifest;
  targetId: string;
  targetBindingSha256: string;
};

export class OperationalBackupCompletionRecordError extends Error {
  constructor() {
    super("OPERATIONAL_BACKUP_COMPLETION_RECORD_INVALID");
    this.name = "OperationalBackupCompletionRecordError";
  }
}

function fail(): never { throw new OperationalBackupCompletionRecordError(); }
function uid(): number { const value = process.getuid?.(); return value === undefined ? fail() : value; }
function sameIdentity(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function within(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}
function recordName(backupId: string): string { return `${backupId}.completion.json`; }
function privateDirectory(details: Stats): Identity {
  if (!details.isDirectory() || details.uid !== uid() || (details.mode & 0o777) !== 0o700) return fail();
  return { dev: details.dev, ino: details.ino };
}
function privateFile(details: Stats): Identity {
  if (!details.isFile() || details.nlink !== 1 || details.uid !== uid() || (details.mode & 0o777) !== 0o600) return fail();
  return { dev: details.dev, ino: details.ino };
}
async function verifyDirectory(path: string, repositoryRoot: string): Promise<Identity> {
  if (resolve(path) !== path) return fail();
  const [canonical, root] = await Promise.all([realpath(path), realpath(repositoryRoot)]);
  if (canonical !== path || within(canonical, root)) return fail();
  return privateDirectory(await stat(path));
}
async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesWritten <= 0) return fail();
    offset += result.bytesWritten;
  }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
function canonicalBindingHash(binding: unknown): string {
  return createHash("sha256").update(JSON.stringify(binding), "utf8").digest("hex");
}
function canonicalRecordBytes(record: OperationalBackupCompletionRecord): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(record)}\n`);
}
function validateRecord(input: unknown, backupId: string): OperationalBackupCompletionRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  const manifest = operationalBackupManifestSchema.parse(value.manifest);
  const hash = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
  if (Object.keys(value).sort().join(",") !== ["backupId", "formatVersion", "manifest", "manifestSha256", "targetBindingSha256", "targetId", "verifiedPmObjectCount"].sort().join(",") ||
      value.formatVersion !== 1 || value.backupId !== backupId || manifest.backupId !== backupId ||
      value.manifestSha256 !== hash || !Number.isSafeInteger(value.verifiedPmObjectCount) ||
      value.verifiedPmObjectCount !== manifest.pmObjects.length || manifest.pmObjects.length < 1 ||
      typeof value.targetId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.targetId) ||
      typeof value.targetBindingSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.targetBindingSha256)) return fail();
  return { formatVersion: 1, backupId, manifestSha256: hash, verifiedPmObjectCount: manifest.pmObjects.length,
    manifest, targetId: value.targetId, targetBindingSha256: value.targetBindingSha256 };
}

export type WriteOperationalBackupCompletionRecordInput = Omit<OperationalBackupCompletionInput, "repositoryRoot"> & {
  repositoryRoot: string;
  captureReceipt: OperationalBackupCompletionReceipt;
  recordDirectory: string;
};

/** Persist a private write-once restore handoff after independently repeating final proof. */
export async function writeOperationalBackupCompletionRecord(
  input: WriteOperationalBackupCompletionRecordInput
): Promise<OperationalBackupCompletionReceipt> {
  try {
    const receipt = await verifyOperationalBackupCompletion(input);
    const suppliedReceipt = input.captureReceipt;
    if (!suppliedReceipt || Object.keys(suppliedReceipt).sort().join(",") !==
        ["backupId", "manifestSha256", "verifiedPmObjectCount"].sort().join(",") ||
        suppliedReceipt.backupId !== receipt.backupId || suppliedReceipt.manifestSha256 !== receipt.manifestSha256 ||
        suppliedReceipt.verifiedPmObjectCount !== receipt.verifiedPmObjectCount) return fail();
    const capture = input.sourceCapture as { manifest?: unknown };
    const manifest = operationalBackupManifestSchema.parse(capture.manifest);
    const dirIdentity = await verifyDirectory(input.recordDirectory, input.repositoryRoot);
    const binding = await readOperationalBackupTargetBinding({ directory: input.targetBindingDirectory,
      repositoryRoot: input.repositoryRoot, backupId: receipt.backupId });
    const storeIds = [...new Set(manifest.pmObjects.map(object => object.storeId))];
    if (binding.stores.length !== 1 || binding.stores[0]?.storeId !== storeIds[0]) return fail();
    const record: OperationalBackupCompletionRecord = {
      formatVersion: 1, backupId: receipt.backupId, manifestSha256: receipt.manifestSha256,
      verifiedPmObjectCount: receipt.verifiedPmObjectCount, manifest, targetId: binding.targetId,
      targetBindingSha256: canonicalBindingHash(binding)
    };
    const bytes = canonicalRecordBytes(record);
    if (bytes.byteLength > MAX_RECORD_BYTES) return fail();
    const target = join(input.recordDirectory, recordName(record.backupId));
    const temporary = join(input.recordDirectory, `.${record.backupId}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.chmod(0o600);
      await writeAll(handle, bytes);
      await handle.sync();
      privateFile(await handle.stat());
      await handle.close();
      handle = undefined;
      await link(temporary, target);
      await unlink(temporary);
      if (!sameIdentity(dirIdentity, privateDirectory(await stat(input.recordDirectory)))) return fail();
      await syncDirectory(input.recordDirectory);
      const readback = await readRecordFile(input.recordDirectory, record.backupId);
      if (!Buffer.from(canonicalRecordBytes(readback)).equals(Buffer.from(bytes))) return fail();
      return receipt;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  } catch {
    return fail();
  }
}

async function readRecordFile(directory: string, backupId: string): Promise<OperationalBackupCompletionRecord> {
  const path = join(directory, recordName(backupId));
  if (basename(path) !== recordName(backupId)) return fail();
  const named = privateFile(await lstat(path));
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = privateFile(await handle.stat());
    if (!sameIdentity(named, before) || (await handle.stat()).size > MAX_RECORD_BYTES) return fail();
    const bytes = await handle.readFile();
    const after = privateFile(await handle.stat());
    const namedAfter = privateFile(await lstat(path));
    if (bytes.byteLength > MAX_RECORD_BYTES || !sameIdentity(named, after) || !sameIdentity(named, namedAfter)) return fail();
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    const record = validateRecord(parsed, backupId);
    if (!Buffer.from(canonicalRecordBytes(record)).equals(Buffer.from(bytes))) return fail();
    return record;
  } catch { return fail(); }
  finally { if (handle) await handle.close().catch(() => undefined); }
}

export async function readOperationalBackupCompletionRecord(input: {
  backupId: string;
  recordDirectory: string;
  repositoryRoot: string;
  operationStateDirectory: string;
  targetBindingDirectory: string;
  dumpDirectory: string;
}): Promise<OperationalBackupCompletionRecord> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.backupId)) return fail();
    const directoryIdentity = await verifyDirectory(input.recordDirectory, input.repositoryRoot);
    const record = await readRecordFile(input.recordDirectory, input.backupId);
    if (!sameIdentity(directoryIdentity, privateDirectory(await stat(input.recordDirectory)))) return fail();
    const state = await readOperationalBackupOperationState({ directory: input.operationStateDirectory,
      repositoryRoot: input.repositoryRoot, backupId: input.backupId });
    const manifestStoreIds = [...new Set(record.manifest.pmObjects.map(object => object.storeId))];
    if (!state || state.phase !== "CLEANUP_VERIFIED" || state.manifestSha256 !== record.manifestSha256 ||
        manifestStoreIds.length !== 1 || state.storeIds.length !== 1 || state.storeIds[0] !== manifestStoreIds[0]) return fail();
    const binding = await readOperationalBackupTargetBinding({ directory: input.targetBindingDirectory,
      repositoryRoot: input.repositoryRoot, backupId: input.backupId });
    if (binding.backupId !== record.backupId || binding.manifestSha256 !== record.manifestSha256 ||
        binding.targetId !== record.targetId || canonicalBindingHash(binding) !== record.targetBindingSha256 ||
        binding.stores.length !== 1 || binding.stores[0]?.storeId !== state.storeIds[0]) return fail();
    const dumpPath = join(input.dumpDirectory, record.manifest.postgresDump.identity);
    if (resolve(input.dumpDirectory) !== input.dumpDirectory || resolve(dumpPath) !== dumpPath ||
        dirnameSafe(dumpPath) !== input.dumpDirectory) return fail();
    await verifyOperationalBackupDumpFile(dumpPath, input.repositoryRoot, record.manifest.postgresDump);
    return record;
  } catch { return fail(); }
}

function dirnameSafe(path: string): string {
  const lastSlash = path.lastIndexOf(sep);
  return lastSlash < 0 ? "." : path.slice(0, lastSlash) || sep;
}
