import { describe, expect, it } from "vitest";
import {
  applyMapRevision, objectRefOf, readMapFile, sha256Hex, type MapObject, type MapRevisionChange, type ObjectRef, type ParsedMap
} from "../src";
import { moveCommand } from "../src/geometry";
import { verifyOcd } from "../src/revision/ocd-verify";
import { applyOcdRevision } from "../src/revision/ocd-write";
import { buildOcd, buildOcd8, concat, element, ocdCoord, symbolBody } from "./ocd-builder";
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

  it("vägrar ett objekt som ändrats i filen, fel symbol och tomma nya texter", () => {
    const { bytes, sha, ref } = setup();
    const contour = ref(object => object.kind === "line");
    expect(run(bytes, sha, [{ ...meta, kind: "delete", ref: { ...contour, objectHash: "0".repeat(64) } }]))
      .toMatchObject({ ok: false, refusals: [{ code: "OBJECT_MISMATCH" }] });
    expect(run(bytes, sha, [{ ...meta, kind: "modify", ref: contour, symbol: "105100" }])).toMatchObject({ ok: false, refusals: [{ code: "INVALID_CHANGE" }] });
    expect(run(bytes, sha, [{ ...meta, kind: "add", id: "t", symbol: "902000", geometry: { kind: "text", at: { x: 0, y: 0 } }, text: "   " }]))
      .toMatchObject({ ok: false, refusals: [{ code: "INVALID_CHANGE" }] });
  });

  it("deduplicerar upprepade ändringar på samma objekt (sista ändringen vinner)", () => {
    const { bytes, sha, ref } = setup(2018);
    const dot = ref(object => object.kind === "point");
    const forest = ref(object => object.kind === "area");
    const result = applyOcdRevision(bytes, {
      baseFileSha256: sha,
      format: "OCD",
      changes: [
        { ...meta, kind: "modify", ref: dot, geometry: { kind: "point", at: { x: 1, y: 2 } }, angle: 10 },
        { ...meta, kind: "modify", ref: dot, geometry: { kind: "point", at: { x: 7, y: 8 } }, angle: 90 },
        { ...meta, kind: "modify", ref: forest, angle: 15 },
        { ...meta, kind: "delete", ref: forest }
      ]
    }, sha);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    expect(result.report).toMatchObject({ modified: 1, deleted: 1, added: 0 });
    const after = reread(result.bytes);
    expect(after.objects.find(object => object.kind === "point" && object.symbol === "105100")).toMatchObject({ at: { x: 7, y: 8 }, angle: 90 });
    expect(after.objects.filter(object => object.kind === "area")).toHaveLength(0);
  });

  it("behåller styrpunkter (dash) och okända flaggbitar även när punkter läggs till före dem", () => {
    const { bytes, sha, map } = setup(2018, [{ symbol: 101000, type: 2,
      coords: [ocdCoord(0, 6000, 0, 8), ocdCoord(100, 6000, 16, 32 | 8), ocdCoord(200, 6000, 64, 1)] }]);
    const object = map.objects.find(row => row.kind === "line" && row.path[0]!.y === 60)!;
    const ref = objectRefOf(sha, object)!;
    // Lägg in en ny punkt först (skiftar alla efterföljande index).
    const result = run(bytes, sha, [{ ...meta, kind: "modify", ref, geometry: { kind: "line", path: [
      { type: "M", x: -1, y: 60 }, { type: "L", x: 0, y: 60, dash: true }, { type: "L", x: 1, y: 60, dash: true }, { type: "L", x: 2, y: 60, corner: true }
    ] } }]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const after = reread(result.bytes);
    const updated = after.objects.find(row => row.kind === "line" && row.path[0]!.y === 60)!;
    expect(updated.kind === "line" && updated.path.map(c => [c.x, Boolean(c.dash), Boolean(c.corner)])).toEqual([
      [-1, false, false], [0, true, false], [1, true, false], [2, false, true]
    ]);
    const at = updated.source?.locator.format === "OCD" ? updated.source.locator.offset : 0;
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    // Punkt 2 (x=100) och punkt 3 (x=200) har kvar sina höga flaggbitar (16/32 resp. 64).
    expect(view.getInt32(at + 56 + 16, true) & 0xff).toBe(16);
    expect(view.getInt32(at + 56 + 20, true) & 0xff).toBe(32 | 8);
    expect(view.getInt32(at + 56 + 24, true) & 0xff).toBe(64);
  });

  it("vägrar v12-objekt med nDatabaseString > 0 och nollställer objekt-specifika fält på nya objekt", () => {
    const { bytes, ref } = setup(2018);
    const contour = ref(object => object.kind === "line" && object.symbol === "101000");
    const withDb = bytes.slice();
    const at = contour.locator.format === "OCD" ? contour.locator.offset : 0;
    const view = new DataView(withDb.buffer, withDb.byteOffset);
    view.setUint16(at + 52, 1, true); // nDatabaseString = 1
    const dbSha = sha256Hex(withDb);
    const dbRef = objectRefOf(dbSha, reread(withDb).objects.find(object => object.kind === "line" && object.symbol === "101000")!)!;
    expect(run(withDb, dbSha, [{ ...meta, kind: "delete", ref: dbRef }])).toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });

    // Sätt ServerObjectId, MultirepresentationId och LineWidth på mallobjektet och lägg till ett nytt objekt.
    const dirty = bytes.slice();
    const dv = new DataView(dirty.buffer, dirty.byteOffset);
    dv.setInt16(at + 12, 42, true);
    dv.setInt32(at + 16, 9999, true);
    dv.setUint32(at + 32, 777, true);
    const added = run(dirty, sha256Hex(dirty), [{ ...meta, kind: "add", id: "ren", symbol: "101000",
      geometry: { kind: "line", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 2, y: 2 }] } }]);
    if (!added.ok) throw new Error(JSON.stringify(added.refusals));
    const newLoc = added.report.addedObjects[0]!.locator;
    const newAt = newLoc.format === "OCD" ? newLoc.offset : 0;
    const nv = new DataView(added.bytes.buffer, added.bytes.byteOffset);
    expect(nv.getInt16(newAt + 12, true)).toBe(0);
    expect(nv.getInt32(newAt + 16, true)).toBe(0);
    expect(nv.getUint32(newAt + 32, true)).toBe(0);
    expect(nv.getUint16(newAt + 52, true)).toBe(0);
  });

  it("sätter icke-tom bbox för punktobjekt, undviker dubblett-stängningspunkt på raka ytor och nollställer överskott vid krympning", () => {
    const { bytes, sha, ref } = setup(2018, [{ symbol: 101000, type: 7,
      coords: [ocdCoord(0, 0), ocdCoord(100, 0), ocdCoord(100, 100), ocdCoord(0, 100)] }]);
    const rectObj = ref(object => object.kind === "line" && object.path.length === 4);
    const result = run(bytes, sha, [
      // Lägg till ett punktobjekt: indexets bbox ska inte vara 0×0.
      { ...meta, kind: "add", id: "p1", symbol: "105100", geometry: { kind: "point", at: { x: 5, y: 5 } } },
      // Lägg till en rak yta med 3 punkter: exakt 3 koordinater i OCAD (ingen extra dubblettpunkt).
      { ...meta, kind: "add", id: "a1", symbol: "406000", geometry: { kind: "area", rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }]] } },
      // Ändra rektangelns (type=7) geometri och krymp från 4 till 2 punkter: type=7 bevaras och restbytes nollas.
      { ...meta, kind: "modify", ref: rectObj, geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }] } }
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    const firstBlock = view.getUint32(12, true);
    const pLoc = result.report.addedObjects.find(r => r.id === "p1")!.locator;
    if (pLoc.format !== "OCD") throw new Error();
    const pEntry = firstBlock + 4 + pLoc.slot * 40;
    expect(view.getInt32(pEntry + 8, true) >> 8).toBeGreaterThan(view.getInt32(pEntry, true) >> 8);
    expect(view.getInt32(pEntry + 12, true) >> 8).toBeGreaterThan(view.getInt32(pEntry + 4, true) >> 8);
    const aLoc = result.report.addedObjects.find(r => r.id === "a1")!.locator;
    if (aLoc.format !== "OCD") throw new Error();
    expect(view.getUint32(aLoc.offset + 44, true)).toBe(3);
    // Rektangel bevarar type = 7 och krympt plats har nollställda överskottsbytes.
    if (rectObj.locator.format !== "OCD") throw new Error();
    const rEntry = firstBlock + 4 + rectObj.locator.slot * 40;
    expect(view.getUint8(rEntry + 28)).toBe(7);
    expect(view.getUint8(rectObj.locator.offset + 4)).toBe(7);
    expect(result.bytes.subarray(rectObj.locator.offset + 56 + 16, rectObj.locator.offset + rectObj.locator.length).every(b => b === 0)).toBe(true);
    // moveCommand behåller flaggor (corner, dash, gap).
    expect(moveCommand({ type: "L", x: 1, y: 2, corner: true, dash: true, gap: 3 }, 5, -1))
      .toEqual({ type: "L", x: 6, y: 1, corner: true, dash: true, gap: 3 });
  });

  it("behåller övre flaggnibbeln (0xf0) på en punkt vars styrpunktsflagga (dash) växlas", () => {
    const { bytes, sha, map } = setup(2018, [{
      symbol: 101000,
      type: 2,
      coords: [ocdCoord(0, 7000), ocdCoord(100, 7000, 0x20, 0x40), ocdCoord(200, 7000)]
    }]);
    const object = map.objects.find(row => row.kind === "line" && row.path[0]!.y === 70)!;
    const ref = objectRefOf(sha, object)!;
    // Växla dash på mittpunkten utan att flytta dess koordinat (1, 70).
    const toggledOn = run(bytes, sha, [{
      ...meta,
      kind: "modify",
      ref,
      geometry: {
        kind: "line",
        path: [{ type: "M", x: 0, y: 70 }, { type: "L", x: 1, y: 70, dash: true }, { type: "L", x: 2, y: 70 }]
      }
    }]);
    if (!toggledOn.ok) throw new Error(JSON.stringify(toggledOn.refusals));
    const at = ref.locator.format === "OCD" ? ref.locator.offset : 0;
    const viewOn = new DataView(toggledOn.bytes.buffer, toggledOn.bytes.byteOffset);
    expect(viewOn.getInt32(at + 56 + 8, true) & 0xff).toBe(0x20);
    expect(viewOn.getInt32(at + 56 + 12, true) & 0xff).toBe(0x48);

    // Växla av dash igen: övre nibbeln (0x20, 0x40) är fortfarande kvar.
    const sha2 = sha256Hex(toggledOn.bytes);
    const reloaded = reread(toggledOn.bytes).objects.find(row => row.kind === "line" && row.path[0]!.y === 70)!;
    const ref2 = objectRefOf(sha2, reloaded)!;
    const toggledOff = run(toggledOn.bytes, sha2, [{
      ...meta,
      kind: "modify",
      ref: ref2,
      geometry: {
        kind: "line",
        path: [{ type: "M", x: 0, y: 70 }, { type: "L", x: 1, y: 70 }, { type: "L", x: 2, y: 70 }]
      }
    }]);
    if (!toggledOff.ok) throw new Error(JSON.stringify(toggledOff.refusals));
    const viewOff = new DataView(toggledOff.bytes.buffer, toggledOff.bytes.byteOffset);
    expect(viewOff.getInt32(at + 56 + 8, true) & 0xff).toBe(0x20);
    expect(viewOff.getInt32(at + 56 + 12, true) & 0xff).toBe(0x40);
  });

  it("uppdaterar indexets färg och v12-huvudets färg vid symbolbyte och nytt objekt utan mall", () => {
    const purpleLine = { number: 102000, type: 2, body: symbolBody(80, { 796: 54, 798: 25, 800: 1 }) };
    const bytes = buildOcd({ ...SPEC, version: 2018, symbols: [...SPEC.symbols!, purpleLine] });
    const map = readMapFile(bytes, "karta.ocd", { sources: true });
    const sha = sha256Hex(bytes);
    const contour = objectRefOf(sha, map.objects.find(o => o.kind === "line" && o.symbol === "101000")!)!;
    const result = run(bytes, sha, [
      { ...meta, kind: "modify", ref: contour, symbol: "102000" },
      { ...meta, kind: "add", id: "ny-lila", symbol: "102000", geometry: { kind: "line", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 3, y: 1 }] } }
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    const firstBlock = view.getUint32(12, true);
    if (contour.locator.format !== "OCD") throw new Error();
    const modEntry = firstBlock + 4 + contour.locator.slot * 40;
    expect(view.getInt16(modEntry + 32, true)).toBe(54);
    expect(view.getInt32(contour.locator.offset + 8, true)).toBe(54);
    const addLoc = result.report.addedObjects[0]!.locator;
    if (addLoc.format !== "OCD") throw new Error();
    const addEntry = firstBlock + 4 + addLoc.slot * 40;
    expect(view.getInt16(addEntry + 32, true)).toBe(54);
    expect(view.getInt32(addLoc.offset + 8, true)).toBe(54);
  });

  // ------------------------------------------------------------------ Etapp 3A: alla 8 buggar + nya oformaterade texter

  for (const version of [9, 10, 11, 2018]) {
    it(`1. flyttar formaterad text (ObjType = 5) utifrån hörn 3 (övre vänster) i version ${version}`, () => {
      const { bytes, sha, ref } = setup(version, [{
        symbol: 902000,
        type: 5,
        coords: [ocdCoord(100, 200), ocdCoord(600, 200), ocdCoord(600, 500), ocdCoord(100, 500)],
        text: "Formaterad\r\ntext"
      }]);
      const formatted = ref(o => o.kind === "text" && o.text === "Formaterad\ntext");
      const result = run(bytes, sha, [{
        ...meta, kind: "modify", ref: formatted,
        geometry: { kind: "text", at: { x: 11, y: 15 } },
        text: "Flyttad\r\nruta"
      }]);
      if (!result.ok) throw new Error(JSON.stringify(result.refusals));
      const after = reread(result.bytes);
      const moved = after.objects.find(o => o.kind === "text" && o.text === "Flyttad\nruta");
      expect(moved).toMatchObject({ kind: "text", at: { x: 11, y: 15 }, text: "Flyttad\nruta" });
      if (moved?.source?.locator.format !== "OCD") throw new Error();
      const coordsAt = moved.source.locator.offset + (version < 12 ? 40 : 56);
      const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
      // Hörn 0..3 flyttades exakt +1000 i x (100→1100) och +1000 i y (500→1500), inte från raw[0]!
      const corners = Array.from({ length: 4 }, (_, i) => [
        view.getInt32(coordsAt + i * 8, true) >> 8,
        view.getInt32(coordsAt + i * 8 + 4, true) >> 8
      ]);
      expect(corners).toEqual([[1100, 1200], [1600, 1200], [1600, 1500], [1100, 1500]]);
      // ObjType = 5 bevaras.
      expect(view.getUint8(moved.source.locator.offset + 4)).toBe(5);
    });
  }

  it("2. delphiDate skriver aldrig NaN vid tomt eller ogiltigt datum i v12+", () => {
    const { bytes, sha, ref } = setup(2018);
    const dot = ref(o => o.kind === "point");
    const result = run(bytes, sha, [
      { author: "a1", at: "", kind: "modify", ref: dot, angle: 30 },
      { author: "a1", at: "inte-ett-datum", kind: "add", id: "p-nodate", symbol: "105100", geometry: { kind: "point", at: { x: 2, y: 3 } } }
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    if (dot.locator.format !== "OCD") throw new Error();
    const modDate = view.getFloat64(dot.locator.offset + 36, true);
    expect(Number.isFinite(modDate)).toBe(true);
    expect(modDate).toBeGreaterThan(40_000);
    const addLoc = result.report.addedObjects[0]!.locator;
    if (addLoc.format !== "OCD") throw new Error();
    expect(Number.isFinite(view.getFloat64(addLoc.offset + 24, true))).toBe(true);
    expect(Number.isFinite(view.getFloat64(addLoc.offset + 36, true))).toBe(true);
    expect(view.getFloat64(addLoc.offset + 24, true)).toBeGreaterThan(40_000);
  });

  for (const version of [9, 10, 11]) {
    it(`3. nollställer objekt-specifika fält i v${version} vid addRecord och spärrar nObjectString i v10–11`, () => {
      const { bytes, ref } = setup(version);
      const contour = ref(o => o.kind === "line" && o.symbol === "101000");
      if (contour.locator.format !== "OCD") throw new Error();
      const at = contour.locator.offset;

      if (version >= 10) {
        const withObjStr = bytes.slice();
        new DataView(withObjStr.buffer, withObjStr.byteOffset).setUint16(at + 14, 2, true);
        const shaStr = sha256Hex(withObjStr);
        const refStr = objectRefOf(shaStr, reread(withObjStr).objects.find(o => o.kind === "line" && o.symbol === "101000")!)!;
        expect(run(withObjStr, shaStr, [{ ...meta, kind: "modify", ref: refStr, angle: undefined,
          geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 2, y: 0 }] } }]))
          .toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });
        expect(run(withObjStr, shaStr, [{ ...meta, kind: "delete", ref: refStr }]))
          .toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });
      }

      // Smutsa ner v9–11 mallobjektets huvud: offset 14 (nObjectString/Res1), 16 (Col = 42), 20..39 (LineWidth/DiamFlags/Res2/Height).
      const dirty = bytes.slice();
      const dv = new DataView(dirty.buffer, dirty.byteOffset);
      dv.setUint16(at + 14, 3, true);
      dv.setInt32(at + 16, 42, true);
      dv.setInt16(at + 20, 77, true);
      dv.setInt16(at + 22, 88, true);
      dv.setFloat64(at + 24, 12345.5, true);
      dv.setInt32(at + 32, 0x11223344, true);
      dv.setInt32(at + 36, 999, true);
      const added = run(dirty, sha256Hex(dirty), [{
        ...meta, kind: "add", id: "ren-v9", symbol: "101000",
        geometry: { kind: "line", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 4, y: 1 }] }
      }]);
      if (!added.ok) throw new Error(JSON.stringify(added.refusals));
      const newLoc = added.report.addedObjects[0]!.locator;
      if (newLoc.format !== "OCD") throw new Error();
      const nv = new DataView(added.bytes.buffer, added.bytes.byteOffset);
      expect(nv.getUint16(newLoc.offset + 14, true)).toBe(0);
      expect(nv.getInt32(newLoc.offset + 16, true)).toBe(42);
      expect(added.bytes.subarray(newLoc.offset + 20, newLoc.offset + 40).every(b => b === 0)).toBe(true);
    });
  }

  for (const version of [9, 10, 11, 2018]) {
    it(`4. bevarar ObjType = 7 för rektangel med TRectSym och växlar typ vid symbolbyte (version ${version})`, () => {
      const rectSym = { number: 700000, type: 7, extent: 10, body: symbolBody(16, { 796: 2, 798: 20 }) };
      const bytes = buildOcd({
        ...SPEC,
        version,
        symbols: [...SPEC.symbols!, rectSym],
        objects: [
          ...SPEC.objects!,
          { symbol: 700000, type: 7, coords: [ocdCoord(0, 0), ocdCoord(400, 0), ocdCoord(400, 300), ocdCoord(0, 300)] }
        ]
      });
      const map = readMapFile(bytes, "rect.ocd", { sources: true });
      expect(map.symbols.get("700000")).toMatchObject({ kind: "LINE", rectangle: true, extent: 0.1 });
      const sha = sha256Hex(bytes);
      const rectRef = objectRefOf(sha, map.objects.find(o => o.symbol === "700000")!)!;
      const lineRef = objectRefOf(sha, map.objects.find(o => o.symbol === "101000")!)!;
      const result = run(bytes, sha, [
        { ...meta, kind: "modify", ref: rectRef, geometry: { kind: "line", path: [
          { type: "M", x: 1, y: 1 }, { type: "L", x: 6, y: 1 }, { type: "L", x: 6, y: 4 }, { type: "L", x: 1, y: 4 }
        ] } },
        // Byt vanlig linje → TRectSym: typen blir 7.
        { ...meta, kind: "modify", ref: lineRef, symbol: "700000" },
        // Lägg till ny rektangel med TRectSym: typen blir 7.
        { ...meta, kind: "add", id: "ny-rekt", symbol: "700000", geometry: { kind: "line", path: [
          { type: "M", x: 20, y: 20 }, { type: "L", x: 25, y: 20 }, { type: "L", x: 25, y: 23 }, { type: "L", x: 20, y: 23 }
        ] } }
      ]);
      if (!result.ok) throw new Error(JSON.stringify(result.refusals));
      const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
      const firstBlock = view.getUint32(12, true);
      if (rectRef.locator.format !== "OCD" || lineRef.locator.format !== "OCD") throw new Error();
      const checkType = (slot: number, offset: number, expectedType: number) => {
        expect(view.getUint8(firstBlock + 4 + slot * 40 + 28)).toBe(expectedType);
        expect(view.getUint8(offset + 4)).toBe(expectedType);
      };
      checkType(rectRef.locator.slot, rectRef.locator.offset, 7);
      checkType(lineRef.locator.slot, lineRef.locator.offset, 7);
      const addedLoc = result.report.addedObjects[0]!.locator;
      if (addedLoc.format !== "OCD") throw new Error();
      checkType(addedLoc.slot, addedLoc.offset, 7);

      // Byt sedan tillbaka rektangelobjektet till vanlig linjesymbol 101000: typen blir 2.
      const sha2 = sha256Hex(result.bytes);
      const after = reread(result.bytes);
      const movedRectRef = objectRefOf(sha2, after.objects.find(o => o.symbol === "700000" && o.kind === "line" && o.path[0]!.x === 1)!)!;
      const switched = run(result.bytes, sha2, [{ ...meta, kind: "modify", ref: movedRectRef, symbol: "101000" }]);
      if (!switched.ok) throw new Error(JSON.stringify(switched.refusals));
      const sv = new DataView(switched.bytes.buffer, switched.bytes.byteOffset);
      if (movedRectRef.locator.format !== "OCD") throw new Error();
      expect(sv.getUint8(sv.getUint32(12, true) + 4 + movedRectRef.locator.slot * 40 + 28)).toBe(2);
      expect(sv.getUint8(movedRectRef.locator.offset + 4)).toBe(2);
    });
  }

  it("5. räknar komplett rc: roterad punktsymbol, TBaseSym.Extent för linjer/ytor och oformaterad text", () => {
    // Asymmetrisk punktsymbol: linje (0,0) → (3,0), bredd 0,20 mm → lokalt x∈[-10, 310], y∈[-10, 10].
    const arrowEl = element(1, 2, 20, 0, [ocdCoord(0, 0), ocdCoord(300, 0)]);
    const arrowSym = { number: 201000, type: 1, extent: 310, body: concat(symbolBody(4, { 796: arrowEl.length / 8 }), arrowEl) };
    const wideLineSym = { number: 104000, type: 2, extent: 47, body: symbolBody(80, { 796: 2, 798: 14, 800: 1 }) };
    const borderedAreaSym = { number: 301000, type: 3, extent: 15, body: symbolBody(40, { 800: 34 }, view => view.setUint8(814 - 796, 1)) };
    const textSym = {
      number: 903000, type: 4, extent: 43,
      body: symbolBody(60, { 828: 2, 830: 80, 832: 400 }, view => { view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); })
    };
    const bytes = buildOcd({
      ...SPEC,
      version: 2018,
      symbols: [...SPEC.symbols!, arrowSym, wideLineSym, borderedAreaSym, textSym]
    });
    const map = readMapFile(bytes, "rc.ocd", { sources: true });
    expect(map.symbols.get("104000")?.extent).toBeCloseTo(0.47, 6);
    expect(map.symbols.get("301000")?.extent).toBeCloseTo(0.15, 6);
    expect(map.symbols.get("903000")?.extent).toBeCloseTo(0.43, 6);

    const sha = sha256Hex(bytes);
    const result = run(bytes, sha, [
      { ...meta, kind: "add", id: "pt-0", symbol: "201000", geometry: { kind: "point", at: { x: 10, y: 10 } }, angle: 0 },
      { ...meta, kind: "add", id: "pt-90", symbol: "201000", geometry: { kind: "point", at: { x: 10, y: 10 } }, angle: 90 },
      { ...meta, kind: "add", id: "pt-180", symbol: "201000", geometry: { kind: "point", at: { x: 10, y: 10 } }, angle: 180 },
      { ...meta, kind: "add", id: "h-line", symbol: "104000", geometry: { kind: "line", path: [{ type: "M", x: 0, y: 5 }, { type: "L", x: 10, y: 5 }] } },
      { ...meta, kind: "add", id: "v-line", symbol: "104000", geometry: { kind: "line", path: [{ type: "M", x: 5, y: 0 }, { type: "L", x: 5, y: 10 }] } },
      { ...meta, kind: "add", id: "h-noext", symbol: "101000", geometry: { kind: "line", path: [{ type: "M", x: 0, y: 2 }, { type: "L", x: 8, y: 2 }] } },
      { ...meta, kind: "add", id: "area-ext", symbol: "301000", geometry: { kind: "area", rings: [[{ type: "M", x: 10, y: 10 }, { type: "L", x: 20, y: 10 }, { type: "L", x: 20, y: 20 }]] } },
      { ...meta, kind: "add", id: "txt-short", symbol: "903000", geometry: { kind: "text", at: { x: 0, y: 0 } }, text: "AB", angle: 0 },
      { ...meta, kind: "add", id: "txt-multi", symbol: "903000", geometry: { kind: "text", at: { x: 0, y: 0 } }, text: "Första raden\nAndra mycket längre raden\nTredje", angle: 0 },
      { ...meta, kind: "add", id: "txt-rot", symbol: "903000", geometry: { kind: "text", at: { x: 0, y: 0 } }, text: "Lång text på tvären", angle: 90 }
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    const firstBlock = view.getUint32(12, true);
    const rcOf = (id: string): [number, number, number, number] => {
      const loc = result.report.addedObjects.find(r => r.id === id)!.locator;
      if (loc.format !== "OCD") throw new Error();
      const e = firstBlock + 4 + loc.slot * 40;
      return [view.getInt32(e, true) >> 8, view.getInt32(e + 4, true) >> 8, view.getInt32(e + 8, true) >> 8, view.getInt32(e + 12, true) >> 8];
    };

    // Roterad punktsymbol runt (1000, 1000):
    expect(rcOf("pt-0")).toEqual([990, 990, 1310, 1010]);
    expect(rcOf("pt-90")).toEqual([990, 990, 1010, 1310]);
    expect(rcOf("pt-180")).toEqual([690, 990, 1010, 1010]);

    // Horisontell & vertikal linje med TBaseSym.Extent = 47 (aldrig 0-bredd eller 0-höjd):
    expect(rcOf("h-line")).toEqual([-47, 453, 1047, 547]);
    expect(rcOf("v-line")).toEqual([453, -47, 547, 1047]);
    // Linje utan TBaseSym.Extent faller tillbaka på halv linjebredd (7):
    expect(rcOf("h-noext")).toEqual([-7, 193, 807, 207]);
    // Yta med TBaseSym.Extent = 15:
    expect(rcOf("area-ext")).toEqual([985, 985, 2015, 2015]);

    // Oformaterad text: rc skalas med längd, radantal och rotation samt inkluderar Extent = 43.
    const [sx0, sy0, sx1, sy1] = rcOf("txt-short");
    const [mx0, my0, mx1, my1] = rcOf("txt-multi");
    const [rx0, ry0, rx1, ry1] = rcOf("txt-rot");
    expect(sx1 - sx0).toBeGreaterThan(200);
    expect(sy1 - sy0).toBeGreaterThan(200);
    expect(mx1 - mx0).toBeGreaterThan(sx1 - sx0);
    expect(my1 - my0).toBeGreaterThan(sy1 - sy0);
    // 90°-roterad lång text är högre än bred och sträcker sig långt uppåt (+y).
    expect(ry1 - ry0).toBeGreaterThan(rx1 - rx0);
    expect(ry1).toBeGreaterThan(2000);
  });

  it("6. filsäkerhetsspärrar: FileType != 0, OfflineSyncSerial != 0 och TStringIndex.ObjIndex", () => {
    // Banläggningsfil (FileType = 1), OCAD Server (FileType = 8), annan specialfil (FileType = 3):
    for (const [fileType, pattern] of [[1, /banläggningsfil/], [8, /OCAD Server/], [3, /specialfil/]] as const) {
      const bad = buildOcd({ ...SPEC, version: 2018, fileType });
      const res = run(bad, sha256Hex(bad), []);
      expect(res).toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });
      if (!res.ok) expect(res.refusals[0]!.message).toMatch(pattern);
    }

    // OfflineSyncSerial (offset 16 i v12-header): != 0 vägras.
    const synced = buildOcd({ ...SPEC, version: 2018, offlineSyncSerial: 7 });
    expect(run(synced, sha256Hex(synced), [])).toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });

    // FileNamePos (offset 36 i v12-header, som riktiga OCAD 2018-filer sätter) får INTE ge falskt OfflineSyncSerial-fel.
    const withFileNamePos = buildOcd({ ...SPEC, version: 2018 });
    new DataView(withFileNamePos.buffer, withFileNamePos.byteOffset).setUint32(36, 60, true);
    expect(run(withFileNamePos, sha256Hex(withFileNamePos), [])).toMatchObject({ ok: true });

    // TStringIndex.ObjIndex (1-baserat): aktiv sträng på objekt 1 (block 0, slot 0) spärrar ändring/radering av just det objektet.
    const withLinked = buildOcd({
      ...SPEC,
      version: 2018,
      strings: [
        ...SPEC.strings!,
        { type: 1001, value: "Kopplad sträng", objIndex: 1 },
        // Borttagen sträng (RecType < 0) på objekt 2 får inte spärra.
        { type: -1001, value: "Borttagen sträng", objIndex: 2 }
      ]
    });
    const shaLinked = sha256Hex(withLinked);
    const mapLinked = readMapFile(withLinked, "linked.ocd", { sources: true });
    const slot0 = objectRefOf(shaLinked, mapLinked.objects.find(o => o.source?.locator.format === "OCD" && o.source.locator.slot === 0)!)!;
    const slot1 = objectRefOf(shaLinked, mapLinked.objects.find(o => o.source?.locator.format === "OCD" && o.source.locator.slot === 1)!)!;
    expect(run(withLinked, shaLinked, [{ ...meta, kind: "delete", ref: slot0 }])).toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });
    expect(run(withLinked, shaLinked, [{ ...meta, kind: "modify", ref: slot0, geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 1 }] } }]))
      .toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });
    // Objekt 2 (bara borttagen sträng) går utmärkt att ändra.
    expect(run(withLinked, shaLinked, [{ ...meta, kind: "modify", ref: slot1, angle: 15 }])).toMatchObject({ ok: true });

    // Block 1, slot 0 = ObjIndex 257.
    const filler = Array.from({ length: 256 - SPEC.objects!.length + 1 }, (_, i) => ({ symbol: 105100, type: 1, coords: [ocdCoord(i, 0)] }));
    const twoBlocks = buildOcd({
      ...SPEC,
      version: 2018,
      objects: [...SPEC.objects!, ...filler],
      strings: [...SPEC.strings!, { type: 1001, value: "Block 1 slot 0", objIndex: 257 }]
    });
    const sha2 = sha256Hex(twoBlocks);
    const map2 = readMapFile(twoBlocks, "two.ocd", { sources: true });
    const b1s0 = objectRefOf(sha2, map2.objects.find(o => o.source?.locator.format === "OCD" && o.source.locator.block === 1 && o.source.locator.slot === 0)!)!;
    expect(run(twoBlocks, sha2, [{ ...meta, kind: "delete", ref: b1s0 }])).toMatchObject({ ok: false, refusals: [{ code: "UNSAFE_FILE" }] });
  });

  it("7. normaliserar radbrytningar i textBytes utan dubbelt \\r\\r\\n och klarar många nya objekt snabbt", () => {
    const { bytes, sha, ref } = setup(2018);
    const textRef = ref(o => o.kind === "text");
    const bulkAdds: MapRevisionChange[] = Array.from({ length: 300 }, (_, i) => ({
      ...meta, kind: "add" as const, id: `bulk-${i}`, symbol: "105100", geometry: { kind: "point" as const, at: { x: i * 0.5, y: 1 } }
    }));
    const result = run(bytes, sha, [
      { ...meta, kind: "modify", ref: textRef, text: "Rad 1\r\nRad 2\rRad 3\nRad 4" },
      ...bulkAdds
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const after = reread(result.bytes);
    const updated = after.objects.find(o => o.kind === "text");
    expect(updated).toMatchObject({ text: "Rad 1\nRad 2\nRad 3\nRad 4" });
    if (updated?.source?.locator.format !== "OCD") throw new Error();
    const pos = updated.source.locator.offset;
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
    const nItem = view.getUint32(pos + 44, true);
    const nText = view.getUint16(pos + 48, true);
    const rawUtf16 = new TextDecoder("utf-16le").decode(result.bytes.subarray(pos + 56 + nItem * 8, pos + 56 + (nItem + nText) * 8));
    const beforeNull = rawUtf16.slice(0, rawUtf16.indexOf("\0"));
    expect(beforeNull).toBe("Rad 1\r\nRad 2\r\nRad 3\r\nRad 4");
    expect(beforeNull.includes("\r\r")).toBe(false);
    expect(result.report.added).toBe(300);
  });

  for (const version of [9, 10, 11, 2018]) {
    it(`8. lägger till nya oformaterade texter (ObjType = 4) med UTF-16, 5 punkter och korrekt rc i version ${version}`, () => {
      const extraTextSym = {
        number: 904000, type: 4, extent: 25,
        body: symbolBody(60, { 828: 54, 830: 100, 832: 700 }, view => { view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); })
      };
      const lineTextSym = {
        number: 905000, type: 6,
        body: symbolBody(60, { 828: 2, 830: 80, 832: 400 }, view => { view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); })
      };
      const bytes = buildOcd({ ...SPEC, version, symbols: [...SPEC.symbols!, extraTextSym, lineTextSym] });
      const sha = sha256Hex(bytes);
      // Linjetextsymbol ska vägras för ny oformaterad text.
      expect(run(bytes, sha, [{ ...meta, kind: "add", id: "lt", symbol: "905000", geometry: { kind: "text", at: { x: 1, y: 2 } }, text: "Linje" }]))
        .toMatchObject({ ok: false, refusals: [{ code: "INVALID_CHANGE" }] });

      const result = run(bytes, sha, [
        // Med befintligt mallobjekt (902000):
        { ...meta, kind: "add", id: "txt-mall", symbol: "902000", geometry: { kind: "text", at: { x: 12.34, y: -5.67 } }, angle: 35.5, text: "ÅÄÖ åäö\r\nSödra branten" },
        // Utan mallobjekt (904000):
        { ...meta, kind: "add", id: "txt-ny", symbol: "904000", geometry: { kind: "text", at: { x: 30, y: 40 } }, angle: 0, text: "Högdalen 2026" }
      ]);
      if (!result.ok) throw new Error(JSON.stringify(result.refusals));
      expect(result.report.added).toBe(2);
      const after = reread(result.bytes);
      const added1 = after.objects.find(o => o.kind === "text" && o.symbol === "902000" && o.text === "ÅÄÖ åäö\nSödra branten");
      const added2 = after.objects.find(o => o.kind === "text" && o.symbol === "904000" && o.text === "Högdalen 2026");
      expect(added1).toMatchObject({ at: { x: 12.34, y: -5.67 }, angle: 35.5, text: "ÅÄÖ åäö\nSödra branten" });
      expect(added2).toMatchObject({ at: { x: 30, y: 40 }, angle: 0, text: "Högdalen 2026" });

      const view = new DataView(result.bytes.buffer, result.bytes.byteOffset);
      const firstBlock = view.getUint32(12, true);
      for (const added of [added1!, added2!]) {
        if (added.source?.locator.format !== "OCD") throw new Error();
        const entry = firstBlock + 4 + added.source.locator.slot * 40;
        expect(view.getUint8(entry + 28)).toBe(4);
        expect(view.getUint8(added.source.locator.offset + 4)).toBe(4);
        const coordCountOff = version < 12 ? 8 : 44;
        const textCountOff = version < 12 ? 12 : 48;
        expect(view.getUint32(added.source.locator.offset + coordCountOff, true)).toBe(5);
        expect(view.getUint16(added.source.locator.offset + textCountOff, true)).toBeGreaterThan(0);
      }
      // Textsymbol utan mall fick rätt färg (54) i index och huvud.
      if (added2!.source?.locator.format !== "OCD") throw new Error();
      expect(view.getInt16(firstBlock + 4 + added2!.source.locator.slot * 40 + 32, true)).toBe(54);
      expect(view.getInt32(added2!.source.locator.offset + (version < 12 ? 16 : 8), true)).toBe(54);
    });
  }

  it("verifyOcd fångar tom rc, fel ObjType och NaN-datum på tillagda texter", () => {
    const { bytes, map, sha } = setup(2018);
    const result = run(bytes, sha, [
      { ...meta, kind: "add", id: "v-txt", symbol: "902000", geometry: { kind: "text", at: { x: 5, y: 5 } }, text: "Kontroll" }
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.refusals));
    const loc = result.report.addedObjects[0]!.locator;
    if (loc.format !== "OCD") throw new Error();
    const expected = [{ block: loc.block, slot: loc.slot, object: { kind: "text" as const, symbol: "902000", at: { x: 5, y: 5 }, angle: 0, text: "Kontroll" }, type: 4 }];
    expect(verifyOcd(bytes, result.bytes, map, expected, result.report.edits)).toMatchObject({ ok: true });

    const firstBlock = new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint32(12, true);
    const entry = firstBlock + 4 + loc.slot * 40;

    // 1. Nollställd (0×0) rc fångas.
    const badRc = result.bytes.slice();
    const dvRc = new DataView(badRc.buffer, badRc.byteOffset);
    dvRc.setInt32(entry, 500 << 8, true);
    dvRc.setInt32(entry + 4, 500 << 8, true);
    dvRc.setInt32(entry + 8, 500 << 8, true);
    dvRc.setInt32(entry + 12, 500 << 8, true);
    expect(verifyOcd(bytes, badRc, map, expected, result.report.edits)).toMatchObject({ ok: false });

    // 2. Fel ObjType (5 i stället för 4) fångas.
    const badType = result.bytes.slice();
    badType[entry + 28] = 5;
    badType[loc.offset + 4] = 5;
    expect(verifyOcd(bytes, badType, map, expected, result.report.edits)).toMatchObject({ ok: false });

    // 3. NaN-datum fångas.
    const badDate = result.bytes.slice();
    new DataView(badDate.buffer, badDate.byteOffset).setFloat64(loc.offset + 36, Number.NaN, true);
    expect(verifyOcd(bytes, badDate, map, expected, result.report.edits)).toMatchObject({ ok: false });
  });
});
