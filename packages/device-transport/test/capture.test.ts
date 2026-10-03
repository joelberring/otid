import { describe, expect, it } from "vitest";
import {
  CaptureValidationError,
  createCaptureManifestV1,
  decodeCaptureBytesBase64,
  parseCaptureTimelineNdjson,
  sha256Hex,
  validateCaptureBundleV1
} from "../src";
import { makeCapture } from "./capture-fixture";

const events = [
  { type: "marker", marker: "card-inserted", at: 100 },
  { type: "bytes", direction: "tx", at: 120, bytes: [0x01, 0x02] },
  { type: "bytes", direction: "rx", at: 150, bytes: [0x03, 0x04, 0x05] },
  { type: "marker", marker: "card-removed", at: 180 }
] as const;

describe("captureformat v1", () => {
  it("validerar bytes, markörer, metadata och defensiva kopior", () => {
    const source = makeCapture(events);
    const validated = validateCaptureBundleV1(source);
    expect(validated.manifest).toMatchObject({
      eventCount: 4,
      byteEventCount: 2,
      markerCount: 2,
      rxEventCount: 1,
      txEventCount: 1,
      byteCount: 5,
      synthetic: true,
      status: "complete",
      transport: {
        kind: "node-serial", path: "/dev/cu.test", baudRate: 38400,
        dataBits: 8, stopBits: 1, parity: "none", flowControl: "none"
      }
    });
    expect(validated.timeline.map((entry) => entry.type)).toEqual(["marker", "bytes", "bytes", "marker"]);
    source.traffic[0] = 0xff;
    expect([...validated.traffic]).toEqual([1, 2, 3, 4, 5]);
  });

  it("avvisar okända och fritextbärande markörer", () => {
    expect(() => parseCaptureTimelineNdjson(
      '{"type":"marker","sequence":1,"monotonicTimeUs":0,"marker":"manual","label":"namn"}\n'
    )).toThrow(CaptureValidationError);
  });

  it("avvisar icke-monoton ordning även när artefakthashen byggs om", () => {
    const source = makeCapture(events);
    const timeline = source.timelineNdjson.toString().replace('"monotonicTimeUs":150', '"monotonicTimeUs":110');
    expect(() => createCaptureManifestV1({
      sessionId: "session-001",
      transport: {
        kind: "node-serial", path: "/dev/cu.test", baudRate: 38400,
        dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", vendorId: null, productId: null
      },
      synthetic: true,
      status: "complete",
      startedAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:00:01.000Z",
      walNdjson: source.walNdjson,
      traffic: source.traffic,
      timelineNdjson: timeline
    })).toThrow(/monotont/);
  });

  it("avvisar överlappande eller hoppande byteintervall", () => {
    const source = makeCapture(events);
    const timeline = source.timelineNdjson.toString().replace('"offset":2', '"offset":1');
    expect(() => createCaptureManifestV1({
      sessionId: "session-001",
      transport: {
        kind: "node-serial", path: "/dev/cu.test", baudRate: 38400,
        dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", vendorId: null, productId: null
      },
      synthetic: true,
      status: "complete",
      startedAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:00:01.000Z",
      walNdjson: source.walNdjson,
      traffic: source.traffic,
      timelineNdjson: timeline
    })).toThrow(/offset\/längd/);
  });

  it("upptäcker ändrad traffic före semantisk replay", () => {
    const source = makeCapture(events);
    source.traffic[2] = 0xff;
    expect(() => validateCaptureBundleV1(source)).toThrow(/SHA-256/);
  });

  it("har strikt base64 och korrekt SHA-256", () => {
    expect([...decodeCaptureBytesBase64("AQID")]).toEqual([1, 2, 3]);
    expect(() => decodeCaptureBytesBase64("AQI")).toThrow(/base64/);
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});
