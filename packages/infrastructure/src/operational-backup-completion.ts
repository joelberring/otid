import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, relative, resolve, sep } from "node:path";
import {
  canonicalOperationalBackupManifestBytes,
  operationalBackupManifestSchema
} from "@o-tid/contracts";
import { measureOperationalBackupPostgresDump } from "./operational-backup-dump";
import { readOperationalBackupPmObject, type PmObjectReader } from "./operational-backup-object";
import { assertOperationalBackupSourceHasNoReplicationRules, type OperationalBackupRuleReader } from "./operational-backup-replication";
import { readOperationalBackupOperationState } from "./operational-backup-operation-state";
import { readOperationalBackupTargetBinding } from "./operational-backup-target-binding";

type Identity = { dev: number; ino: number };

export type OperationalBackupCompletionReceipt = {
  backupId: string;
  manifestSha256: string;
  verifiedPmObjectCount: number;
};

export type OperationalBackupCompletionInput = {
  sourceCapture: unknown;
  operationStateDirectory: string;
  repositoryRoot: string;
  targetBindingDirectory: string;
  store: unknown;
  sourceCredentials: { accessKey: string; secretKey: string };
  targetPmReader: PmObjectReader;
  dumpPath: string;
  /** Deterministic read seam for focused tests. Do not supply in operations. */
  readRules?: OperationalBackupRuleReader;
};

/** Deliberately reveals no private paths, SDK details, credentials, or file contents. */
export class OperationalBackupCompletionError extends Error {
  constructor() {
    super("OPERATIONAL_BACKUP_COMPLETION_FAILED");
    this.name = "OperationalBackupCompletionError";
  }
}

function fail(): never { throw new OperationalBackupCompletionError(); }
function uid(): number { const value = process.getuid?.(); return value === undefined ? fail() : value; }
function sameIdentity(left: Identity, right: Identity): boolean { return left.dev === right.dev && left.ino === right.ino; }
function within(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}
function privateFileIdentity(details: Stats): Identity {
  if (!details.isFile() || details.nlink !== 1 || details.uid !== uid() || (details.mode & 0o777) !== 0o600) return fail();
  return { dev: details.dev, ino: details.ino };
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

export async function verifyOperationalBackupDumpFile(path: string, repositoryRoot: string, expected: {
  identity: string; sha256: string; byteLength: number;
}): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (resolve(path) !== path || basename(path) !== expected.identity) return fail();
    const [root, parent, parentInfo, namedBefore] = await Promise.all([
      realpath(repositoryRoot), realpath(dirname(path)), stat(dirname(path)), lstat(path)
    ]);
    if (root !== repositoryRoot || parent !== dirname(path) || within(parent, root) || !parentInfo.isDirectory() ||
        parentInfo.uid !== uid() || (parentInfo.mode & 0o777) !== 0o700) return fail();
    const identity = privateFileIdentity(namedBefore);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedBefore = await handle.stat();
    if (!sameIdentity(identity, privateFileIdentity(openedBefore)) || openedBefore.size !== expected.byteLength) return fail();
    const measured = await measureOperationalBackupPostgresDump({ identity: expected.identity, chunks: fileChunks(handle) });
    const [openedAfter, namedAfter, parentAfter] = await Promise.all([handle.stat(), lstat(path), stat(dirname(path))]);
    if (!sameIdentity(identity, privateFileIdentity(openedAfter)) || !sameIdentity(identity, privateFileIdentity(namedAfter)) ||
        openedAfter.size !== measured.byteLength || measured.sha256 !== expected.sha256 ||
        measured.byteLength !== expected.byteLength || !sameIdentity({ dev: parentInfo.dev, ino: parentInfo.ino },
          { dev: parentAfter.dev, ino: parentAfter.ino })) return fail();
  } catch {
    return fail();
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

/** Reproves cleanup, exact target versions, and private dump bytes before issuing the safe receipt. */
export async function verifyOperationalBackupCompletion(
  input: OperationalBackupCompletionInput
): Promise<OperationalBackupCompletionReceipt> {
  try {
    const capture = input && typeof input === "object" && "sourceCapture" in input
      ? input.sourceCapture as Record<string, unknown> : undefined;
    if (!capture || capture.kind !== "SOURCE_CAPTURE_EVIDENCE") return fail();
    const manifest = operationalBackupManifestSchema.parse(capture.manifest);
    const hash = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
    const objectStoreIds = [...new Set(manifest.pmObjects.map(object => object.storeId))];
    if (capture.manifestSha256 !== hash ||
        capture.verifiedPmObjectCount !== manifest.pmObjects.length || objectStoreIds.length !== 1 ||
        manifest.pmObjects.length < 1 || typeof input.targetPmReader?.read !== "function") return fail();

    const state = await readOperationalBackupOperationState({
      directory: input.operationStateDirectory, repositoryRoot: input.repositoryRoot, backupId: manifest.backupId
    });
    if (!state || state.phase !== "CLEANUP_VERIFIED" || state.backupId !== manifest.backupId ||
        state.manifestSha256 !== hash || state.storeIds.length !== 1 || state.storeIds[0] !== objectStoreIds[0]) return fail();

    const binding = await readOperationalBackupTargetBinding({
      directory: input.targetBindingDirectory, repositoryRoot: input.repositoryRoot, backupId: manifest.backupId
    });
    const parsedStore = input.store as { storeId?: unknown; sourceEndpoint?: unknown; sourceBucket?: unknown; targetBucket?: unknown };
    if (binding.backupId !== manifest.backupId || binding.manifestSha256 !== hash || binding.stores.length !== 1 ||
        binding.stores[0]?.storeId !== objectStoreIds[0] || !parsedStore || binding.stores[0]?.storeId !== parsedStore.storeId ||
        binding.stores[0]?.sourceEndpoint !== parsedStore.sourceEndpoint || binding.stores[0]?.sourceBucket !== parsedStore.sourceBucket ||
        binding.stores[0]?.targetBucket !== parsedStore.targetBucket || parsedStore.sourceBucket !== parsedStore.targetBucket) return fail();

    await assertOperationalBackupSourceHasNoReplicationRules({ store: input.store, sourceCredentials: input.sourceCredentials,
      ...(input.readRules ? { readRules: input.readRules } : {}) });
    for (const object of manifest.pmObjects) await readOperationalBackupPmObject(input.targetPmReader, object);
    await verifyOperationalBackupDumpFile(input.dumpPath, input.repositoryRoot, manifest.postgresDump);
    return { backupId: manifest.backupId, manifestSha256: hash, verifiedPmObjectCount: manifest.pmObjects.length };
  } catch {
    return fail();
  }
}
