import {
  createCaptureManifestV1,
  encodeCaptureBytesBase64,
  encodeCaptureTimelineNdjson,
  encodeCaptureWalNdjson,
  sha256Hex,
  type CaptureDirection,
  type CaptureMarkerKind,
  type CaptureTimelineEntryV1,
  type CaptureWalEntryV1,
  type LoadedCaptureV1
} from "../src";

export type FixtureEvent =
  | { readonly type: "bytes"; readonly direction: CaptureDirection; readonly at: number; readonly bytes: readonly number[] }
  | { readonly type: "marker"; readonly marker: CaptureMarkerKind; readonly at: number };

export function makeCapture(events: readonly FixtureEvent[]): LoadedCaptureV1 {
  const chunks = events.filter((event) => event.type === "bytes").map((event) => Uint8Array.from(event.bytes));
  const traffic = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  const wal: CaptureWalEntryV1[] = [];
  const timeline: CaptureTimelineEntryV1[] = [];
  let offset = 0;
  let chunkIndex = 0;
  for (const [index, event] of events.entries()) {
    const sequence = index + 1;
    if (event.type === "marker") {
      wal.push({ type: "marker", sequence, monotonicTimeUs: event.at, marker: event.marker });
      timeline.push({ type: "marker", sequence, monotonicTimeUs: event.at, marker: event.marker });
      continue;
    }
    const chunk = chunks[chunkIndex++];
    if (chunk === undefined) throw new Error("Testfixture saknar chunk");
    traffic.set(chunk, offset);
    wal.push({
      type: "bytes",
      sequence,
      direction: event.direction,
      monotonicTimeUs: event.at,
      bytesBase64: encodeCaptureBytesBase64(chunk)
    });
    timeline.push({
      type: "bytes",
      sequence,
      direction: event.direction,
      monotonicTimeUs: event.at,
      offset,
      length: chunk.byteLength,
      sha256: sha256Hex(chunk)
    });
    offset += chunk.byteLength;
  }
  const walNdjson = encodeCaptureWalNdjson(wal);
  const timelineNdjson = encodeCaptureTimelineNdjson(timeline);
  const metadata = {
    sessionId: "session-001",
    transport: {
      kind: "node-serial" as const,
      path: "/dev/cu.test",
      baudRate: 38400,
      dataBits: 8 as const,
      stopBits: 1 as const,
      parity: "none" as const,
      flowControl: "none" as const,
      vendorId: null,
      productId: null
    },
    synthetic: true,
    status: "complete" as const,
    startedAt: "2026-08-30T10:00:00.000Z",
    completedAt: "2026-08-30T10:00:01.000Z"
  };
  const manifest = createCaptureManifestV1({ ...metadata, walNdjson, traffic, timelineNdjson });
  return { manifest, walNdjson, traffic, timelineNdjson };
}
