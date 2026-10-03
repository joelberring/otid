import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle
} from "node:fs/promises";
import path from "node:path";

import {
  CAPTURE_FILE_NAMES,
  CAPTURE_FORMAT,
  CAPTURE_FORMAT_VERSION,
  createCaptureManifestV1,
  decodeCaptureBytesBase64,
  encodeCaptureBytesBase64,
  encodeCaptureTimelineNdjson,
  parseCaptureWalNdjson,
  sha256Hex,
  validateCaptureBundleV1,
  type CaptureCompletionStatus,
  type CaptureDirection,
  type CaptureManifestV1,
  type CaptureMarkerKind,
  type CaptureTimelineEntryV1,
  type CaptureTransportMetadataV1,
  type CaptureWalEntryV1,
  type LoadedCaptureV1,
  type ValidatedCaptureV1
} from "@o-tid/device-transport";

interface PartialCaptureManifestV1 {
  readonly format: typeof CAPTURE_FORMAT;
  readonly formatVersion: typeof CAPTURE_FORMAT_VERSION;
  readonly sessionId: string;
  readonly transport: CaptureTransportMetadataV1;
  readonly synthetic: boolean;
  readonly startedAt: string;
}

export interface CaptureSessionWriterOptions {
  readonly outputDirectory: string;
  readonly transport: CaptureTransportMetadataV1;
  readonly synthetic?: boolean;
  readonly sessionId?: string;
  readonly wallClock?: () => Date;
  readonly monotonicNanos?: () => bigint;
}

export interface FinalizedCapture {
  readonly directory: string;
  readonly manifestPath: string;
  readonly capture: ValidatedCaptureV1;
}

export const CAPTURE_WAL_QUARANTINE_FILE_NAME = "capture.wal.quarantine.bin";
export const CAPTURE_WAL_QUARANTINE_METADATA_FILE_NAME = "capture.wal.quarantine.json";

type PendingWalEntry =
  | Omit<Extract<CaptureWalEntryV1, { readonly type: "bytes" }>, "sequence" | "monotonicTimeUs">
  | Omit<Extract<CaptureWalEntryV1, { readonly type: "marker" }>, "sequence" | "monotonicTimeUs">;

function stableJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function validateSessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === "." || value === "..") {
    throw new Error("Invalid capture session ID");
  }
  return value;
}

function parseTransportMetadata(value: unknown): CaptureTransportMetadataV1 {
  const transport = requireObject(value, "Partial capture transport");
  const expectedKeys = [
    "kind", "path", "baudRate", "dataBits", "stopBits", "parity", "flowControl", "vendorId", "productId"
  ];
  if (Object.keys(transport).some((key) => !expectedKeys.includes(key)) || expectedKeys.some((key) => !(key in transport))) {
    throw new Error("Partial capture transport has missing or unknown fields");
  }
  if (transport.kind !== "node-serial") throw new Error("Partial capture transport must be node-serial");
  if (typeof transport.path !== "string" || transport.path.length === 0) {
    throw new Error("Partial node-serial capture requires a path");
  }
  if (!Number.isSafeInteger(transport.baudRate) || (transport.baudRate as number) <= 0) {
    throw new Error("Partial node-serial capture requires a positive baudRate");
  }
  if (transport.dataBits !== 7 && transport.dataBits !== 8) {
    throw new Error("Partial node-serial capture requires dataBits 7 or 8");
  }
  if (transport.stopBits !== 1 && transport.stopBits !== 2) {
    throw new Error("Partial node-serial capture requires stopBits 1 or 2");
  }
  if (transport.parity !== "none" && transport.parity !== "even" && transport.parity !== "odd") {
    throw new Error("Partial node-serial capture requires a supported parity");
  }
  if (transport.flowControl !== "none" && transport.flowControl !== "hardware") {
    throw new Error("Partial node-serial capture requires a supported flowControl");
  }
  for (const field of ["vendorId", "productId"] as const) {
    const item = transport[field];
    if (item !== null && (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > 0xffff)) {
      throw new Error(`Partial capture ${field} must be null or 0..65535`);
    }
  }
  return {
    kind: "node-serial",
    path: transport.path,
    baudRate: transport.baudRate as number,
    dataBits: transport.dataBits,
    stopBits: transport.stopBits,
    parity: transport.parity,
    flowControl: transport.flowControl,
    vendorId: transport.vendorId as number | null,
    productId: transport.productId as number | null
  };
}

