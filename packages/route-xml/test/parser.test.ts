import { describe, expect, it } from "vitest";
import { GpxValidationError, MAX_GPX_BYTES, MAX_POINTS, MAX_SEGMENTS, parseGpxTrack } from "../src";

const encoder = new TextEncoder();

function bytes(source: string): Uint8Array {
  return encoder.encode(source);
}

function track(points: string, attributes = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"${attributes}><trk><trkseg>${points}</trkseg></trk></gpx>`;
}

describe("parseGpxTrack", () => {
  it("tolkar ordnade WGS84-trackpunkter med valfri höjd och UTC-tid", () => {
    expect(parseGpxTrack(bytes(track(
      '<trkpt lat="59.321" lon="18.071"><ele>15.5</ele><time>2026-09-20T10:01:02+02:00</time></trkpt><trkpt lat="59.322" lon="18.072" />'
    )))).toEqual({
      parser: "otid-gpx-1.1",
      segmentCount: 1,
      points: [
        { segment: 0, latitude: 59.321, longitude: 18.071, elevationMeters: 15.5, recordedAt: "2026-09-20T08:01:02.000Z" },
        { segment: 0, latitude: 59.322, longitude: 18.072 }
      ]
    });
  });

  it.each([
    ["DOCTYPE", '<!DOCTYPE gpx [<!ENTITY x "x">]>' + track('<trkpt lat="59" lon="18"/><trkpt lat="60" lon="19"/>')],
    ["ruttplan", '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><rte/><trk><trkseg><trkpt lat="59" lon="18"/><trkpt lat="60" lon="19"/></trkseg></trk></gpx>'],
    ["fel namnrymd", track('<trkpt lat="59" lon="18"/><trkpt lat="60" lon="19"/>').replace("http://www.topografix.com/GPX/1/1", "https://example.test/gpx")],
    ["fel koordinat", track('<trkpt lat="91" lon="18"/><trkpt lat="60" lon="19"/>')],
    ["tid utan offset", track('<trkpt lat="59" lon="18"><time>2026-09-20T10:01:02</time></trkpt><trkpt lat="60" lon="19"/>')]
  ])("avvisar %s", (_description, source) => {
    expect(() => parseGpxTrack(bytes(source))).toThrow(GpxValidationError);
  });

  it("begränsar bytes, segment och punkter", () => {
    expect(() => parseGpxTrack(new Uint8Array(MAX_GPX_BYTES + 1))).toThrow(/högst/);
    const segments = Array.from({ length: MAX_SEGMENTS + 1 }, () => "<trkseg><trkpt lat=\"59\" lon=\"18\"/></trkseg>").join("");
    expect(() => parseGpxTrack(bytes(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk>${segments}</trk></gpx>`))).toThrow(/segment/);
    const points = Array.from({ length: MAX_POINTS + 1 }, () => '<trkpt lat="59" lon="18"/>').join("");
    expect(() => parseGpxTrack(bytes(track(points)))).toThrow(/trackpunkter/);
  });
});
