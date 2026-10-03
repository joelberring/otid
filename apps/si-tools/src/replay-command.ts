import { ReplayTransport, sha256Hex } from "@o-tid/device-transport";

import { readValidatedCapture } from "./capture-session.js";

export interface ReplaySummary {
  readonly format: "o-tid-raw-capture";
  readonly formatVersion: 1;
  readonly sessionId: string;
  readonly captureStatus: "complete" | "interrupted" | "error";
  readonly synthetic: boolean;
  readonly eventCount: number;
  readonly byteEventCount: number;
  readonly markerCount: number;
  readonly rxEventCount: number;
  readonly txEventCount: number;
  readonly capturedByteCount: number;
  readonly emittedRxEventCount: number;
  readonly emittedRxByteCount: number;
  readonly emittedRxSha256: string;
  readonly walSha256: string;
  readonly trafficSha256: string;
  readonly timelineSha256: string;
  readonly summarySha256: string;
}

export async function replayCapture(manifestPath: string): Promise<ReplaySummary> {
  const capture = await readValidatedCapture(manifestPath);
  const transport = new ReplayTransport({
    manifest: capture.manifest,
    walNdjson: capture.walNdjson,
    traffic: capture.traffic,
    timelineNdjson: capture.timelineNdjson
  });
  const received: Uint8Array[] = [];
  const unsubscribe = transport.onBytes((chunk) => received.push(Uint8Array.from(chunk)));
  try {
    await transport.open();
  } finally {
    unsubscribe();
    await transport.close();
  }
  const emitted = Buffer.concat(received.map((chunk) => Buffer.from(chunk)));
  const core = {
    format: capture.manifest.format,
    formatVersion: capture.manifest.formatVersion,
    sessionId: capture.manifest.sessionId,
    captureStatus: capture.manifest.status,
    synthetic: capture.manifest.synthetic,
    eventCount: capture.manifest.eventCount,
    byteEventCount: capture.manifest.byteEventCount,
    markerCount: capture.manifest.markerCount,
    rxEventCount: capture.manifest.rxEventCount,
    txEventCount: capture.manifest.txEventCount,
    capturedByteCount: capture.manifest.byteCount,
    emittedRxEventCount: received.length,
    emittedRxByteCount: emitted.byteLength,
    emittedRxSha256: sha256Hex(emitted),
    walSha256: capture.manifest.artifacts.wal.sha256,
    trafficSha256: capture.manifest.artifacts.traffic.sha256,
    timelineSha256: capture.manifest.artifacts.timeline.sha256
  } as const;
  return {
    ...core,
    summarySha256: sha256Hex(new TextEncoder().encode(JSON.stringify(core)))
  };
}

export async function runReplayCommand(manifestPath: string): Promise<string> {
  return JSON.stringify(await replayCapture(manifestPath));
}
