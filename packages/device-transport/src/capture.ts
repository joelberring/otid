import type { ByteTransportKind } from "./byte-transport";
import { sha256Hex } from "./sha256";

export const CAPTURE_FORMAT = "o-tid-raw-capture" as const;
export const CAPTURE_FORMAT_VERSION = 1 as const;
export const CAPTURE_FILE_NAMES = Object.freeze({
  manifest: "session.json",
  partialManifest: "session.partial.json",
  wal: "capture.wal.ndjson",
  traffic: "traffic.bin",
  timeline: "timeline.ndjson"
});

export type CaptureDirection = "rx" | "tx";
export type CaptureSourceTransportKind = Exclude<ByteTransportKind, "replay">;
export type CaptureCompletionStatus = "complete" | "interrupted" | "error";
export type CaptureMarkerKind = "card-inserted" | "card-removed" | "cable-detached";

export interface CaptureTransportMetadataV1 {
  readonly kind: CaptureSourceTransportKind;
  readonly path: string | null;
  readonly baudRate: number | null;
  readonly dataBits: 7 | 8 | null;
  readonly stopBits: 1 | 2 | null;
  readonly parity: "none" | "even" | "odd" | null;
  readonly flowControl: "none" | "hardware" | null;
  readonly vendorId: number | null;
  readonly productId: number | null;
}

