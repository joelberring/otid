import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  canonicalOperationalBackupOperationStateBytes,
  normalizeOperationalBackupOperationState,
  type OperationalBackupOperationState
} from "@o-tid/contracts";

const MAX_STATE_BYTES = 256 * 1024;

/** Deliberately omits paths, contents and filesystem diagnostics. */
export class OperationalBackupOperationStateFileError extends Error {
  public constructor() {
    super("OPERATIONAL_BACKUP_OPERATION_STATE_INVALID");
    this.name = "OperationalBackupOperationStateFileError";
  }
}

type Identity = { dev: number; ino: number };
type VerifiedDirectory = { path: string; identity: Identity };

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new OperationalBackupOperationStateFileError();
  return uid;
}

async function verifyDirectory(directory: string, repositoryRoot: string, expected?: Identity): Promise<VerifiedDirectory> {
  if (!directory.startsWith(sep)) throw new OperationalBackupOperationStateFileError();
  const resolved = resolve(directory);
  if (resolved !== directory) throw new OperationalBackupOperationStateFileError();
  const [actual, root] = await Promise.all([realpath(directory), realpath(repositoryRoot)]);
  if (actual !== directory || isWithin(actual, root)) throw new OperationalBackupOperationStateFileError();
  const details = await stat(actual);
  const identity = { dev: details.dev, ino: details.ino };
  if (!details.isDirectory() || details.uid !== currentUid() || (details.mode & 0o777) !== 0o700
    || (expected !== undefined && !sameIdentity(identity, expected))) {
    throw new OperationalBackupOperationStateFileError();
  }
  return { path: actual, identity };
}

function stateFilePath(directory: VerifiedDirectory, backupId: string): string {
  const path = join(directory.path, `${backupId}.json`);
  if (!isWithin(path, directory.path)) throw new OperationalBackupOperationStateFileError();
  return path;
}

function assertPrivateFile(details: Stats): Identity {
  if (!details.isFile() || details.nlink !== 1 || details.uid !== currentUid() || (details.mode & 0o777) !== 0o600) {
    throw new OperationalBackupOperationStateFileError();
  }
  return { dev: details.dev, ino: details.ino };
}

async function namedFileIdentity(path: string): Promise<Identity | undefined> {
  try {
    return assertPrivateFile(await lstat(path));
  } catch (error) {
    if (error instanceof OperationalBackupOperationStateFileError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new OperationalBackupOperationStateFileError();
  }
}

function stateBackupId(input: string): string {
  return normalizeOperationalBackupOperationState({
    formatVersion: 1,
    backupId: input,
    phase: "DUMP_PENDING",
    manifestSha256: null,
    storeIds: []
  }).backupId;
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesWritten <= 0) throw new OperationalBackupOperationStateFileError();
    offset += result.bytesWritten;
  }
}

