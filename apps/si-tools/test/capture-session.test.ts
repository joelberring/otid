import { chmod, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CAPTURE_FILE_NAMES, CaptureValidationError, sha256Hex } from "@o-tid/device-transport";

import {
  CAPTURE_WAL_QUARANTINE_FILE_NAME,
  CAPTURE_WAL_QUARANTINE_METADATA_FILE_NAME,
  CaptureSessionWriter,
  readValidatedCapture,
  recoverPartialCapture
} from "../src/capture-session.js";
import { replayCapture } from "../src/replay-command.js";

const transport = {
  kind: "node-serial" as const,
  path: "/dev/cu.synthetic-test",
  baudRate: 38_400,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: "none" as const,
  flowControl: "none" as const,
  vendorId: 0x10c4,
  productId: 0xea60
};

function deterministicClocks(): {
  readonly wallClock: () => Date;
  readonly monotonicNanos: () => bigint;
} {
  let wallCalls = 0;
  let nanos = 0n;
  return {
    wallClock: () => new Date(Date.UTC(2026, 7, 30, 12, 0, wallCalls++)),
    monotonicNanos: () => {
      const current = nanos;
      nanos += 1_000n;
      return current;
    }
  };
}

async function temporaryOutput(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "otid-capture-test-"));
}

describe("CaptureSessionWriter", () => {
  it("fsyncs a complete base64 WAL and derives exact traffic/timeline boundaries", async () => {
    const output = await temporaryOutput();
    const clocks = deterministicClocks();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "synthetic-complete",
      ...clocks
    });
    await writer.recordChunk("rx", Uint8Array.from([1, 2]));
    await writer.recordMarker("card-inserted");
    await writer.recordChunk("tx", Uint8Array.from([3]));
    const finalized = await writer.finalize();
    const capture = await readValidatedCapture(finalized.manifestPath);

    expect(capture.manifest.status).toBe("complete");
    expect(capture.manifest.transport).toEqual(transport);
    expect(capture.manifest.eventCount).toBe(3);
    expect(capture.manifest.byteEventCount).toBe(2);
    expect(capture.manifest.markerCount).toBe(1);
    expect([...capture.traffic]).toEqual([1, 2, 3]);
    expect(capture.wal).toEqual([
      { type: "bytes", sequence: 1, direction: "rx", monotonicTimeUs: 1, bytesBase64: "AQI=" },
      { type: "marker", sequence: 2, monotonicTimeUs: 2, marker: "card-inserted" },
      { type: "bytes", sequence: 3, direction: "tx", monotonicTimeUs: 3, bytesBase64: "Aw==" }
    ]);
    expect(capture.timeline).toEqual([
      expect.objectContaining({ type: "bytes", sequence: 1, offset: 0, length: 2 }),
      { type: "marker", sequence: 2, monotonicTimeUs: 2, marker: "card-inserted" },
      expect.objectContaining({ type: "bytes", sequence: 3, offset: 2, length: 1 })
    ]);

    expect((await stat(finalized.directory)).mode & 0o777).toBe(0o700);
    for (const fileName of [
      CAPTURE_FILE_NAMES.manifest,
      CAPTURE_FILE_NAMES.wal,
      CAPTURE_FILE_NAMES.traffic,
      CAPTURE_FILE_NAMES.timeline
    ]) {
      expect((await stat(path.join(finalized.directory, fileName))).mode & 0o777).toBe(0o600);
    }
  });

  it("recovers traffic and timeline exactly from an authoritative partial WAL", async () => {
    const output = await temporaryOutput();
    const clocks = deterministicClocks();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "recoverable",
      ...clocks
    });
    await writer.recordChunk("rx", Uint8Array.from([9, 8, 7]));
    await writer.recordMarker("card-removed");
    await writer.abort();
    await writeFile(path.join(writer.partialDirectory, CAPTURE_FILE_NAMES.traffic), Uint8Array.from([255]));
    await writeFile(path.join(writer.partialDirectory, CAPTURE_FILE_NAMES.timeline), "incomplete");

    const finalized = await recoverPartialCapture(writer.partialDirectory, clocks.wallClock);
    expect(finalized.capture.manifest.status).toBe("interrupted");
    expect([...finalized.capture.traffic]).toEqual([9, 8, 7]);
    expect(finalized.capture.manifest.markerCount).toBe(1);
  });

  it("finishes a committed session.json left inside a partial directory", async () => {
    const output = await temporaryOutput();
    const clocks = deterministicClocks();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "committed-partial",
      ...clocks
    });
    await writer.recordChunk("rx", Uint8Array.from([4]));
    const finalized = await writer.finalize();
    const partialAgain = `${finalized.directory}.partial`;
    await rename(finalized.directory, partialAgain);

    const recovered = await recoverPartialCapture(partialAgain, clocks.wallClock);
    expect(recovered.capture.manifest.status).toBe("complete");
    expect([...recovered.capture.traffic]).toEqual([4]);
  });

  it("recovers the longest valid WAL prefix and quarantines a truncated suffix byte-exactly", async () => {
    const output = await temporaryOutput();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "truncated-wal",
      ...deterministicClocks()
    });
    await writer.recordChunk("rx", Uint8Array.from([1, 2, 3]));
    await writer.recordChunk("rx", Uint8Array.from([4, 5, 6]));
    await writer.abort();
    const walPath = path.join(writer.partialDirectory, CAPTURE_FILE_NAMES.wal);
    const wal = await readFile(walPath);
    const firstNewline = wal.indexOf(0x0a);
    const validPrefix = wal.subarray(0, firstNewline + 1);
    const truncatedSuffix = wal.subarray(firstNewline + 1, wal.length - 7);
    await writeFile(walPath, Buffer.concat([validPrefix, truncatedSuffix]));

    const finalized = await recoverPartialCapture(writer.partialDirectory);
    expect([...finalized.capture.traffic]).toEqual([1, 2, 3]);
    expect(finalized.capture.manifest.eventCount).toBe(1);
    expect(await readFile(path.join(finalized.directory, CAPTURE_WAL_QUARANTINE_FILE_NAME))).toEqual(truncatedSuffix);
    expect(await readFile(path.join(finalized.directory, CAPTURE_FILE_NAMES.wal))).toEqual(validPrefix);
    expect((await stat(path.join(finalized.directory, CAPTURE_WAL_QUARANTINE_FILE_NAME))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(
      path.join(finalized.directory, CAPTURE_WAL_QUARANTINE_METADATA_FILE_NAME),
      "utf8"
    ))).toEqual({
      format: "o-tid-wal-quarantine",
      formatVersion: 1,
      byteLength: truncatedSuffix.byteLength,
      sha256: sha256Hex(truncatedSuffix)
    });
    expect((await stat(
      path.join(finalized.directory, CAPTURE_WAL_QUARANTINE_METADATA_FILE_NAME)
    )).mode & 0o777).toBe(0o600);
  });

  it("quarantines an invalid complete WAL line and every later byte without skipping ahead", async () => {
    const output = await temporaryOutput();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "invalid-wal-suffix",
      ...deterministicClocks()
    });
    await writer.recordChunk("rx", Uint8Array.from([7]));
    await writer.recordChunk("rx", Uint8Array.from([8]));
    await writer.abort();
    const walPath = path.join(writer.partialDirectory, CAPTURE_FILE_NAMES.wal);
    const wal = await readFile(walPath);
    const firstNewline = wal.indexOf(0x0a);
    const validPrefix = wal.subarray(0, firstNewline + 1);
    const invalidLine = Buffer.from('{"type":"marker","sequence":2,"monotonicTimeUs":2,"marker":"unknown"}\n');
    const invalidSuffix = Buffer.concat([invalidLine, wal.subarray(firstNewline + 1)]);
    await writeFile(walPath, Buffer.concat([validPrefix, invalidSuffix]));

    const finalized = await recoverPartialCapture(writer.partialDirectory);
    expect([...finalized.capture.traffic]).toEqual([7]);
    expect(finalized.capture.manifest.eventCount).toBe(1);
    expect(await readFile(path.join(finalized.directory, CAPTURE_WAL_QUARANTINE_FILE_NAME))).toEqual(invalidSuffix);
  });

  it("detects final artifact mutation and never overwrites an existing session", async () => {
    const output = await temporaryOutput();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "no-overwrite",
      ...deterministicClocks()
    });
    await writer.recordChunk("rx", Uint8Array.from([1]));
    const finalized = await writer.finalize();

    await expect(CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "no-overwrite"
    })).rejects.toThrow("already exists");

    await chmod(path.join(finalized.directory, CAPTURE_FILE_NAMES.traffic), 0o600);
    await writeFile(path.join(finalized.directory, CAPTURE_FILE_NAMES.traffic), Uint8Array.from([2]));
    await expect(readValidatedCapture(finalized.manifestPath)).rejects.toBeInstanceOf(CaptureValidationError);
  });

  it("produces the same replay JSON summary on every run and emits only rx chunks", async () => {
    const output = await temporaryOutput();
    const writer = await CaptureSessionWriter.create({
      outputDirectory: output,
      transport,
      synthetic: true,
      sessionId: "deterministic-replay",
      ...deterministicClocks()
    });
    await writer.recordChunk("rx", Uint8Array.from([1, 2]));
    await writer.recordChunk("tx", Uint8Array.from([99]));
    await writer.recordChunk("rx", Uint8Array.from([3]));
    const finalized = await writer.finalize();

    const first = await replayCapture(finalized.manifestPath);
    for (let run = 1; run < 100; run += 1) {
      await expect(replayCapture(finalized.manifestPath)).resolves.toEqual(first);
    }
    expect(first.emittedRxEventCount).toBe(2);
    expect(first.emittedRxByteCount).toBe(3);
    expect(first.capturedByteCount).toBe(4);
  });
});
