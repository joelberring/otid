import { describe, expect, it } from "vitest";
import {
  applyMapRevision, objectRefOf, readMapFile, sha256Hex, type MapObject, type MapRevisionChange, type ObjectRef, type ParsedMap
} from "../src";
import { buildOcd, buildOcd8, ocdCoord } from "./ocd-builder";
import { SPEC } from "./ocd-spec";

/** ADR-0219 K7: OCAD-filer (version 9+) lappas bakom flaggan `ocad`. */
const AT = "2026-11-09T10:00:00.000Z";
const meta = { author: "a1", at: AT };

function setup(version = 2018, extra: Parameters<typeof buildOcd>[0]["objects"] = []) {
  const bytes = buildOcd({ ...SPEC, version, objects: [...SPEC.objects!, ...extra] });
  const map = readMapFile(bytes, "karta.ocd", { sources: true });
  const sha = sha256Hex(bytes);
  const ref = (predicate: (object: MapObject) => boolean): ObjectRef => objectRefOf(sha, map.objects.find(predicate)!)!;
  return { bytes, map, sha, ref };
}
const reread = (bytes: Uint8Array): ParsedMap => readMapFile(bytes, "ny.ocd", { sources: true });
const run = (bytes: Uint8Array, sha: string, changes: MapRevisionChange[]) => applyMapRevision(bytes, { baseFileSha256: sha, format: "OCD", changes }, { ocad: true });