async function syncDirectory(directory: VerifiedDirectory): Promise<void> {
  const handle = await open(directory.path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readStateFile(directory: VerifiedDirectory, backupId: string): Promise<OperationalBackupOperationState | undefined> {
  const path = stateFilePath(directory, backupId);
  const named = await namedFileIdentity(path);
  if (!named) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let result: OperationalBackupOperationState | undefined;
  let failed = false;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = handle;
    const details = await opened.stat();
    if (!sameIdentity(named, assertPrivateFile(details)) || details.size > MAX_STATE_BYTES) {
      throw new OperationalBackupOperationStateFileError();
    }
    const bytes = await opened.readFile();
    if (bytes.byteLength > MAX_STATE_BYTES) throw new OperationalBackupOperationStateFileError();
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const state = normalizeOperationalBackupOperationState(JSON.parse(decoded) as unknown);
    if (state.backupId !== backupId) throw new OperationalBackupOperationStateFileError();
    result = state;
  } catch {
    failed = true;
  }
  if (handle) {
    try { await handle.close(); } catch { failed = true; }
  }
  if (failed || !result) throw new OperationalBackupOperationStateFileError();
  return result;
}

function nextPhaseIsValid(previous: OperationalBackupOperationState["phase"], next: OperationalBackupOperationState["phase"]): boolean {
  return (previous === "DUMP_PENDING" && next === "TARGET_PREPARATION_PENDING")
    || (previous === "TARGET_PREPARATION_PENDING" && next === "REPLICATION_MAY_EXIST")
    || (previous === "REPLICATION_MAY_EXIST" && next === "CLEANUP_REQUIRED")
    || (previous === "CLEANUP_REQUIRED" && next === "CLEANUP_VERIFIED");
}

async function replaceStateFile(
  directory: VerifiedDirectory,
  backupId: string,
  state: OperationalBackupOperationState,
  mustNotExist: boolean
): Promise<void> {
  const target = stateFilePath(directory, backupId);
  const existing = await namedFileIdentity(target);
  if ((mustNotExist && existing !== undefined) || (!mustNotExist && existing === undefined)) {
    throw new OperationalBackupOperationStateFileError();
  }
  const temporary = join(directory.path, `.${backupId}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.chmod(0o600);
    await writeAll(handle, canonicalOperationalBackupOperationStateBytes(state));
    await handle.sync();
    assertPrivateFile(await handle.stat());
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(directory);
    const persisted = await readStateFile(directory, backupId);
    if (!persisted || JSON.stringify(persisted) !== JSON.stringify(state)) throw new OperationalBackupOperationStateFileError();
  } catch {
    throw new OperationalBackupOperationStateFileError();
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* Generic primary failure is retained. */ }
    }
    try { await unlink(temporary); } catch { /* The rename or a failed cleanup may already have removed it. */ }
  }
}

/**
 * Creates a recorder for exactly one backup process. A later recovery process
 * may read its immutable latest state, but does not gain write authority here.
 */
export function createOperationalBackupOperationStateRecorder(input: {
  directory: string;
  repositoryRoot: string;
}): { record(state: OperationalBackupOperationState): Promise<void> } {
  let directory: VerifiedDirectory | undefined;
  let current: OperationalBackupOperationState | undefined;

  return {
    async record(inputState) {
      try {
        const state = normalizeOperationalBackupOperationState(inputState);
        directory ??= await verifyDirectory(input.directory, input.repositoryRoot);
        await verifyDirectory(input.directory, input.repositoryRoot, directory.identity);
        if (!current) {
          if (state.phase !== "DUMP_PENDING") throw new OperationalBackupOperationStateFileError();
          await replaceStateFile(directory, state.backupId, state, true);
          current = state;
          return;
        }
        if (state.backupId !== current.backupId || !nextPhaseIsValid(current.phase, state.phase)) {
          throw new OperationalBackupOperationStateFileError();
        }
        await replaceStateFile(directory, state.backupId, state, false);
        current = state;
      } catch {
        throw new OperationalBackupOperationStateFileError();
      }
    }
  };
}

/** Reads one private recovery state without revealing filesystem diagnostics. */
export async function readOperationalBackupOperationState(input: {
  directory: string;
  repositoryRoot: string;
  backupId: string;
}): Promise<OperationalBackupOperationState | undefined> {
  try {
    const backupId = stateBackupId(input.backupId);
    const directory = await verifyDirectory(input.directory, input.repositoryRoot);
    return await readStateFile(directory, backupId);
  } catch {
    throw new OperationalBackupOperationStateFileError();
  }
}

/**
 * Continues only the cleanup phases after an operator has confirmed that the
 * original worker is stopped. A private exclusive recovery marker prevents
 * two recovery workers from advancing the same state at once. An abrupt death
 * of this recovery worker intentionally leaves that marker for manual review;
 * it is never treated as evidence that cleanup happened.
 */
export async function recoverOperationalBackupOperationState(input: {
  directory: string;
  repositoryRoot: string;
  backupId: string;
  manifestSha256: string;
  storeIds: readonly string[];
  originalWorkerStopped: true;
  cleanup: (state: OperationalBackupOperationState) => Promise<void>;
}): Promise<OperationalBackupOperationState> {
  let directory: VerifiedDirectory;
  let backupId: string;
  let expected: OperationalBackupOperationState;
  try {
    backupId = stateBackupId(input.backupId);
    if (input.originalWorkerStopped !== true || typeof input.cleanup !== "function") {
      throw new OperationalBackupOperationStateFileError();
    }
    expected = normalizeOperationalBackupOperationState({
      formatVersion: 1,
      backupId,
      phase: "CLEANUP_REQUIRED",
      manifestSha256: input.manifestSha256,
      storeIds: input.storeIds
    });
    directory = await verifyDirectory(input.directory, input.repositoryRoot);
  } catch {
    throw new OperationalBackupOperationStateFileError();
  }

  const marker = join(directory.path, `${backupId}.recovery.lock`);
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let lockIdentity: Identity | undefined;
  try {
    lock = await open(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await lock.chmod(0o600);
    lockIdentity = assertPrivateFile(await lock.stat());
    await lock.sync();
    await syncDirectory(directory);
  } catch {
    if (lock) {
      try { await lock.close(); } catch { /* Fail closed below. */ }
    }
    throw new OperationalBackupOperationStateFileError();
  }

  let result: OperationalBackupOperationState | undefined;
  let failed = false;
  try {
    const current = await readStateFile(directory, backupId);
    if (!current || current.manifestSha256 !== expected.manifestSha256 ||
      JSON.stringify(current.storeIds) !== JSON.stringify(expected.storeIds) ||
      (current.phase !== "REPLICATION_MAY_EXIST" && current.phase !== "CLEANUP_REQUIRED")) {
      throw new OperationalBackupOperationStateFileError();
    }
    if (current.phase === "REPLICATION_MAY_EXIST") {
      await replaceStateFile(directory, backupId, expected, false);
    }
    const cleanupState = await readStateFile(directory, backupId);
    if (!cleanupState || cleanupState.phase !== "CLEANUP_REQUIRED" ||
      cleanupState.manifestSha256 !== expected.manifestSha256 ||
      JSON.stringify(cleanupState.storeIds) !== JSON.stringify(expected.storeIds)) {
      throw new OperationalBackupOperationStateFileError();
    }
    await input.cleanup(cleanupState);
    const verified = normalizeOperationalBackupOperationState({ ...expected, phase: "CLEANUP_VERIFIED" });
    await replaceStateFile(directory, backupId, verified, false);
    result = await readStateFile(directory, backupId);
    if (!result || JSON.stringify(result) !== JSON.stringify(verified)) {
      throw new OperationalBackupOperationStateFileError();
    }
  } catch {
    failed = true;
  }

  try {
    await lock.close();
    if (!lockIdentity || !sameIdentity(lockIdentity, assertPrivateFile(await lstat(marker)))) {
      throw new OperationalBackupOperationStateFileError();
    }
    await unlink(marker);
    await syncDirectory(directory);
  } catch {
    failed = true;
  }
  if (failed || !result) throw new OperationalBackupOperationStateFileError();
  return result;
}
