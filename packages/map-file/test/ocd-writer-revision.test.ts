import { describe, expect, it } from "vitest";
import { objectRefOf, readMapFile, sha256Hex, SYMBOL_SETS, type MapObject, type MapRevisionChange } from "../src";
import { Bytes, indexBlocks } from "../src/ocd/bytes";
import { HEADER } from "../src/ocd/layout";
import {
  applyOcdFullRevision, decodeOcdString, ocdChangesFile, STRING_BLOCK_SIZE, verifyOcdDocument
} from "../src/ocd/writer";
import { buildOcd, ocdCoord, symbolBody } from "./ocd-builder";
import { SPEC } from "./ocd-spec";

const AT = "2026-11-26T15:00:00.000Z";
const meta = { author: "a1", at: AT };
const SPRINT = SYMBOL_SETS["ISSPROM2019-2"];
const sprintDef = (code: string) => SPRINT.symbols.find(s => s.code === code)!;

describe("OcdDocument — applyOcdFullRevision & ocdChangesFile", () => {
  for (const version of [2018, 11, 9]) {
    it(`kör komplett enkelpass-revidering med objekt, länkade strängar, formaterad text, rektangel, färger och symboler (OCAD ${version})`, () => {
      const rectSym = { number: 800000, type: 7, body: symbolBody(16, { 796: 2, 798: 20 }) };
      const src = buildOcd({
        ...SPEC,
        version,
        symbols: [...SPEC.symbols!, rectSym],
        strings: [
          ...SPEC.strings!,
          // Länkad sträng på punkt #2 (som ändras!) -> måste hänga med till nytt kompakt ObjIndex!
          { type: 1001, value: "PunktLank\tv1", objIndex: 2 },
          // Länkad sträng på yta #3 (som raderas!) -> måste rensas rent!
          { type: 1001, value: "RaderadYtaLank\tv2", objIndex: 3 }
        ],
        objects: [
          ...SPEC.objects!,
          // Formaterad text (ObjType = 5, ankare i hörn 3 = övre vänstra (1000, 2500))
          {
            symbol: 902000, type: 5, text: "Ruta",
            coords: [ocdCoord(1000, 2000), ocdCoord(3000, 2000), ocdCoord(3000, 2500), ocdCoord(1000, 2500)]
          },
          // Rektangel (ObjType = 7)
          {
            symbol: 800000, type: 7,
            coords: [ocdCoord(0, 0), ocdCoord(500, 0), ocdCoord(500, 300), ocdCoord(0, 300)]
          }
        ]
      });

      const baseSha = sha256Hex(src);
      const before = readMapFile(src, "karta.ocd", { sources: true });
      const refOf = (pred: (o: MapObject) => boolean) => objectRefOf(baseSha, before.objects.find(pred)!)!;

      const ptRef = refOf(o => o.kind === "point");
      const areaRef = refOf(o => o.kind === "area");
      const fmtTextRef = refOf(o => o.kind === "text" && o.text === "Ruta");
      const rectRef = refOf(o => o.kind === "line" && o.symbol === "800000");

      // In-memory id för ny normsymbol (firstFreeId = max(999000) + 1000 = 1000000) och kopierad textsymbol ("999999").
      const virtualNormId = String(Math.max(...[...before.symbols.keys()].map(Number)) + 1000);
      const changes: MapRevisionChange[] = [
        { ...meta, kind: "modify", ref: ptRef, geometry: { kind: "point", at: { x: 12, y: 15 } }, angle: 30 },
        { ...meta, kind: "delete", ref: areaRef },
        { ...meta, kind: "modify", ref: fmtTextRef, geometry: { kind: "text", at: { x: 15, y: 30 } }, text: "Flyttad ruta" },
        { ...meta, kind: "modify", ref: rectRef, geometry: { kind: "line", path: [
          { type: "M", x: 1, y: 1 }, { type: "L", x: 6, y: 1 }, { type: "L", x: 6, y: 4 }, { type: "L", x: 1, y: 4 }
        ] } },
        // Nya objekt som pekar på den nytillagda normsymbolen och kopierade textsymbolen via sina in-memory id:n!
        { ...meta, kind: "add", id: "ny-norm", symbol: virtualNormId, geometry: { kind: "point", at: { x: 25, y: 25 } } },
        { ...meta, kind: "add", id: "ny-text", symbol: "999999", geometry: { kind: "text", at: { x: 30, y: 30 } }, text: "Hej\nOCAD", angle: 15 }
      ];

      const res = applyOcdFullRevision(src, { baseFileSha256: baseSha, format: "OCD", changes }, {
        normAdditions: [{ code: "545", def: sprintDef("545"), palette: SPRINT.colors, add: true }],
        textSymbols: [{
          id: "999999", copyOf: "902000", code: "902.1", name: "Kopia",
          fontFamily: "Arial", size: 4, color: 2, bold: true, italic: false, align: "center", framing: { color: 34, width: 0.3 }
        }],
        colors: [{ id: 2, cmyk: { c: 0, m: 0, y: 0, k: 0.9 } }],
        symbolColors: [{ symbol: "101.0", from: 2, to: 54 }]
      });

      if (!res.ok) throw new Error(JSON.stringify(res.refusals));
      expect(res.report).toMatchObject({ format: "OCD", modified: 3, deleted: 1, added: 2 });

      const after = readMapFile(res.bytes, "resultat.ocd", { sources: true });
      expect(after.objects).toHaveLength(before.objects.length - 1 + 2);
      // Formaterad text flyttad exakt till (15, 30) utan y-hopp!
      expect(after.objects.find(o => o.kind === "text" && o.text === "Flyttad ruta")).toMatchObject({ at: { x: 15, y: 30 } });
      // Nya objekt fick sina riktiga OCAD-symbolnummer (545000 resp. 902001)!
      expect(after.objects.find(o => o.kind === "point" && o.symbol === "545000")).toMatchObject({ at: { x: 25, y: 25 } });
      expect(after.objects.find(o => o.kind === "text" && o.symbol === "902001")).toMatchObject({ text: "Hej\nOCAD", angle: 15 });
      // Färgändring + symbolfärgändring slog igenom!
      expect(after.colors.find(c => c.id === 2)?.cmyk.k).toBeCloseTo(0.9, 2);
      const s101 = after.symbols.get("101000");
      expect(s101?.kind === "LINE" && s101.strokes[0]?.color).toBe(54);

      // Verifiera att stränglänken på punkten hängde med till det ändrade objektets plats och att strängen på den raderade ytan försvann!
      const b = new Bytes(res.bytes);
      const linked: { objIndex: number; text: string }[] = [];
      for (const block of indexBlocks(b, b.u32(HEADER.firstStringBlock), STRING_BLOCK_SIZE)) {
        for (let slot = 0; slot < 256; slot++) {
          const e = block + 4 + slot * 16;
          const pos = b.i32(e), len = b.i32(e + 4);
          if (pos > 0 && len > 0 && b.i32(e + 8) === 1001) {
            linked.push({ objIndex: b.i32(e + 12), text: decodeOcdString(res.bytes.subarray(pos, pos + len)) });
          }
        }
      }
      expect(linked).toHaveLength(1);
      expect(linked[0]!.text).toBe("PunktLank\tv1");
      const movedPt = after.objects.find(o => o.kind === "point" && o.symbol === "105100")!;
      const loc = movedPt.source!.locator;
      expect(loc.format === "OCD" && loc.block * 256 + loc.slot + 1).toBe(linked[0]!.objIndex);
    });
  }

  it("exporterar kompakt ändringsfil med ocdChangesFile (enbart tillagda och ändrade objekt + huvud/färger/georef/symboler)", () => {
    const extraObjs = Array.from({ length: 50 }, (_, i) => ({
      symbol: 105100, type: 1, coords: [ocdCoord(i * 100, 1000)]
    }));
    const src = buildOcd({ ...SPEC, version: 2018, objects: [...SPEC.objects!, ...extraObjs] });
    const baseSha = sha256Hex(src);
    const before = readMapFile(src, "karta.ocd", { sources: true });
    const lineRef = objectRefOf(baseSha, before.objects.find(o => o.kind === "line")!)!;
    const areaRef = objectRefOf(baseSha, before.objects.find(o => o.kind === "area")!)!;

    const exported = ocdChangesFile(src, {
      baseFileSha256: baseSha,
      format: "OCD",
      changes: [
        { ...meta, kind: "modify", ref: lineRef, geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 5, y: 5 }] } },
        { ...meta, kind: "delete", ref: areaRef },
        { ...meta, kind: "add", id: "ny-p", symbol: "105100", geometry: { kind: "point", at: { x: 42, y: 24 } }, angle: 90 }
      ]
    }, {
      colors: [{ id: 2, cmyk: { c: 0, m: 0, y: 0, k: 0.75 } }]
    });

    if (!exported.ok) throw new Error(JSON.stringify(exported.refusals));
    expect(exported).toMatchObject({ added: 1, modified: 1, skippedDeleted: 1 });

    const verified = verifyOcdDocument(exported.bytes, { exactObjects: 2 });
    if (!verified.ok) throw new Error(verified.message);
    const map = verified.map;
    expect(map.objects).toHaveLength(2);
    expect(map.georeference).toEqual(before.georeference);
    expect(map.scale).toBe(before.scale);
    expect(map.symbols.size).toBe(before.symbols.size);
    expect(map.colors.find(c => c.id === 2)?.cmyk.k).toBeCloseTo(0.75, 2);
    expect(map.objects.some(o => o.kind === "point" && o.at.x === 42 && o.angle === 90)).toBe(true);
    expect(map.objects.some(o => o.kind === "line" && o.path.length === 2)).toBe(true);
  });
});
