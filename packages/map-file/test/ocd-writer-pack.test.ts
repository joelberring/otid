import { describe, expect, it } from "vitest";
import { readMapFile } from "../src";
import { Bytes, indexBlocks } from "../src/ocd/bytes";
import { HEADER, OBJECT_BLOCK_SIZE, SYMBOL_BLOCK_SIZE } from "../src/ocd/layout";
import {
  applyOcdColorChanges, applyOcdColors, decodeOcdString, HEADER_EXTRA, OBJ_INDEX, OBJ_STATUS, packOcdDocument,
  parseOcdDocument, STRING_BLOCK_SIZE, SYMBOL_HEAD, updateOcdScalePar, verifyOcdDocument
} from "../src/ocd/writer";
import { buildOcd, buildOcd8, ocdCoord } from "./ocd-builder";
import { SPEC } from "./ocd-spec";

describe("OcdDocument — förlustfri parser, kompaktering, färger och georeferens", () => {
  for (const version of [2018, 11, 9]) {
    it(`packar om och kompakterar förlustfritt utan döda hål (OCAD ${version})`, () => {
      const src = buildOcd({
        ...SPEC,
        version,
        strings: [
          ...SPEC.strings!,
          // Okänd parametersträng (t.ex. display/view) ska bevaras byte-för-byte.
          { type: 1030, value: "\tx10.5\ty20.25\tz4.0" },
          // Sträng länkad till objekt #2 (punkt 105100, index 2) och objekt #6 (status=3 raderat, index 6).
          { type: 1001, value: "ObjektData\ta42", objIndex: 2 },
          { type: 1001, value: "RaderatObjekt\ta99", objIndex: 6 }
        ]
      });

      const doc = parseOcdDocument(src);
      const packed = packOcdDocument(doc);
      const verified = verifyOcdDocument(packed.bytes);
      if (!verified.ok) throw new Error(verified.message);

      const before = readMapFile(src, "fore.ocd");
      const after = readMapFile(packed.bytes, "efter.ocd");
      expect(after.colors).toEqual(before.colors);
      expect(after.scale).toBe(before.scale);
      expect(after.georeference).toEqual(before.georeference);
      expect(after.objects).toEqual(before.objects);
      expect(after.symbols.size).toBe(before.symbols.size);

      // Verifiera att TBaseSym.FilePos (offset 20) stämmer för varje symbol.
      const b = new Bytes(packed.bytes);
      for (const block of indexBlocks(b, b.u32(HEADER.firstSymbolBlock), SYMBOL_BLOCK_SIZE)) {
        for (let slot = 0; slot < 256; slot++) {
          const pos = b.i32(block + 4 + slot * 4);
          if (pos <= 0) continue;
          expect(b.i32(pos + SYMBOL_HEAD.filePos)).toBe(pos);
        }
      }

      // Verifiera att Status=2 (dolt objekt) och Sym<0 (grafik -2) bevarades men Status=3 (raderat) kompakterades bort.
      const statuses: number[] = [];
      const syms: number[] = [];
      for (const block of indexBlocks(b, b.u32(HEADER.firstObjectBlock), OBJECT_BLOCK_SIZE)) {
        for (let slot = 0; slot < 256; slot++) {
          const e = block + 4 + slot * OBJ_INDEX.size;
          if (b.i32(e + OBJ_INDEX.position) <= 0) continue;
          statuses.push(b.u8(e + OBJ_INDEX.status));
          syms.push(b.i32(e + OBJ_INDEX.symbol));
        }
      }
      expect(statuses).toContain(OBJ_STATUS.hidden);
      expect(statuses).not.toContain(OBJ_STATUS.deletedUndo);
      expect(syms).toContain(-2);

      // Verifiera att strängen på objekt #2 (nu fortfarande objekt #2) hängde med, att okänd 1030 är orörd och att strängen på raderat #6 rensades.
      const strEntries: { type: number; objIndex: number; text: string }[] = [];
      for (const block of indexBlocks(b, b.u32(HEADER.firstStringBlock), STRING_BLOCK_SIZE)) {
        for (let slot = 0; slot < 256; slot++) {
          const e = block + 4 + slot * 16;
          const pos = b.i32(e), len = b.i32(e + 4);
          if (pos <= 0 || len <= 0) continue;
          strEntries.push({ type: b.i32(e + 8), objIndex: b.i32(e + 12), text: decodeOcdString(packed.bytes.subarray(pos, pos + len)) });
        }
      }
      expect(strEntries.find(s => s.type === 1030)?.text).toBe("\tx10.5\ty20.25\tz4.0");
      const linked = strEntries.filter(s => s.type === 1001);
      expect(linked).toHaveLength(1);
      expect(linked[0]).toEqual({ type: 1001, objIndex: 2, text: "ObjektData\ta42" });
    });
  }

  it("mappar om TStringIndex.ObjIndex när tidigare raderade objekt kompakteras bort", () => {
    const src = buildOcd({
      version: 2018,
      symbols: SPEC.symbols!,
      strings: [
        ...SPEC.strings!,
        { type: 1002, value: "Skiftad\tx1", objIndex: 3 }
      ],
      objects: [
        { symbol: 101000, type: 2, status: 3, coords: [ocdCoord(0, 0), ocdCoord(100, 0)] }, // raderat -> försvinner
        { symbol: 101000, type: 2, status: 0, coords: [ocdCoord(0, 0), ocdCoord(100, 0)] }, // raderat -> försvinner
        { symbol: 105100, type: 1, status: 1, coords: [ocdCoord(500, 500)] } // var index 3 -> blir index 1!
      ]
    });

    const packed = packOcdDocument(parseOcdDocument(src));
    const verified = verifyOcdDocument(packed.bytes, { exactObjects: 1 });
    expect(verified.ok).toBe(true);

    const b = new Bytes(packed.bytes);
    const block = b.u32(HEADER.firstStringBlock);
    let foundObjIndex = -1;
    for (let slot = 0; slot < 256; slot++) {
      const e = block + 4 + slot * 16;
      if (b.i32(e) > 0 && b.i32(e + 8) === 1002) foundObjIndex = b.i32(e + 12);
    }
    expect(foundObjIndex).toBe(1);
  });

  it("bevarar FileNamePos/FileNameSize och nollställer oompackade v12-pekare (48/52)", () => {
    const base = buildOcd({ ...SPEC, version: 2018 });
    // Skriv ett filnamn sist i filen och peka FileNamePos (36) + FileNameSize (40) dit, samt sätt dummy SketchPos (52).
    const fileName = new TextEncoder().encode("C:\\Kartor\\Test.ocd\0\0\0\0\0\0");
    const withExtra = new Uint8Array(base.length + fileName.length);
    withExtra.set(base, 0);
    withExtra.set(fileName, base.length);
    const dv = new DataView(withExtra.buffer);
    dv.setUint32(HEADER_EXTRA.fileNamePos, base.length, true);
    dv.setUint32(HEADER_EXTRA.fileNameSize, fileName.length, true);
    dv.setUint32(HEADER_EXTRA.sketchPos, base.length - 8, true);

    const doc = parseOcdDocument(withExtra);
    expect(doc.fileNameBytes).not.toBeNull();
    const packed = packOcdDocument(doc);
    const verified = verifyOcdDocument(packed.bytes);
    expect(verified.ok).toBe(true);

    const pdv = new DataView(packed.bytes.buffer);
    const fnPos = pdv.getUint32(HEADER_EXTRA.fileNamePos, true);
    const fnSize = pdv.getUint32(HEADER_EXTRA.fileNameSize, true);
    expect(fnPos).toBe(60);
    expect(fnSize).toBe(fileName.length);
    expect(decodeOcdString(packed.bytes.subarray(fnPos, fnPos + fnSize))).toBe("C:\\Kartor\\Test.ocd");
    expect(pdv.getUint32(HEADER_EXTRA.sketchPos, true)).toBe(0);
  });

  it("vägrar v8, banläggningsfiler (FileType 1), OCAD Server (FileType 8) och OfflineSyncSerial", () => {
    expect(() => parseOcdDocument(buildOcd8({ objects: [] }))).toThrow(/OCAD 8/);
    expect(() => parseOcdDocument(buildOcd({ ...SPEC, fileType: 1 }))).toThrow(/banläggningsfil/);
    expect(() => parseOcdDocument(buildOcd({ ...SPEC, fileType: 8 }))).toThrow(/OCAD Server/);
    expect(() => parseOcdDocument(buildOcd({ ...SPEC, offlineSyncSerial: 12345 }))).toThrow(/OfflineSyncSerial/);
  });

  it("stödjer fler än 256 symboler och objekt (flera kedjade indexblock)", () => {
    const symbols = Array.from({ length: 270 }, (_, i) => ({ number: 100000 + i * 1000, type: 1, body: new Uint8Array(4) }));
    const objects = Array.from({ length: 270 }, (_, i) => ({ symbol: 100000 + i * 1000, type: 1, coords: [ocdCoord(i * 10, i * 20)] }));
    const src = buildOcd({ version: 2018, strings: SPEC.strings!, symbols, objects });
    const packed = packOcdDocument(parseOcdDocument(src));
    const verified = verifyOcdDocument(packed.bytes, { exactObjects: 270 });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.map.symbols.size).toBe(270);
  });

  it("uppdaterar färger (inkl. dekorfärger), lägger till, flyttar och raderar oanvänd färg + uppdaterar si_ScalePar", () => {
    const src = buildOcd({ ...SPEC, version: 2018 });

    // 1. Dropp-in applyOcdColorChanges — ändrar CMYK på både dekorfärg (54 Lila) och processfärg (2 Svart).
    const changed = applyOcdColorChanges(src, [
      { id: 54, cmyk: { c: 0.25, m: 0.95, y: 0.05, k: 0 } },
      { id: 2, cmyk: { c: 0, m: 0, y: 0, k: 0.85 } }
    ]);
    if (!changed.ok) throw new Error(changed.message);
    expect(changed.changed).toBe(2);
    const afterChange = readMapFile(changed.bytes, "farg.ocd");
    const lila = afterChange.colors.find(c => c.id === 54)!;
    expect(lila.cmyk).toEqual({ c: 0.25, m: 0.95, y: 0.05, k: 0 });
    // Dekorfärgsseparationen (`sPurple\tp100`) bevarades!
    expect(lila.spot?.name).toBe("Purple");

    // 2. Utökade OcdColorEdit: add (ovanför 2), move, delete (oanvänd 54 OK, använd 2 blockeras), update overprint/opacity/name.
    const doc = parseOcdDocument(changed.bytes);
    const stats = applyOcdColors(doc, [
      { kind: "add", name: "Ny grå 50%", cmyk: { c: 0, m: 0, y: 0, k: 0.5 }, beforeId: 2, overprint: true, opacity: 0.8 },
      { kind: "move", id: 34, beforeId: 54 },
      { kind: "delete", id: 54 }, // oanvänd i SPEC-symbolerna -> raderas
      { kind: "delete", id: 2 },  // används av symbol 101000/105100/902000 -> behålls!
      { kind: "update", id: 2, name: "Svart uppdaterad", overprint: false }
    ]);
    expect(stats.addedIds).toHaveLength(1);
    const addedId = stats.addedIds[0]!;

    // 3. Uppdatera si_ScalePar (SWEREF 99 TM).
    updateOcdScalePar(doc, {
      scale: 4000,
      crs: { kind: "EPSG", code: 3006 },
      refPoint: { easting: 674123.5, northing: 6571234.25 },
      mapRefPoint: { x: 0, y: 0 },
      grivationDegrees: 5.25,
      combinedScaleFactor: 1
    });

    const packed = packOcdDocument(doc);
    const verified = verifyOcdDocument(packed.bytes);
    if (!verified.ok) throw new Error(verified.message);
    const map = verified.map;
    expect(map.colors.map(c => c.id)).toEqual([34, addedId, 2]);
    expect(map.colors[1]).toMatchObject({ name: "Ny grå 50%", cmyk: { c: 0, m: 0, y: 0, k: 0.5 }, overprint: true, opacity: 0.8 });
    expect(map.colors[2]).toMatchObject({ id: 2, name: "Svart uppdaterad" });
    expect(map.colors[2]?.overprint).toBeUndefined();
    expect(map.scale).toBe(4000);
    expect(map.georeference).toMatchObject({
      scale: 4000,
      crs: { kind: "EPSG", code: 3006 },
      refPoint: { easting: 674123.5, northing: 6571234.25 },
      grivationDegrees: 5.25
    });
  });
});
