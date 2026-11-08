import { describe, expect, it } from "vitest";
import { joinSegments, parseGpx, simplifyTrack, trackLengthM, trackParts, type RawPoint } from "./map-project-tracks";

/** ADR-0219 K3: GPX, förenkling och delar. */
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Klocka" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Metadata</name></metadata>
  <trk><name>Kungshatt &amp; holmarna</name>
    <trkseg>
      <trkpt lat="59.3000" lon="17.9000"><ele>10</ele><time>2026-11-08T08:00:00Z</time></trkpt>
      <trkpt lat="59.3001" lon="17.9000"><time>2026-11-08T08:00:05Z</time><hdop>1.2</hdop></trkpt>
      <trkpt lat='59.3002' lon='17.9000'/>
      <trkpt lat="99" lon="17.9"><time>2026-11-08T08:00:10Z</time></trkpt>
    </trkseg>
    <trkseg><trkpt lat="59.3100" lon="17.9100"><time>2026-11-08T09:00:00Z</time></trkpt></trkseg>
  </trk>
</gpx>`;

describe("GPX och spårens punkter (K3)", () => {
  it("läser segmenten, tiden från första punkten, hdop och namnet; ogiltiga punkter hoppas över", () => {
    const parsed = parseGpx(GPX);
    expect(parsed.name).toBe("Kungshatt & holmarna");
    expect(parsed.startedAt).toBe("2026-11-08T08:00:00.000Z");
    expect(parsed.segments.map(segment => segment.length)).toEqual([3, 1]);
    expect(parsed.segments[0]![0]).toEqual([59.3, 17.9, 0, 8]);
    expect(parsed.segments[0]![1]).toEqual([59.3001, 17.9, 5, 6]);
    // Punkt utan tid: dess plats i segmentet.
    expect(parsed.segments[0]![2]![2]).toBe(2);
    expect(parsed.segments[1]![0]![2]).toBe(3600);
    expect(() => parseGpx("<kml></kml>")).toThrow();
  });

  it("förenklar en rak linje till ändarna och behåller ett hörn", () => {
    const straight: RawPoint[] = Array.from({ length: 40 }, (_, i) => [59.3 + i * 0.00001, 17.9, i, 5]);
    expect(simplifyTrack(straight)).toHaveLength(2);
    const corner: RawPoint[] = [...straight.slice(0, 25), ...Array.from({ length: 25 }, (_, i): RawPoint => [59.30025, 17.9 + (i + 1) * 0.00002, 25 + i, 5])];
    const kept = simplifyTrack(corner);
    expect(kept.length).toBe(3);
    expect(joinSegments([straight, corner]).length).toBe(5);
    // 39 steg om 0,00001° latitud ≈ 43 m.
    expect(trackLengthM(straight)).toBeGreaterThan(40);
    expect(trackLengthM(straight)).toBeLessThan(46);
  });

  it("en lång rak sträcka får mellanpunkter (ingen lucka i spåret)", () => {
    // 1 000 punkter på 1,1 km rakt norrut: högst 50 m mellan de som behålls.
    const long: RawPoint[] = Array.from({ length: 1000 }, (_, i) => [59.3 + i * 0.00001, 17.9, i, 5]);
    const kept = simplifyTrack(long);
    expect(kept.length).toBeGreaterThan(20);
    expect(kept.length).toBeLessThan(60);
    for (let i = 1; i < kept.length; i += 1) expect(trackLengthM([kept[i - 1]!, kept[i]!])).toBeLessThanOrEqual(50);
  });

  it("delar om 2 000 punkter", () => {
    const many: RawPoint[] = Array.from({ length: 4500 }, (_, i) => [59.3, 17.9, i, 5]);
    expect(trackParts(many).map(part => part.length)).toEqual([2000, 2000, 500]);
    expect(trackParts([])).toEqual([]);
  });
});
