import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, lstat, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const bucket = z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/);
const identitySchema = z.object({ dev: z.number().int().nonnegative(), ino: z.number().int().nonnegative() }).strict();
const storeSchema = z.object({
  storeId: uuid,
  sourceEndpoint: z.string().url(),
  sourceBucket: bucket,
  targetBucket: bucket
}).strict();

const bindingSchema = z.object({
  formatVersion: z.literal(2),
  backupId: uuid,
  manifestSha256: sha256,
  targetId: uuid,
  targetEndpoint: z.string().url(),
  targetMode: z.enum(["production", "loopback-development"]),
  dataAreaPath: z.string().min(1),
  dataAreaIdentity: identitySchema,
  credentialFileIdentity: identitySchema,
  credentialFileSha256: sha256,
  credentialRef: z.string().regex(/^(env|file|secret):[A-Za-z0-9._/-]{1,200}$/),
  stores: z.array(storeSchema).min(1).max(100_000)
}).strict().superRefine((value, context) => {
  if (!isAbsolute(value.dataAreaPath) || resolve(value.dataAreaPath) !== value.dataAreaPath) {
    context.addIssue({ code: "custom", path: ["dataAreaPath"], message: "Dataområdet måste ha en absolut canonical sökväg" });
  }
  const storeIds = value.stores.map(store => store.storeId);
  const targetBuckets = value.stores.map(store => store.targetBucket);
  if (new Set(storeIds).size !== storeIds.length || new Set(targetBuckets).size !== targetBuckets.length) {
    context.addIssue({ code: "custom", path: ["stores"], message: "Store-id och målbuckets måste vara unika" });
  }
  if (value.stores.some(store => store.sourceBucket !== store.targetBucket)) {
    context.addIssue({ code: "custom", path: ["stores"], message: "Käll- och målbucket måste matcha" });
  }
});

export type OperationalBackupTargetBinding = z.infer<typeof bindingSchema>;

const MAX_BINDING_BYTES = 512 * 1024;

/** Deliberately generic: never include the private path, endpoint or file contents. */
export class OperationalBackupTargetBindingFileError extends Error {
  public constructor() {
    super("OPERATIONAL_BACKUP_TARGET_BINDING_INVALID");
    this.name = "OperationalBackupTargetBindingFileError";
  }
}

type Identity = { dev: number; ino: number };
type Directory = { path: string; identity: Identity };

function fail(): never { throw new OperationalBackupTargetBindingFileError(); }
function currentUid(): number { const uid = process.getuid?.(); return uid === undefined ? fail() : uid; }
function sameIdentity(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function within(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

async function verifyPrivateDirectory(path: string, repositoryRoot: string, expected?: Identity): Promise<Directory> {
  if (!isAbsolute(path) || resolve(path) !== path) return fail();
  const [canonicalPath, canonicalRepository] = await Promise.all([realpath(path), realpath(repositoryRoot)]);
  if (canonicalPath !== path || within(canonicalPath, canonicalRepository)) return fail();
  const details = await stat(path);
  const identity = { dev: details.dev, ino: details.ino };
  if (!details.isDirectory() || details.uid !== currentUid() || (details.mode & 0o777) !== 0o700 ||
      (expected !== undefined && !sameIdentity(expected, identity))) return fail();
  return { path, identity };
}

function bindingPath(directory: Directory, backupId: string): string {
  return join(directory.path, `${backupId}.target.json`);
}

function assertPrivateFile(details: Stats): Identity {
  if (!details.isFile() || details.nlink !== 1 || details.uid !== currentUid() || (details.mode & 0o777) !== 0o600) return fail();
  return { dev: details.dev, ino: details.ino };
}

async function readFile(directory: Directory, backupId: string): Promise<OperationalBackupTargetBinding> {
  const path = bindingPath(directory, backupId);
  const named = assertPrivateFile(await lstat(path));
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!sameIdentity(named, assertPrivateFile(details)) || details.size > MAX_BINDING_BYTES) return fail();
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_BINDING_BYTES) return fail();
    const parsed = validateBinding(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (parsed.backupId !== backupId) return fail();
    return parsed;
  } catch {
    return fail();
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

function canonicalEndpoint(value: string, mode: OperationalBackupTargetBinding["targetMode"], isTarget = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  const loopback = url.hostname === "127.0.0.1" && url.protocol === "http:" && process.env.NODE_ENV !== "production";
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/") ||
      (url.protocol !== "https:" && !loopback) || (isTarget && mode === "loopback-development" && !loopback)) return fail();
  return url;
}

function endpointString(url: URL): string {
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
}

function validateBinding(input: unknown): OperationalBackupTargetBinding {
  const binding = bindingSchema.parse(input);
  const targetUrl = canonicalEndpoint(binding.targetEndpoint, binding.targetMode, true);
  if (binding.targetMode === "loopback-development" && targetUrl.hostname !== "127.0.0.1") return fail();
  const normalizedTarget = endpointString(targetUrl);
  if (binding.targetEndpoint !== normalizedTarget) return fail();
  const stores = binding.stores.map(store => {
    const sourceUrl = canonicalEndpoint(store.sourceEndpoint, binding.targetMode);
    const sourceEndpoint = endpointString(sourceUrl);
    if (store.sourceEndpoint !== sourceEndpoint) return fail();
    return { ...store, sourceEndpoint };
  });
  for (const store of stores) {
    const sourceIdentity = endpointString(new URL(store.sourceEndpoint));
    if (sourceIdentity === normalizedTarget) return fail();
  }
  return bindingSchema.parse({ ...binding, targetEndpoint: normalizedTarget, stores: stores.sort((a, b) => a.storeId.localeCompare(b.storeId)) });
}

async function verifyDataArea(binding: OperationalBackupTargetBinding, directory: Directory): Promise<void> {
  const dataPath = binding.dataAreaPath;
  if (!within(dataPath, directory.path) || dataPath === directory.path || dirname(dataPath) !== directory.path) return fail();
  const canonical = await realpath(dataPath);
  if (canonical !== dataPath) return fail();
  const details = await lstat(dataPath);
  const identity = { dev: details.dev, ino: details.ino };
  if (!details.isDirectory() || details.uid !== currentUid() || (details.mode & 0o777) !== 0o700 ||
      !sameIdentity(identity, binding.dataAreaIdentity)) return fail();
}

async function assertTargetIdUnused(directory: Directory, binding: OperationalBackupTargetBinding): Promise<void> {
  const names = await readdir(directory.path);
  for (const name of names) {
    const match = /^([0-9a-f-]{36})\.target\.json$/.exec(name);
    if (!match || match[1] === binding.backupId) continue;
    const existing = await readFile(directory, match[1]!);
    await verifyDataArea(existing, directory);
    if (existing.targetId === binding.targetId || existing.dataAreaPath === binding.dataAreaPath ||
        sameIdentity(existing.dataAreaIdentity, binding.dataAreaIdentity)) return fail();
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesWritten <= 0) return fail();
    offset += result.bytesWritten;
  }
}