function parsePartialManifest(value: unknown): PartialCaptureManifestV1 {
  const manifest = requireObject(value, "Partial capture manifest");
  const expectedKeys = ["format", "formatVersion", "sessionId", "transport", "synthetic", "startedAt"];
  if (Object.keys(manifest).some((key) => !expectedKeys.includes(key)) || expectedKeys.some((key) => !(key in manifest))) {
    throw new Error("Partial capture manifest has missing or unknown fields");
  }
  if (manifest.format !== CAPTURE_FORMAT || manifest.formatVersion !== CAPTURE_FORMAT_VERSION) {
    throw new Error("Unsupported partial capture format");
  }
  if (typeof manifest.synthetic !== "boolean") throw new Error("Partial capture synthetic must be boolean");
  if (typeof manifest.startedAt !== "string" || !Number.isFinite(Date.parse(manifest.startedAt))) {
    throw new Error("Partial capture startedAt must be ISO 8601");
  }
  return {
    format: CAPTURE_FORMAT,
    formatVersion: CAPTURE_FORMAT_VERSION,
    sessionId: validateSessionId(manifest.sessionId),
    transport: parseTransportMetadata(manifest.transport),
    synthetic: manifest.synthetic,
    startedAt: manifest.startedAt
  };
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeExclusiveSynced(filePath: string, bytes: Uint8Array | string): Promise<void> {
  const handle = await open(
    filePath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomic(filePath: string, bytes: Uint8Array | string): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeExclusiveSynced(temporary, bytes);
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF" && code !== "EISDIR") throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readPartialManifest(partialDirectory: string): Promise<PartialCaptureManifestV1> {
  const bytes = await readFile(path.join(partialDirectory, CAPTURE_FILE_NAMES.partialManifest));
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Partial capture manifest is not valid JSON", { cause: error });
  }
  return parsePartialManifest(value);
}

function rebuildFromWal(walNdjson: Uint8Array): {
  readonly traffic: Uint8Array;
  readonly timelineNdjson: string;
} {
  const wal = parseCaptureWalNdjson(walNdjson);
  const parts: Uint8Array[] = [];
  const timeline: CaptureTimelineEntryV1[] = [];
  let offset = 0;
  for (const entry of wal) {
    if (entry.type === "marker") {
      timeline.push({
        type: "marker",
        sequence: entry.sequence,
        monotonicTimeUs: entry.monotonicTimeUs,
        marker: entry.marker
      });
      continue;
    }
    const bytes = decodeCaptureBytesBase64(entry.bytesBase64, `wal[${entry.sequence - 1}].bytesBase64`);
    parts.push(bytes);
    timeline.push({
      type: "bytes",
      sequence: entry.sequence,
      direction: entry.direction,
      monotonicTimeUs: entry.monotonicTimeUs,
      offset,
      length: bytes.byteLength,
      sha256: sha256Hex(bytes)
    });
    offset += bytes.byteLength;
  }
  const traffic = Buffer.concat(parts.map((part) => Buffer.from(part)));
  return { traffic, timelineNdjson: encodeCaptureTimelineNdjson(timeline) };
}

interface PreparedCapture {
  readonly walNdjson: Uint8Array;
  readonly traffic: Uint8Array;
  readonly timelineNdjson: string;
  readonly manifest: CaptureManifestV1;
  readonly capture: ValidatedCaptureV1;
}

function prepareCapture(
  partial: PartialCaptureManifestV1,
  walNdjson: Uint8Array,
  status: CaptureCompletionStatus,
  completedAt: string
): PreparedCapture {
  const rebuilt = rebuildFromWal(walNdjson);
  const manifest: CaptureManifestV1 = createCaptureManifestV1({
    sessionId: partial.sessionId,
    transport: partial.transport,
    synthetic: partial.synthetic,
    status,
    startedAt: partial.startedAt,
    completedAt,
    walNdjson,
    traffic: rebuilt.traffic,
    timelineNdjson: rebuilt.timelineNdjson
  });
  const capture = validateCaptureBundleV1({
    manifest,
    walNdjson,
    traffic: rebuilt.traffic,
    timelineNdjson: rebuilt.timelineNdjson
  });
  return {
    walNdjson,
    traffic: rebuilt.traffic,
    timelineNdjson: rebuilt.timelineNdjson,
    manifest,
    capture
  };
}

function recoverValidatedWalPrefix(
  partial: PartialCaptureManifestV1,
  walNdjson: Uint8Array,
  status: CaptureCompletionStatus,
  completedAt: string
): { readonly prepared: PreparedCapture; readonly quarantinedSuffix: Uint8Array } {
  const prefixEnds: number[] = [];
  for (let index = walNdjson.byteLength - 1; index >= 0; index -= 1) {
    if (walNdjson[index] === 0x0a) prefixEnds.push(index + 1);
  }
  prefixEnds.push(0);

  let lastError: unknown;
  for (const prefixEnd of prefixEnds) {
    const prefix = walNdjson.slice(0, prefixEnd);
    try {
      return {
        prepared: prepareCapture(partial, prefix, status, completedAt),
        quarantinedSuffix: walNdjson.slice(prefixEnd)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No valid WAL prefix could be recovered");
}

async function preserveQuarantinedWalSuffix(partialDirectory: string, suffix: Uint8Array): Promise<void> {
  if (suffix.byteLength === 0) return;
  const quarantinePath = path.join(partialDirectory, CAPTURE_WAL_QUARANTINE_FILE_NAME);
  const metadataPath = path.join(partialDirectory, CAPTURE_WAL_QUARANTINE_METADATA_FILE_NAME);
  if (await pathExists(quarantinePath)) {
    const existing = await readFile(quarantinePath);
    if (existing.byteLength !== suffix.byteLength || existing.some((byte, index) => byte !== suffix[index])) {
      throw new Error("Existing WAL quarantine does not match the invalid suffix");
    }
  } else {
    await writeExclusiveSynced(quarantinePath, suffix);
  }
  const metadata = stableJson({
    format: "o-tid-wal-quarantine",
    formatVersion: 1,
    byteLength: suffix.byteLength,
    sha256: sha256Hex(suffix)
  });
  if (await pathExists(metadataPath)) {
    if (await readFile(metadataPath, "utf8") !== metadata) {
      throw new Error("Existing WAL quarantine metadata does not match the invalid suffix");
    }
  } else {
    await writeExclusiveSynced(metadataPath, metadata);
  }
  await syncDirectory(partialDirectory);
}

async function writeDerivedArtifacts(partialDirectory: string, traffic: Uint8Array, timelineNdjson: string): Promise<void> {
  await writeAtomic(path.join(partialDirectory, CAPTURE_FILE_NAMES.traffic), traffic);
  await writeAtomic(path.join(partialDirectory, CAPTURE_FILE_NAMES.timeline), timelineNdjson);
}

async function loadCaptureFiles(manifestPath: string): Promise<LoadedCaptureV1> {
  const resolvedManifest = path.resolve(manifestPath);
  if (path.basename(resolvedManifest) !== CAPTURE_FILE_NAMES.manifest) {
    throw new Error(`Replay requires ${CAPTURE_FILE_NAMES.manifest}`);
  }
  const directory = path.dirname(resolvedManifest);
  const [manifestBytes, walNdjson, traffic, timelineNdjson] = await Promise.all([
    readFile(resolvedManifest),
    readFile(path.join(directory, CAPTURE_FILE_NAMES.wal)),
    readFile(path.join(directory, CAPTURE_FILE_NAMES.traffic)),
    readFile(path.join(directory, CAPTURE_FILE_NAMES.timeline))
  ]);
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Capture manifest is not valid JSON", { cause: error });
  }
  return { manifest, walNdjson, traffic, timelineNdjson };
}

export async function readValidatedCapture(manifestPath: string): Promise<ValidatedCaptureV1> {
  return validateCaptureBundleV1(await loadCaptureFiles(manifestPath));
}

async function finishCommittedPartial(
  partialDirectory: string,
  finalDirectory: string,
  capture: ValidatedCaptureV1
): Promise<FinalizedCapture> {
  await rename(partialDirectory, finalDirectory);
  await syncDirectory(path.dirname(finalDirectory));
  await unlink(path.join(finalDirectory, CAPTURE_FILE_NAMES.partialManifest)).catch(() => undefined);
  await syncDirectory(finalDirectory);
  return {
    directory: finalDirectory,
    manifestPath: path.join(finalDirectory, CAPTURE_FILE_NAMES.manifest),
    capture
  };
}

async function finalizePartialDirectory(
  partialDirectory: string,
  status: CaptureCompletionStatus,
  wallClock: () => Date,
  recoverWal: boolean
): Promise<FinalizedCapture> {
  if (!partialDirectory.endsWith(".partial")) throw new Error("Partial capture directory must end with .partial");
  const finalDirectory = partialDirectory.slice(0, -".partial".length);
  if (await pathExists(finalDirectory)) throw new Error(`Capture output already exists: ${finalDirectory}`);

  const finalManifestPath = path.join(partialDirectory, CAPTURE_FILE_NAMES.manifest);
  if (await pathExists(finalManifestPath)) {
    const capture = await readValidatedCapture(finalManifestPath);
    return finishCommittedPartial(partialDirectory, finalDirectory, capture);
  }

  const partial = await readPartialManifest(partialDirectory);
  const walPath = path.join(partialDirectory, CAPTURE_FILE_NAMES.wal);
  const originalWal = await readFile(walPath);
  const completedAt = wallClock().toISOString();
  const recovery = recoverWal
    ? recoverValidatedWalPrefix(partial, originalWal, status, completedAt)
    : { prepared: prepareCapture(partial, originalWal, status, completedAt), quarantinedSuffix: new Uint8Array() };
  if (recovery.quarantinedSuffix.byteLength > 0) {
    await preserveQuarantinedWalSuffix(partialDirectory, recovery.quarantinedSuffix);
    await writeAtomic(walPath, recovery.prepared.walNdjson);
    await syncDirectory(partialDirectory);
  }
  await writeDerivedArtifacts(partialDirectory, recovery.prepared.traffic, recovery.prepared.timelineNdjson);
  await writeAtomic(finalManifestPath, stableJson(recovery.prepared.manifest));
  await syncDirectory(partialDirectory);
  return finishCommittedPartial(partialDirectory, finalDirectory, recovery.prepared.capture);
}

export class CaptureSessionWriter {
  readonly partialDirectory: string;
  readonly #walHandle: FileHandle;
  readonly #monotonicNanos: () => bigint;
  readonly #monotonicOrigin: bigint;
  readonly #wallClock: () => Date;
  #nextSequence = 1;
  #lastMonotonicTimeUs = 0;
  #tail: Promise<void> = Promise.resolve();
  #closed = false;

  private constructor(
    partialDirectory: string,
    walHandle: FileHandle,
    wallClock: () => Date,
    monotonicNanos: () => bigint
  ) {
    this.partialDirectory = partialDirectory;
    this.#walHandle = walHandle;
    this.#wallClock = wallClock;
    this.#monotonicNanos = monotonicNanos;
    this.#monotonicOrigin = monotonicNanos();
  }

  static async create(options: CaptureSessionWriterOptions): Promise<CaptureSessionWriter> {
    const wallClock = options.wallClock ?? (() => new Date());
    const monotonicNanos = options.monotonicNanos ?? (() => process.hrtime.bigint());
    const sessionId = validateSessionId(
      options.sessionId ?? `capture-${wallClock().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`
    );
    const transport = parseTransportMetadata(options.transport);
    await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
    const outputStats = await stat(options.outputDirectory);
    if (!outputStats.isDirectory()) throw new Error("Capture output must be a directory");
    const partialDirectory = path.join(options.outputDirectory, `${sessionId}.partial`);
    const finalDirectory = path.join(options.outputDirectory, sessionId);
    if (await pathExists(finalDirectory)) throw new Error(`Capture output already exists: ${finalDirectory}`);
    await mkdir(partialDirectory, { mode: 0o700 });
    const partialManifest: PartialCaptureManifestV1 = {
      format: CAPTURE_FORMAT,
      formatVersion: CAPTURE_FORMAT_VERSION,
      sessionId,
      transport,
      synthetic: options.synthetic ?? false,
      startedAt: wallClock().toISOString()
    };
    try {
      await writeExclusiveSynced(
        path.join(partialDirectory, CAPTURE_FILE_NAMES.partialManifest),
        stableJson(partialManifest)
      );
      const walHandle = await open(
        path.join(partialDirectory, CAPTURE_FILE_NAMES.wal),
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW,
        0o600
      );
      await walHandle.sync();
      await syncDirectory(partialDirectory);
      await syncDirectory(options.outputDirectory);
      return new CaptureSessionWriter(partialDirectory, walHandle, wallClock, monotonicNanos);
    } catch (error) {
      throw new Error(`Could not initialize private capture session at ${partialDirectory}`, { cause: error });
    }
  }

  recordChunk(direction: CaptureDirection, bytes: Uint8Array): Promise<void> {
    if (direction !== "rx" && direction !== "tx") return Promise.reject(new Error("Invalid capture direction"));
    if (bytes.byteLength === 0) return Promise.reject(new Error("Empty capture chunks are not permitted"));
    return this.#record({
      type: "bytes",
      direction,
      bytesBase64: encodeCaptureBytesBase64(Uint8Array.from(bytes))
    });
  }

  recordMarker(marker: CaptureMarkerKind): Promise<void> {
    if (marker !== "card-inserted" && marker !== "card-removed" && marker !== "cable-detached") {
      return Promise.reject(new Error("Unsupported capture marker"));
    }
    return this.#record({ type: "marker", marker });
  }

  async abort(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#tail.catch(() => undefined);
    await this.#walHandle.close();
  }

  async finalize(status: CaptureCompletionStatus = "complete"): Promise<FinalizedCapture> {
    if (this.#closed) throw new Error("Capture writer is already closed");
    this.#closed = true;
    try {
      await this.#tail;
      await this.#walHandle.sync();
    } finally {
      await this.#walHandle.close();
    }
    return finalizePartialDirectory(this.partialDirectory, status, this.#wallClock, false);
  }

  #record(record: PendingWalEntry): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Capture writer is closed"));
    const sequence = this.#nextSequence;
    this.#nextSequence += 1;
    const measuredBigInt = (this.#monotonicNanos() - this.#monotonicOrigin) / 1_000n;
    if (measuredBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Promise.reject(new Error("Capture monotonic timestamp exceeds the safe integer range"));
    }
    const measured = Number(measuredBigInt);
    const monotonicTimeUs = Math.max(measured, this.#lastMonotonicTimeUs);
    this.#lastMonotonicTimeUs = monotonicTimeUs;
    const complete = { ...record, sequence, monotonicTimeUs } as CaptureWalEntryV1;
    const operation = this.#tail.then(async () => {
      await this.#walHandle.writeFile(stableJson(complete));
      await this.#walHandle.sync();
    });
    this.#tail = operation;
    return operation;
  }
}

export async function recoverPartialCapture(
  partialDirectory: string,
  wallClock: () => Date = () => new Date()
): Promise<FinalizedCapture> {
  return finalizePartialDirectory(path.resolve(partialDirectory), "interrupted", wallClock, true);
}