describe("OCAD-revidering (K7)", () => {
  it("vägras utan flaggan och för version 8; en tom sats ger samma bytes", () => {
    const { bytes, sha } = setup();
    expect(applyMapRevision(bytes, { baseFileSha256: sha, format: "OCD", changes: [] })).toMatchObject({ ok: false, refusals: [{ code: "UNSUPPORTED_VERSION" }] });
    const empty = run(bytes, sha, []);
    expect(empty.ok && Buffer.from(empty.bytes).equals(Buffer.from(bytes))).toBe(true);
    const old = buildOcd8({ objects: [] });
    expect(run(old, sha256Hex(old), [])).toMatchObject({ ok: false, refusals: [{ code: "UNSUPPORTED_VERSION" }] });
  });

  for (const version of [2018, 11, 9]) {
    it(`ändrar, tar bort och lägger till, och läser tillbaka det (version ${version})`, () => {
      const { bytes, map, sha, ref } = setup(version);
      const contour = ref(object => object.kind === "line" && object.symbol === "101000");
      const dot = ref(object => object.kind === "point");
      const text = ref(object => object.kind === "text");
      const forest = ref(object => object.kind === "area");
      const changes: MapRevisionChange[] = [
        // Linjen: ny sista punkt (posten blir längre och läggs sist), kurvan och första punkten som förut.
        { ...meta, kind: "modify", ref: contour, geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 },
          { type: "C", x1: 1, y1: 0, x2: 2, y2: 1, x: 2, y: 2 }, { type: "L", x: 3, y: 2, corner: true, gap: 1 }, { type: "L", x: 4.5, y: 2.25 }] } },
        // Punkten: flyttad och vriden (samma längd, skrivs på samma plats).
        { ...meta, kind: "modify", ref: dot, geometry: { kind: "point", at: { x: 7, y: 8 } }, angle: 45 },
        { ...meta, kind: "modify", ref: text, text: "Södra\nporten" },
        { ...meta, kind: "delete", ref: forest },
        { ...meta, kind: "add", id: "ny-yta", symbol: "406000", geometry: { kind: "area", rings: [
          [{ type: "M", x: 20, y: 20 }, { type: "L", x: 30, y: 20 }, { type: "L", x: 30, y: 30 }],
          [{ type: "M", x: 22, y: 22 }, { type: "L", x: 24, y: 22 }, { type: "L", x: 24, y: 24 }]] } },
        { ...meta, kind: "add", id: "ny-punkt", symbol: "105100", geometry: { kind: "point", at: { x: -5, y: 1.234 } }, angle: 10 }
      ];
      const result = run(bytes, sha, changes);
      if (!result.ok) throw new Error(JSON.stringify(result.refusals));
      expect(result.report).toMatchObject({ format: "OCD", modified: 3, deleted: 1, added: 2 });
      // Originalet är oförändrat och den nya filen börjar med originalets längd.
      expect(sha256Hex(bytes)).toBe(sha);
      const after = reread(result.bytes);
      expect(after.objects).toHaveLength(map.objects.length - 1 + 2);
      const line = after.objects.find(object => object.kind === "line" && object.symbol === "101000" && object.path.length === 4);
      // Luckan gäller sträckan fram till punkten (modellens sätt), hörnet punkten.
      expect(line?.kind === "line" && line.path[2]).toMatchObject({ type: "L", x: 3, y: 2, corner: true, gap: 1 });
      expect(line?.kind === "line" && line.path[3]?.gap).toBeUndefined();
      expect(after.objects.find(object => object.kind === "point" && object.symbol === "105100" && object.at.x === 7)).toMatchObject({ angle: 45 });
      expect(after.objects.find(object => object.kind === "text")).toMatchObject({ text: "Södra\nporten" });
      const areas = after.objects.filter(object => object.kind === "area");
      expect(areas).toHaveLength(1);
      expect(areas[0]!.kind === "area" && areas[0]!.rings.map(ring => ring.length)).toEqual([3, 3]);
      expect(after.objects.find(object => object.kind === "point" && object.at.x === -5)).toMatchObject({ at: { y: 1.23 }, angle: 10 });
      expect(result.report.addedObjects.map(row => row.id)).toEqual(["ny-yta", "ny-punkt"]);
      // Det enda som ändrats i originalets bytes är objekt och indexposter.
      expect(result.report.edits.every(edit => edit.start >= bytes.length || edit.what.startsWith("index") || edit.what === "object")).toBe(true);
    });
  }

  it("behåller okända flaggbitar på punkter som inte ändrats", () => {
    const { bytes, sha, map } = setup(2018, [{ symbol: 101000, type: 2, coords: [ocdCoord(0, 5000, 16), ocdCoord(100, 5000, 0, 32), ocdCoord(200, 5000)] }]);
    const object = map.objects.find(row => row.kind === "line" && row.path[0]!.y === 50)!;
    const ref = objectRefOf(sha, object)!;
    const result = run(bytes, sha, [{ ...meta, kind: "modify", ref, geometry: { kind: "line", path: [{ type: "M", x: 0, y: 50 }, { type: "L", x: 1, y: 50 },
      { type: "L", x: 2.5, y: 50 }] } }]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    const at = ref.locator.format === "OCD" ? ref.locator.offset : 0;
    expect(view.getInt32(at + 56, true) & 0xff).toBe(16);
    expect(view.getInt32(at + 56 + 12, true) & 0xff).toBe(32);
    expect(view.getInt32(at + 56 + 16, true) >> 8).toBe(250);
  });

  it("ett fullt indexblock får ett nytt block länkat sist", () => {
    const filler = Array.from({ length: 256 - SPEC.objects!.length }, (_, i) => ({ symbol: 105100, type: 1, coords: [ocdCoord(i, 0)] }));
    const { bytes, sha, map } = setup(2018, filler);
    const result = run(bytes, sha, [{ ...meta, kind: "add", id: "sist", symbol: "101000", geometry: { kind: "line", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 2, y: 2 }] } }]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    expect(result.report.addedObjects[0]!.locator).toMatchObject({ format: "OCD", block: 1, slot: 0 });
    expect(reread(result.bytes).objects).toHaveLength(map.objects.length + 1);
    expect(result.report.edits.some(edit => edit.what === "next-block")).toBe(true);
  });

  it("vägrar ett objekt som ändrats i filen, fel symbol och nya texter", () => {
    const { bytes, sha, ref } = setup();
    const contour = ref(object => object.kind === "line");
    expect(run(bytes, sha, [{ ...meta, kind: "delete", ref: { ...contour, objectHash: "0".repeat(64) } }]))
      .toMatchObject({ ok: false, refusals: [{ code: "OBJECT_MISMATCH" }] });
    expect(run(bytes, sha, [{ ...meta, kind: "modify", ref: contour, symbol: "105100" }])).toMatchObject({ ok: false, refusals: [{ code: "INVALID_CHANGE" }] });
    expect(run(bytes, sha, [{ ...meta, kind: "add", id: "t", symbol: "902000", geometry: { kind: "text", at: { x: 0, y: 0 } }, text: "Hej" }]))
      .toMatchObject({ ok: false, refusals: [{ code: "INVALID_CHANGE" }] });
  });
});