export interface CaptureArtifactV1 {
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface CaptureManifestV1 {
  readonly format: typeof CAPTURE_FORMAT;
  readonly formatVersion: typeof CAPTURE_FORMAT_VERSION;
  readonly sessionId: string;
  readonly transport: CaptureTransportMetadataV1;
  readonly synthetic: boolean;
  readonly status: CaptureCompletionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly firstMonotonicTimeUs: number | null;
  readonly lastMonotonicTimeUs: number | null;
  readonly eventCount: number;
  readonly byteEventCount: number;
  readonly markerCount: number;
  readonly rxEventCount: number;
  readonly txEventCount: number;
  readonly byteCount: number;
  readonly artifacts: {
    readonly wal: CaptureArtifactV1;
    readonly traffic: CaptureArtifactV1;
    readonly timeline: CaptureArtifactV1;
  };
}

export interface CaptureWalBytesEntryV1 {
  readonly type: "bytes";
  readonly sequence: number;
  readonly direction: CaptureDirection;
  readonly monotonicTimeUs: number;
  readonly bytesBase64: string;
}

export interface CaptureWalMarkerEntryV1 {
  readonly type: "marker";
  readonly sequence: number;
  readonly monotonicTimeUs: number;
  readonly marker: CaptureMarkerKind;
}

export type CaptureWalEntryV1 = CaptureWalBytesEntryV1 | CaptureWalMarkerEntryV1;

export interface CaptureTimelineBytesEntryV1 {
  readonly type: "bytes";
  readonly sequence: number;
  readonly direction: CaptureDirection;
  readonly monotonicTimeUs: number;
  readonly offset: number;
  readonly length: number;
  readonly sha256: string;
}

export interface CaptureTimelineMarkerEntryV1 {
  readonly type: "marker";
  readonly sequence: number;
  readonly monotonicTimeUs: number;
  readonly marker: CaptureMarkerKind;
}

export type CaptureTimelineEntryV1 = CaptureTimelineBytesEntryV1 | CaptureTimelineMarkerEntryV1;

export interface LoadedCaptureV1 {
  readonly manifest: unknown;
  readonly walNdjson: string | Uint8Array;
  readonly traffic: Uint8Array;
  readonly timelineNdjson: string | Uint8Array;
}

export interface ValidatedCaptureV1 {
  readonly manifest: CaptureManifestV1;
  readonly wal: readonly CaptureWalEntryV1[];
  readonly walNdjson: Uint8Array;
  readonly traffic: Uint8Array;
  readonly timeline: readonly CaptureTimelineEntryV1[];
  readonly timelineNdjson: Uint8Array;
}

export interface CreateCaptureManifestV1Input {
  readonly sessionId: string;
  readonly transport: CaptureTransportMetadataV1;
  readonly synthetic: boolean;
  readonly status: CaptureCompletionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly walNdjson: string | Uint8Array;
  readonly traffic: Uint8Array;
  readonly timelineNdjson: string | Uint8Array;
}

export class CaptureValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options);
    this.name = "CaptureValidationError";
    this.code = code;
    this.path = path;
  }
}

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SOURCE_KINDS = new Set<CaptureSourceTransportKind>([
  "android-usb",
  "web-serial",
  "node-serial",
  "tcp"
]);
const COMPLETION_STATUSES = new Set<CaptureCompletionStatus>(["complete", "interrupted", "error"]);
const MARKER_KINDS = new Set<CaptureMarkerKind>([
  "card-inserted",
  "card-removed",
  "cable-detached"
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(code: string, path: string, message: string): never {
  throw new CaptureValidationError(code, path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_TYPE", path, "måste vara ett objekt");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "fältet stöds inte");
  }
  for (const key of keys) {
    if (!(key in value)) fail("MISSING_FIELD", `${path}.${key}`, "fältet saknas");
  }
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") fail("INVALID_TYPE", path, "måste vara en sträng");
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail("INVALID_INTEGER", path, `måste vara ett säkert heltal >= ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

function hashValue(value: unknown, path: string): string {
  const hash = stringValue(value, path);
  if (!HASH_PATTERN.test(hash)) fail("INVALID_HASH", path, "måste vara SHA-256 i gemener");
  return hash;
}

function isoTimestamp(value: unknown, path: string): string {
  const timestamp = stringValue(value, path);
  if (!Number.isFinite(Date.parse(timestamp))) fail("INVALID_TIMESTAMP", path, "måste vara ISO 8601");
  return timestamp;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : stringValue(value, path);
}

function nullableIntegerValue(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("INVALID_TYPE", path, "måste vara boolean");
  return value;
}

function transportMetadata(value: unknown, path: string): CaptureTransportMetadataV1 {
  const metadata = record(value, path);
  exactKeys(metadata, [
    "kind", "path", "baudRate", "dataBits", "stopBits", "parity", "flowControl", "vendorId", "productId"
  ], path);
  const kind = stringValue(metadata.kind, `${path}.kind`);
  if (!SOURCE_KINDS.has(kind as CaptureSourceTransportKind)) {
    fail("INVALID_TRANSPORT", `${path}.kind`, "är inte en capturetransport");
  }
  const transportPath = nullableString(metadata.path, `${path}.path`);
  const baudRate = nullableIntegerValue(metadata.baudRate, `${path}.baudRate`);
  const dataBits = metadata.dataBits === null ? null : integer(metadata.dataBits, `${path}.dataBits`);
  const stopBits = metadata.stopBits === null ? null : integer(metadata.stopBits, `${path}.stopBits`);
  const parity = nullableString(metadata.parity, `${path}.parity`);
  const flowControl = nullableString(metadata.flowControl, `${path}.flowControl`);
  const vendorId = nullableIntegerValue(metadata.vendorId, `${path}.vendorId`);
  const productId = nullableIntegerValue(metadata.productId, `${path}.productId`);
  if (transportPath !== null && transportPath.length === 0) {
    fail("INVALID_TRANSPORT_METADATA", `${path}.path`, "får inte vara tom");
  }
  if (baudRate === 0) fail("INVALID_TRANSPORT_METADATA", `${path}.baudRate`, "måste vara större än noll");
  if (dataBits !== null && dataBits !== 7 && dataBits !== 8) {
    fail("INVALID_TRANSPORT_METADATA", `${path}.dataBits`, "måste vara 7 eller 8");
  }
  if (stopBits !== null && stopBits !== 1 && stopBits !== 2) {
    fail("INVALID_TRANSPORT_METADATA", `${path}.stopBits`, "måste vara 1 eller 2");
  }
  if (parity !== null && parity !== "none" && parity !== "even" && parity !== "odd") {
    fail("INVALID_TRANSPORT_METADATA", `${path}.parity`, "måste vara none, even eller odd");
  }
  if (flowControl !== null && flowControl !== "none" && flowControl !== "hardware") {
    fail("INVALID_TRANSPORT_METADATA", `${path}.flowControl`, "måste vara none eller hardware");
  }
  if (vendorId !== null && vendorId > 0xffff) fail("INVALID_TRANSPORT_METADATA", `${path}.vendorId`, "måste vara 0..65535");
  if (productId !== null && productId > 0xffff) fail("INVALID_TRANSPORT_METADATA", `${path}.productId`, "måste vara 0..65535");
  if (kind === "node-serial" && (
    transportPath === null || baudRate === null || dataBits === null || stopBits === null || parity === null || flowControl === null
  )) {
    fail("INVALID_TRANSPORT_METADATA", path, "node-serial kräver path och fullständiga serieparametrar");
  }
  if ((kind === "web-serial" || kind === "android-usb") && baudRate === null) {
    fail("INVALID_TRANSPORT_METADATA", `${path}.baudRate`, `${kind} kräver baudRate`);
  }
  return Object.freeze({
    kind: kind as CaptureSourceTransportKind,
    path: transportPath,
    baudRate,
    dataBits,
    stopBits,
    parity,
    flowControl,
    vendorId,
    productId
  });
}

function artifact(value: unknown, expectedFileName: string, path: string): CaptureArtifactV1 {
  const item = record(value, path);
  exactKeys(item, ["fileName", "byteLength", "sha256"], path);
  const fileName = stringValue(item.fileName, `${path}.fileName`);
  if (fileName !== expectedFileName) fail("INVALID_FILE_NAME", `${path}.fileName`, `måste vara ${expectedFileName}`);
  return Object.freeze({
    fileName,
    byteLength: integer(item.byteLength, `${path}.byteLength`),
    sha256: hashValue(item.sha256, `${path}.sha256`)
  });
}

export function validateCaptureManifestV1(value: unknown): CaptureManifestV1 {
  const manifest = record(value, "manifest");
  exactKeys(manifest, [
    "format", "formatVersion", "sessionId", "transport", "synthetic", "status", "startedAt", "completedAt",
    "firstMonotonicTimeUs", "lastMonotonicTimeUs", "eventCount", "byteEventCount", "markerCount",
    "rxEventCount", "txEventCount", "byteCount", "artifacts"
  ], "manifest");
  if (manifest.format !== CAPTURE_FORMAT) fail("INVALID_FORMAT", "manifest.format", `måste vara ${CAPTURE_FORMAT}`);
  if (manifest.formatVersion !== CAPTURE_FORMAT_VERSION) {
    fail("UNSUPPORTED_VERSION", "manifest.formatVersion", "endast version 1 stöds");
  }
  const sessionId = stringValue(manifest.sessionId, "manifest.sessionId");
  if (!SESSION_PATTERN.test(sessionId) || sessionId === "." || sessionId === "..") {
    fail("INVALID_SESSION_ID", "manifest.sessionId", "är inte ett säkert sessions-id");
  }
  const transport = transportMetadata(manifest.transport, "manifest.transport");
  const synthetic = booleanValue(manifest.synthetic, "manifest.synthetic");
  const status = stringValue(manifest.status, "manifest.status");
  if (!COMPLETION_STATUSES.has(status as CaptureCompletionStatus)) {
    fail("INVALID_COMPLETION_STATUS", "manifest.status", "måste vara complete, interrupted eller error");
  }
  const startedAt = isoTimestamp(manifest.startedAt, "manifest.startedAt");
  const completedAt = isoTimestamp(manifest.completedAt, "manifest.completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    fail("INVALID_TIME_RANGE", "manifest.completedAt", "får inte vara före startedAt");
  }
  const eventCount = integer(manifest.eventCount, "manifest.eventCount");
  const byteEventCount = integer(manifest.byteEventCount, "manifest.byteEventCount");
  const markerCount = integer(manifest.markerCount, "manifest.markerCount");
  const rxEventCount = integer(manifest.rxEventCount, "manifest.rxEventCount");
  const txEventCount = integer(manifest.txEventCount, "manifest.txEventCount");
  if (rxEventCount + txEventCount !== byteEventCount || byteEventCount + markerCount !== eventCount) {
    fail("INVALID_COUNT", "manifest.eventCount", "måste motsvara byte- och markörantal");
  }
  const firstMonotonicTimeUs = nullableInteger(manifest.firstMonotonicTimeUs, "manifest.firstMonotonicTimeUs");
  const lastMonotonicTimeUs = nullableInteger(manifest.lastMonotonicTimeUs, "manifest.lastMonotonicTimeUs");
  if ((eventCount === 0) !== (firstMonotonicTimeUs === null && lastMonotonicTimeUs === null)) {
    fail("INVALID_TIME_RANGE", "manifest.firstMonotonicTimeUs", "tom capture ska ha null, övriga ska ha tidsintervall");
  }
  if (firstMonotonicTimeUs !== null && lastMonotonicTimeUs !== null && lastMonotonicTimeUs < firstMonotonicTimeUs) {
    fail("INVALID_TIME_RANGE", "manifest.lastMonotonicTimeUs", "får inte vara före första monotontiden");
  }
  const artifacts = record(manifest.artifacts, "manifest.artifacts");
  exactKeys(artifacts, ["wal", "traffic", "timeline"], "manifest.artifacts");

  return Object.freeze({
    format: CAPTURE_FORMAT,
    formatVersion: CAPTURE_FORMAT_VERSION,
    sessionId,
    transport,
    synthetic,
    status: status as CaptureCompletionStatus,
    startedAt,
    completedAt,
    firstMonotonicTimeUs,
    lastMonotonicTimeUs,
    eventCount,
    byteEventCount,
    markerCount,
    rxEventCount,
    txEventCount,
    byteCount: integer(manifest.byteCount, "manifest.byteCount"),
    artifacts: Object.freeze({
      wal: artifact(artifacts.wal, CAPTURE_FILE_NAMES.wal, "manifest.artifacts.wal"),
      traffic: artifact(artifacts.traffic, CAPTURE_FILE_NAMES.traffic, "manifest.artifacts.traffic"),
      timeline: artifact(artifacts.timeline, CAPTURE_FILE_NAMES.timeline, "manifest.artifacts.timeline")
    })
  });
}

function direction(value: unknown, path: string): CaptureDirection {
  if (value !== "rx" && value !== "tx") fail("INVALID_DIRECTION", path, "måste vara rx eller tx");
  return value;
}

function markerKind(value: unknown, path: string): CaptureMarkerKind {
  const marker = stringValue(value, path);
  if (!MARKER_KINDS.has(marker as CaptureMarkerKind)) {
    fail("INVALID_MARKER", path, "är inte en stödd capturemarkör");
  }
  return marker as CaptureMarkerKind;
}

function parseNdjson<T>(raw: Uint8Array, path: string, parseLine: (value: unknown, path: string) => T): readonly T[] {
  let text: string;
  try {
    text = decoder.decode(raw);
  } catch (error) {
    throw new CaptureValidationError("INVALID_UTF8", path, "är inte giltig UTF-8", { cause: error });
  }
  if (text.length === 0) return Object.freeze([]);
  if (!text.endsWith("\n")) fail("INVALID_NDJSON", path, "måste avslutas med radbrytning");
  const lines = text.slice(0, -1).split("\n");
  return Object.freeze(lines.map((line, index) => {
    if (line.length === 0) fail("INVALID_NDJSON", `${path}[${index}]`, "tom rad tillåts inte");
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new CaptureValidationError("INVALID_JSON", `${path}[${index}]`, "är inte giltig JSON", { cause: error });
    }
    return parseLine(value, `${path}[${index}]`);
  }));
}

function parseWalLine(value: unknown, path: string): CaptureWalEntryV1 {
  const item = record(value, path);
  if (item.type === "bytes") {
    exactKeys(item, ["type", "sequence", "direction", "monotonicTimeUs", "bytesBase64"], path);
    return Object.freeze({
      type: "bytes",
      sequence: integer(item.sequence, `${path}.sequence`, 1),
      direction: direction(item.direction, `${path}.direction`),
      monotonicTimeUs: integer(item.monotonicTimeUs, `${path}.monotonicTimeUs`),
      bytesBase64: stringValue(item.bytesBase64, `${path}.bytesBase64`)
    });
  }
  if (item.type === "marker") {
    exactKeys(item, ["type", "sequence", "monotonicTimeUs", "marker"], path);
    return Object.freeze({
      type: "marker",
      sequence: integer(item.sequence, `${path}.sequence`, 1),
      monotonicTimeUs: integer(item.monotonicTimeUs, `${path}.monotonicTimeUs`),
      marker: markerKind(item.marker, `${path}.marker`)
    });
  }
  fail("INVALID_EVENT_TYPE", `${path}.type`, "måste vara bytes eller marker");
}

function parseTimelineLine(value: unknown, path: string): CaptureTimelineEntryV1 {
  const item = record(value, path);
  if (item.type === "bytes") {
    exactKeys(item, ["type", "sequence", "direction", "monotonicTimeUs", "offset", "length", "sha256"], path);
    return Object.freeze({
      type: "bytes",
      sequence: integer(item.sequence, `${path}.sequence`, 1),
      direction: direction(item.direction, `${path}.direction`),
      monotonicTimeUs: integer(item.monotonicTimeUs, `${path}.monotonicTimeUs`),
      offset: integer(item.offset, `${path}.offset`),
      length: integer(item.length, `${path}.length`, 1),
      sha256: hashValue(item.sha256, `${path}.sha256`)
    });
  }
  if (item.type === "marker") {
    exactKeys(item, ["type", "sequence", "monotonicTimeUs", "marker"], path);
    return Object.freeze({
      type: "marker",
      sequence: integer(item.sequence, `${path}.sequence`, 1),
      monotonicTimeUs: integer(item.monotonicTimeUs, `${path}.monotonicTimeUs`),
      marker: markerKind(item.marker, `${path}.marker`)
    });
  }
  fail("INVALID_EVENT_TYPE", `${path}.type`, "måste vara bytes eller marker");
}

function rawBytes(value: unknown, path: string): Uint8Array {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value.slice();
  fail("INVALID_TYPE", path, "måste vara en UTF-8-sträng eller Uint8Array");
}

export function parseCaptureWalNdjson(value: string | Uint8Array): readonly CaptureWalEntryV1[] {
  return parseNdjson(rawBytes(value, "wal"), "wal", parseWalLine);
}

export function parseCaptureTimelineNdjson(value: string | Uint8Array): readonly CaptureTimelineEntryV1[] {
  return parseNdjson(rawBytes(value, "timeline"), "timeline", parseTimelineLine);
}

export function encodeCaptureWalNdjson(entries: readonly CaptureWalEntryV1[]): string {
  return entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function encodeCaptureTimelineNdjson(entries: readonly CaptureTimelineEntryV1[]): string {
  return entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeCaptureBytesBase64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 3) {
    const a = bytes[offset] ?? 0;
    const b = bytes[offset + 1] ?? 0;
    const c = bytes[offset + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(value >>> 18) & 63];
    output += BASE64_ALPHABET[(value >>> 12) & 63];
    output += offset + 1 < bytes.byteLength ? BASE64_ALPHABET[(value >>> 6) & 63] : "=";
    output += offset + 2 < bytes.byteLength ? BASE64_ALPHABET[value & 63] : "=";
  }
  return output;
}

export function decodeCaptureBytesBase64(value: string, path = "bytesBase64"): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail("INVALID_BASE64", path, "är inte kanonisk base64 för en icke-tom byteföljd");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const a = BASE64_ALPHABET.indexOf(value[offset] ?? "");
    const b = BASE64_ALPHABET.indexOf(value[offset + 1] ?? "");
    const c = value[offset + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[offset + 2] ?? "");
    const d = value[offset + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[offset + 3] ?? "");
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputOffset < output.length) output[outputOffset++] = (combined >>> 16) & 0xff;
    if (outputOffset < output.length) output[outputOffset++] = (combined >>> 8) & 0xff;
    if (outputOffset < output.length) output[outputOffset++] = combined & 0xff;
  }
  if (encodeCaptureBytesBase64(output) !== value) fail("INVALID_BASE64", path, "är inte kanonisk base64");
  return output;
}

function verifyArtifact(bytes: Uint8Array, expected: CaptureArtifactV1, path: string): void {
  if (bytes.byteLength !== expected.byteLength) fail("ARTIFACT_LENGTH_MISMATCH", path, "byteantalet avviker från manifestet");
  if (sha256Hex(bytes) !== expected.sha256) fail("ARTIFACT_HASH_MISMATCH", path, "SHA-256 avviker från manifestet");
}

export function validateCaptureBundleV1(input: unknown): ValidatedCaptureV1 {
  const source = record(input, "capture");
  exactKeys(source, ["manifest", "walNdjson", "traffic", "timelineNdjson"], "capture");
  const manifest = validateCaptureManifestV1(source.manifest);
  const walNdjson = rawBytes(source.walNdjson, "wal");
  if (!(source.traffic instanceof Uint8Array)) fail("INVALID_TYPE", "traffic", "måste vara Uint8Array");
  const traffic = source.traffic.slice();
  const timelineNdjson = rawBytes(source.timelineNdjson, "timeline");
  verifyArtifact(walNdjson, manifest.artifacts.wal, "wal");
  verifyArtifact(traffic, manifest.artifacts.traffic, "traffic");
  verifyArtifact(timelineNdjson, manifest.artifacts.timeline, "timeline");

  const wal = parseNdjson(walNdjson, "wal", parseWalLine);
  const timeline = parseNdjson(timelineNdjson, "timeline", parseTimelineLine);
  if (wal.length !== timeline.length || timeline.length !== manifest.eventCount) {
    fail("EVENT_COUNT_MISMATCH", "manifest.eventCount", "stämmer inte med WAL och timeline");
  }

  let offset = 0;
  let byteEventCount = 0;
  let markerCount = 0;
  let rxEventCount = 0;
  let txEventCount = 0;
  let previousTime = -1;
  for (let index = 0; index < timeline.length; index += 1) {
    const expectedSequence = index + 1;
    const timelineEntry = timeline[index];
    const walEntry = wal[index];
    if (timelineEntry === undefined || walEntry === undefined) fail("EVENT_COUNT_MISMATCH", `timeline[${index}]`, "post saknas");
    if (timelineEntry.sequence !== expectedSequence || walEntry.sequence !== expectedSequence) {
      fail("INVALID_SEQUENCE", `timeline[${index}].sequence`, `måste vara ${expectedSequence}`);
    }
    if (timelineEntry.monotonicTimeUs < previousTime || walEntry.monotonicTimeUs < previousTime) {
      fail("INVALID_ORDER", `timeline[${index}].monotonicTimeUs`, "måste vara monotont icke-avtagande");
    }
    if (timelineEntry.type !== walEntry.type || timelineEntry.monotonicTimeUs !== walEntry.monotonicTimeUs) {
      fail("WAL_TIMELINE_MISMATCH", `timeline[${index}]`, "typ eller monotontid avviker från WAL");
    }
    if (timelineEntry.type === "marker" && walEntry.type === "marker") {
      if (timelineEntry.marker !== walEntry.marker) {
        fail("WAL_TIMELINE_MISMATCH", `timeline[${index}]`, "markören avviker från WAL");
      }
      markerCount += 1;
      previousTime = timelineEntry.monotonicTimeUs;
      continue;
    }
    if (timelineEntry.type !== "bytes" || walEntry.type !== "bytes") {
      fail("WAL_TIMELINE_MISMATCH", `timeline[${index}]`, "eventtypen avviker från WAL");
    }
    if (timelineEntry.direction !== walEntry.direction) {
      fail("WAL_TIMELINE_MISMATCH", `timeline[${index}].direction`, "riktningen avviker från WAL");
    }
    if (timelineEntry.offset !== offset || timelineEntry.offset + timelineEntry.length > traffic.byteLength) {
      fail("INVALID_RANGE", `timeline[${index}]`, "offset/längd är inte sammanhängande inom traffic.bin");
    }
    const chunk = traffic.slice(timelineEntry.offset, timelineEntry.offset + timelineEntry.length);
    if (sha256Hex(chunk) !== timelineEntry.sha256) {
      fail("CHUNK_HASH_MISMATCH", `timeline[${index}].sha256`, "avviker från traffic.bin");
    }
    const walBytes = decodeCaptureBytesBase64(walEntry.bytesBase64, `wal[${index}].bytesBase64`);
    if (walBytes.byteLength !== chunk.byteLength || walBytes.some((byte, byteIndex) => byte !== chunk[byteIndex])) {
      fail("WAL_TRAFFIC_MISMATCH", `wal[${index}].bytesBase64`, "avviker från traffic.bin");
    }
    if (timelineEntry.direction === "rx") rxEventCount += 1;
    else txEventCount += 1;
    byteEventCount += 1;
    previousTime = timelineEntry.monotonicTimeUs;
    offset += timelineEntry.length;
  }

  if (offset !== traffic.byteLength || traffic.byteLength !== manifest.byteCount) {
    fail("BYTE_COUNT_MISMATCH", "manifest.byteCount", "stämmer inte med traffic.bin och timeline");
  }
  if (rxEventCount !== manifest.rxEventCount || txEventCount !== manifest.txEventCount) {
    fail("EVENT_COUNT_MISMATCH", "manifest.rxEventCount", "riktningarnas antal stämmer inte");
  }
  if (byteEventCount !== manifest.byteEventCount || markerCount !== manifest.markerCount) {
    fail("EVENT_COUNT_MISMATCH", "manifest.byteEventCount", "byte- eller markörantalet stämmer inte");
  }
  const firstTime = timeline[0]?.monotonicTimeUs ?? null;
  const lastTime = timeline.at(-1)?.monotonicTimeUs ?? null;
  if (firstTime !== manifest.firstMonotonicTimeUs || lastTime !== manifest.lastMonotonicTimeUs) {
    fail("TIME_RANGE_MISMATCH", "manifest.firstMonotonicTimeUs", "stämmer inte med timeline");
  }

  return Object.freeze({ manifest, wal, walNdjson, traffic, timeline, timelineNdjson });
}

export function createCaptureManifestV1(input: CreateCaptureManifestV1Input): CaptureManifestV1 {
  const walNdjson = rawBytes(input.walNdjson, "wal");
  const traffic = input.traffic.slice();
  const timelineNdjson = rawBytes(input.timelineNdjson, "timeline");
  const timeline = parseNdjson(timelineNdjson, "timeline", parseTimelineLine);
  const byteEntries = timeline.filter((entry): entry is CaptureTimelineBytesEntryV1 => entry.type === "bytes");
  const rxEventCount = byteEntries.filter((entry) => entry.direction === "rx").length;
  const txEventCount = byteEntries.length - rxEventCount;
  const manifest: CaptureManifestV1 = {
    format: CAPTURE_FORMAT,
    formatVersion: CAPTURE_FORMAT_VERSION,
    sessionId: input.sessionId,
    transport: input.transport,
    synthetic: input.synthetic,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    firstMonotonicTimeUs: timeline[0]?.monotonicTimeUs ?? null,
    lastMonotonicTimeUs: timeline.at(-1)?.monotonicTimeUs ?? null,
    eventCount: timeline.length,
    byteEventCount: byteEntries.length,
    markerCount: timeline.length - byteEntries.length,
    rxEventCount,
    txEventCount,
    byteCount: traffic.byteLength,
    artifacts: {
      wal: { fileName: CAPTURE_FILE_NAMES.wal, byteLength: walNdjson.byteLength, sha256: sha256Hex(walNdjson) },
      traffic: { fileName: CAPTURE_FILE_NAMES.traffic, byteLength: traffic.byteLength, sha256: sha256Hex(traffic) },
      timeline: { fileName: CAPTURE_FILE_NAMES.timeline, byteLength: timelineNdjson.byteLength, sha256: sha256Hex(timelineNdjson) }
    }
  };
  return validateCaptureBundleV1({ manifest, walNdjson, traffic, timelineNdjson }).manifest;
}