async function syncDirectory(directory: Directory): Promise<void> {
  const handle = await open(directory.path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Atomically persists one private target binding. This file preserves caller-
 * supplied provisioning facts; it does not prove that the target is new or exclusive.
 */
export async function writeOperationalBackupTargetBinding(input: {
  directory: string;
  repositoryRoot: string;
  binding: unknown;
}): Promise<OperationalBackupTargetBinding> {
  try {
    const binding = validateBinding(input.binding);
    const directory = await verifyPrivateDirectory(input.directory, input.repositoryRoot);
    await verifyDataArea(binding, directory);
    await assertTargetIdUnused(directory, binding);
    const target = bindingPath(directory, binding.backupId);
    try { await lstat(target); return fail(); } catch (error) {
      if (error instanceof OperationalBackupTargetBindingFileError) throw error;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return fail();
    }
    const temporary = join(directory.path, `.${binding.backupId}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.chmod(0o600);
      const bytes = new TextEncoder().encode(`${JSON.stringify(binding)}\n`);
      if (bytes.byteLength > MAX_BINDING_BYTES) return fail();
      await writeAll(handle, bytes);
      await handle.sync();
      assertPrivateFile(await handle.stat());
      await handle.close();
      handle = undefined;
      // link() publishes atomically and fails if a prior binding appeared.
      await link(temporary, target);
      await unlink(temporary);
      await syncDirectory(directory);
      const persisted = await readFile(directory, binding.backupId);
      await verifyDataArea(persisted, directory);
      if (JSON.stringify(persisted) !== JSON.stringify(binding)) return fail();
      return persisted;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  } catch {
    return fail();
  }
}

/** Reads and revalidates the exact private binding and its data-area inode after restart. */
export async function readOperationalBackupTargetBinding(input: {
  directory: string;
  repositoryRoot: string;
  backupId: string;
  expected?: unknown;
}): Promise<OperationalBackupTargetBinding> {
  try {
    const directory = await verifyPrivateDirectory(input.directory, input.repositoryRoot);
    const expectedId = uuid.parse(input.backupId);
    const binding = await readFile(directory, expectedId);
    await verifyDataArea(binding, directory);
    if (input.expected !== undefined) {
      const expected = validateBinding(input.expected);
      if (JSON.stringify(expected) !== JSON.stringify(binding)) return fail();
    }
    return binding;
  } catch {
    return fail();
  }
}
