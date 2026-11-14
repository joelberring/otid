import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyMapRevision, objectRefOf, readMapFile, sha256Hex, type MapObject, type MapRevisionApplyResult, type MapRevisionChange,
  type MapRevisionChangeSet, type ObjectRef, type ParsedMap, type RevisionGeometry
} from "../src";
import { moveCommand } from "../src/geometry";
import { readOmap } from "../src/omap/read";
import { scanParts } from "../src/revision/omap-scan";
import { verifyOmap } from "../src/revision/omap-verify";
import { planOmapRevision } from "../src/revision/omap-write";
import { buildOcd, seededRandom } from "./ocd-builder";
import { SPEC } from "./ocd-spec";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const meta = { author: "konto-1", at: "2026-11-07T20:00:00Z" } as const;

const OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><ref_point x="0" y="0"/></georeferencing>
<colors count="2">
<color priority="0" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/><rgb method="cmyk" r="0" g="0" b="0"/></color>
<color priority="1" name="Gul" c="0" m="0.27" y="0.79" k="0" opacity="1"><cmyk method="custom"/><rgb method="custom" r="1" g="0.8" b="0.2"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="6" id="test">
<symbol type="2" id="0" code="101" name="Höjdkurva"><line_symbol color="0" line_width="140"/></symbol>
<symbol type="2" id="1" code="102" name="Stödkurva"><line_symbol color="0" line_width="250"/></symbol>
<symbol type="1" id="2" code="109" name="Sten"><point_symbol inner_radius="250" inner_color="0" outer_width="0" outer_color="-1" elements="0"/></symbol>
<symbol type="4" id="3" code="401" name="Öppen mark"><area_symbol inner_color="1" patterns="0"/></symbol>
<symbol type="8" id="4" code="902" name="Text"><text_symbol><font family="Arial" size="4000"/><text color="0"/></text_symbol></symbol>
<symbol type="1" id="5" code="110" name="Block"><point_symbol inner_radius="300" inner_color="0" outer_width="0" outer_color="-1" elements="0"/></symbol>
</symbols>
<parts count="2" current="0">
<part name="Karta"><objects count="5">
<object type="1" symbol="0"><coords count="7">0 0 1;1000 0;2000 -1000;2000 -2000 4;3000 -2000 32;4000 -2500;5000 -2500;</coords></object>
<object type="0" symbol="2" rotation="0.5"><coords count="1">5000 -6000;</coords></object>
<object type="1" symbol="3"><coords count="9">0 0;10000 0;10000 -10000;0 -10000;0 0 18;2000 -2000;4000 -2000;4000 -4000;2000 -2000 18;</coords><pattern rotation="0.25"><coord x="0" y="0"/></pattern></object>
<object type="4" symbol="4" h_align="1" v_align="2"><coords count="1">100 -200;</coords><text>Djurgårds&amp;brunn</text></object>
<object type="1" symbol="3"><coords count="5">20000 0;30000 0;30000 -10000;20000 -10000;20000 0 18;</coords></object>
</objects></part>
<part name="Tomt"><objects count="0"/></part>
</parts>
<templates count="0" first_front_template="0"/>
<undo><step type="1"><object type="0" symbol="2"><coords count="1">1 1;</coords></object></step></undo>
<redo/>
</barrier>
</map>
`;

interface Setup { bytes: Uint8Array; sha: string; map: ParsedMap; ref: (index: number) => ObjectRef }

function setup(content: string | Uint8Array = OMAP): Setup {
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  const sha = sha256Hex(bytes);
  const map = readMapFile(bytes, "test.omap", { sources: true });
  return { bytes, sha, map, ref: index => objectRefOf(sha, map.objects[index]!)! };
}

const apply = (s: Setup, changes: readonly MapRevisionChange[]) => applyMapRevision(s.bytes, { baseFileSha256: s.sha, format: "OMAP", changes });

function ok(result: MapRevisionApplyResult): { text: string; bytes: Uint8Array; map: ParsedMap; report: Extract<MapRevisionApplyResult, { ok: true }>["report"] } {
  if (!result.ok) throw new Error(JSON.stringify(result.refusals));
  return { text: decoder.decode(result.bytes), bytes: result.bytes, map: readMapFile(result.bytes, "ny.omap", { sources: true }), report: result.report };
}

const codes = (result: MapRevisionApplyResult) => (result.ok ? [] : result.refusals.map(refusal => refusal.code));
const plain = (object: MapObject) => { const copy = { ...object }; delete copy.source; return copy; };

function geometryOf(object: MapObject, dx = 0, dy = 0): RevisionGeometry {
  switch (object.kind) {
    case "point": return { kind: "point", at: { x: object.at.x + dx, y: object.at.y + dy } };
    case "text": return { kind: "text", at: { x: object.at.x + dx, y: object.at.y + dy } };
    case "line": return { kind: "line", path: object.path.map(command => ({ ...command, ...moveCommand(command, dx, dy) })) };
    case "area": return { kind: "area", rings: object.rings.map(ring => ring.map(command => ({ ...command, ...moveCommand(command, dx, dy) }))) };
  }
}

describe("sha256", () => {
  it("stämmer med node:crypto", () => {
    const random = seededRandom(7);
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const data = Uint8Array.from({ length }, () => Math.floor(random() * 256));
      expect(sha256Hex(data), `längd ${length}`).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});

describe("Mapper: tillbakaskrivning", () => {
  it("ger samma bytes för en tom ändringssats (en ny kopia)", () => {
    const s = setup();
    const result = apply(s, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toEqual(s.bytes);
    expect(result.bytes).not.toBe(s.bytes);
    expect(result.report.edits).toEqual([]);
    expect(result.report.resultSha256).toBe(s.sha);
  });

  it("flyttar en punkt och lämnar resten tecken för tecken", () => {
    const s = setup();
    const { text, map, report } = ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(1), geometry: { kind: "point", at: { x: 6, y: 7 } } }]));
    expect(text).toBe(OMAP.replace(`<coords count="1">5000 -6000;</coords>`, `<coords count="1">6000 -7000;</coords>`).replace(/\n<undo>.*<\/undo>/, ""));
    expect(map.objects[1]).toMatchObject({ kind: "point", at: { x: 6, y: 7 } });
    expect(report).toMatchObject({ modified: 1, added: 0, deleted: 0, verification: { untouchedObjects: 4, checkedObjects: 1 } });
    expect(report.edits.map(edit => edit.what)).toEqual(["object", "undo"]);
  });

  it("ändrar en linje med kurva och streckpunkt och behåller okända flaggor på opåverkade punkter", () => {
    const s = setup();
    const line = s.map.objects[0]!;
    if (line.kind !== "line") throw new Error("linje");
    const path = line.path.map((command, i) => (i === line.path.length - 1 ? { ...command, x: 6 } : command));
    const { text, map } = ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(0), geometry: { kind: "line", path } }]));
    expect(text).toContain(`<coords count="7">0 0 1;1000 0;2000 -1000;2000 -2000 4;3000 -2000 32;4000 -2500;6000 -2500;</coords>`);
    expect(plain(map.objects[0]!)).toEqual({ ...plain(line), path });
  });

  it("byter symbol inom samma slag och vägrar fel slag och okänd symbol", () => {
    const s = setup();
    expect(ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(0), symbol: "1" }])).map.objects[0]!.symbol).toBe("1");
    expect(ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(1), symbol: "5" }])).text).toContain(`<object type="0" symbol="5" rotation="0.5">`);
    expect(codes(apply(s, [{ kind: "modify", ...meta, ref: s.ref(0), symbol: "2" }]))).toEqual(["INVALID_CHANGE"]);
    expect(codes(apply(s, [{ kind: "modify", ...meta, ref: s.ref(0), symbol: "99" }]))).toEqual(["INVALID_CHANGE"]);
  });

  it("ändrar text med & och < och textens vinkel", () => {
    const s = setup();
    const { text, map } = ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(3), text: "A & <B>", angle: 90 }]));
    expect(text).toContain(`<object type="4" symbol="4" h_align="1" v_align="2" rotation="1.570796327"><coords count="1">100 -200;</coords><text>A &amp; &lt;B&gt;</text></object>`);
    expect(map.objects[3]).toMatchObject({ kind: "text", text: "A & <B>", angle: 90 });
  });

  it("ändrar ytans vinkel med och utan mönster", () => {
    const s = setup();
    const { text, map } = ok(apply(s, [
      { kind: "modify", ...meta, ref: s.ref(2), angle: 90 },
      { kind: "modify", ...meta, ref: s.ref(4), angle: 45 }
    ]));
    expect(text).toContain(`<pattern rotation="1.570796327"><coord x="0" y="0"/></pattern>`);
    expect(text).toContain(`20000 0 18;</coords><pattern rotation="0.785398163"><coord x="0" y="0"/></pattern></object>`);
    expect(map.objects[2]).toMatchObject({ angle: 90 });
    expect(map.objects[4]).toMatchObject({ angle: 45 });
  });

  it("flyttar en yta med hål och behåller hål- och stängningsflaggorna", () => {
    const s = setup();
    const area = s.map.objects[2]!;
    const { text, map } = ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(2), geometry: geometryOf(area, 1, 0) }]));
    expect(text).toContain(`<coords count="9">1000 0;11000 0;11000 -10000;1000 -10000;1000 0 18;3000 -2000;5000 -2000;5000 -4000;3000 -2000 18;</coords>`);
    expect(plain(map.objects[2]!)).toEqual(plain({ ...area, ...geometryOf(area, 1, 0), kind: "area" } as MapObject));
  });

  it("lägger till punkt, linje och yta med hål sist i kartdelen och räknar om antalet", () => {
    const s = setup();
    const { text, map, report } = ok(apply(s, [
      { kind: "add", ...meta, id: "p", symbol: "2", geometry: { kind: "point", at: { x: 1, y: 2 } }, angle: 30 },
      { kind: "add", ...meta, id: "l", symbol: "0", geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 0, x2: 2, y2: 1, x: 2, y: 2, dash: true }] } },
      { kind: "add", ...meta, id: "a", symbol: "3", geometry: { kind: "area", rings: [
        [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }],
        [{ type: "M", x: 2, y: 2 }, { type: "L", x: 4, y: 2 }, { type: "L", x: 4, y: 4 }]
      ] } }
    ]));
    expect(text).toContain(`<objects count="8">`);
    expect(text).toContain(`20000 0 18;</coords></object>\n<object type="0" symbol="2" rotation="0.523598776"><coords count="1">1000 -2000;</coords></object>\n` +
      `<object type="1" symbol="0"><coords count="4">0 0 1;1000 0;2000 -1000;2000 -2000 32;</coords></object>\n` +
      `<object type="1" symbol="3"><coords count="8">0 0;10000 0;10000 -10000;0 0 18;2000 -2000;4000 -2000;4000 -4000;2000 -2000 18;</coords></object>\n</objects>`);
    expect(map.objects.slice(5).map(object => object.kind)).toEqual(["point", "line", "area"]);
    expect(report.addedObjects.map(row => [row.id, row.locator.format === "OMAP" ? row.locator.ordinal : -1])).toEqual([["p", 5], ["l", 6], ["a", 7]]);
  });

  it("lägger till en text med & och < och läser tillbaka den", () => {
    const s = setup();
    const { text, map } = ok(apply(s, [{ kind: "add", ...meta, id: "t", symbol: "4", geometry: { kind: "text", at: { x: 3, y: -4 } }, text: "Gjord med O-Tid & <fri>" }]));
    expect(text).toContain(`<object type="4" symbol="4" h_align="0" v_align="0"><coords count="1">3000 4000;</coords><text>Gjord med O-Tid &amp; &lt;fri&gt;</text></object>\n</objects>`);
    expect(plain(map.objects.at(-1)!)).toEqual({ kind: "text", symbol: "4", at: { x: 3, y: -4 }, angle: 0, text: "Gjord med O-Tid & <fri>" });
  });

  it("lägger till i en tom kartdel (<objects count=\"0\"/>) och vägrar okänd kartdel", () => {
    const s = setup();
    const { text, map } = ok(apply(s, [{ kind: "add", ...meta, id: "x", part: 1, symbol: "2", geometry: { kind: "point", at: { x: 0, y: 0 } } }]));
    expect(text).toContain(`<part name="Tomt"><objects count="1"><object type="0" symbol="2"><coords count="1">0 0;</coords></object></objects></part>`);
    expect(map.objects).toHaveLength(6);
    expect(codes(apply(s, [{ kind: "add", ...meta, id: "x", part: 5, symbol: "2", geometry: { kind: "point", at: { x: 0, y: 0 } } }]))).toEqual(["INVALID_CHANGE"]);
  });

  it("tar bort ett objekt i mitten och det sista med sina rader", () => {
    const s = setup();
    const { text, map } = ok(apply(s, [{ kind: "delete", ...meta, ref: s.ref(1) }, { kind: "delete", ...meta, ref: s.ref(4) }]));
    expect(text).not.toContain("5000 -6000");
    expect(text).toContain(`<objects count="3">\n<object type="1" symbol="0">`);
    expect(text).toContain(`<text>Djurgårds&amp;brunn</text></object>\n</objects>`);
    expect(map.objects.map(object => object.kind)).toEqual(["line", "area", "text"]);
  });

  it("tar bort och lägger till i samma kartdel när det sista objektet tas bort", () => {
    const s = setup();
    const { text, map } = ok(apply(s, [
      { kind: "delete", ...meta, ref: s.ref(4) },
      { kind: "add", ...meta, id: "n", symbol: "2", geometry: { kind: "point", at: { x: 3, y: 3 } } }
    ]));
    expect(text).toContain(`brunn</text></object>\n<object type="0" symbol="2"><coords count="1">3000 -3000;</coords></object>\n</objects>`);
    expect(map.objects.map(object => object.kind)).toEqual(["line", "point", "area", "text", "point"]);
  });

  it("behåller BOM och CRLF", () => {
    const crlf = OMAP.replace(/\n/g, "\r\n");
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(crlf)]);
    const s = setup(bytes);
    expect(apply(s, []).ok && (apply(s, []) as { bytes: Uint8Array }).bytes).toEqual(bytes);
    const { bytes: out, text } = ok(apply(s, [{ kind: "delete", ...meta, ref: s.ref(1) }]));
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.replace(/^\uFEFF/, "")).toBe(crlf.replace(`\r\n<object type="0" symbol="2" rotation="0.5"><coords count="1">5000 -6000;</coords></object>`, "")
      .replace(`<objects count="5">`, `<objects count="4">`).replace(/\r\n<undo>.*<\/undo>/, ""));
  });

  it("tar bort ångrahistoriken bara när något ändras", () => {
    const s = setup();
    expect(decoder.decode((apply(s, []) as { bytes: Uint8Array }).bytes)).toContain("<undo>");
    const { text, report } = ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(1), angle: 10 }]));
    expect(text).not.toContain("<undo>");
    expect(text).toContain("<redo/>");
    expect(report.edits.filter(edit => edit.what === "undo")).toHaveLength(1);
  });

  it("anger ändringarnas bytes i UTF-8 och hur mycket som är orört", () => {
    const s = setup();
    const result = ok(apply(s, [{ kind: "modify", ...meta, ref: s.ref(3), text: "Älvsjö" }]));
    const [edit] = result.report.edits;
    expect(decoder.decode(s.bytes.subarray(edit!.start, edit!.end))).toMatch(/^<object type="4".*<\/object>$/);
    expect(decoder.decode(result.bytes.subarray(edit!.newStart, edit!.newEnd))).toContain("<text>Älvsjö</text>");
    const changed = result.report.edits.reduce((sum, row) => sum + row.end - row.start, 0);
    expect(result.report.verification.identicalBytes).toBe(s.bytes.length - changed);
  });

  describe("vägrar", () => {
    const s = setup();
    it("fel grundfil och fel format", () => {
      expect(codes(applyMapRevision(s.bytes, { baseFileSha256: "0".repeat(64), format: "OMAP", changes: [] }))).toEqual(["BASE_MISMATCH"]);
      expect(codes(applyMapRevision(s.bytes, { baseFileSha256: s.sha, format: "OCD", changes: [] }))).toEqual(["BASE_MISMATCH"]);
    });
    it("ett objekt som inte stämmer", () => {
      expect(codes(apply(s, [{ kind: "delete", ...meta, ref: { ...s.ref(1), objectHash: "f".repeat(64) } }]))).toEqual(["OBJECT_MISMATCH"]);
      expect(codes(apply(s, [{ kind: "delete", ...meta, ref: { ...s.ref(1), fileSha256: "e".repeat(64) } }]))).toEqual(["OBJECT_MISMATCH"]);
      const moved = s.ref(1);
      expect(codes(apply(s, [{ kind: "delete", ...meta, ref: { ...moved, locator: { ...moved.locator, ordinal: 2 } as ObjectRef["locator"] } }]))).toEqual(["OBJECT_MISMATCH"]);
    });
    it("krockar", () => {
      expect(codes(apply(s, [{ kind: "delete", ...meta, ref: s.ref(1) }, { kind: "modify", ...meta, ref: s.ref(1), angle: 1 }]))).toEqual(["CONFLICT"]);
      const point = { kind: "add" as const, ...meta, id: "a", symbol: "2", geometry: { kind: "point" as const, at: { x: 0, y: 0 } } };
      expect(codes(apply(s, [point, point]))).toEqual(["CONFLICT"]);
    });
    it("nya textobjekt utan text eller med fel symbol, fel geometri och tom geometri", () => {
      expect(codes(apply(s, [{ kind: "add", ...meta, id: "t", symbol: "4", geometry: { kind: "text", at: { x: 0, y: 0 } } }]))).toEqual(["INVALID_CHANGE"]);
      expect(codes(apply(s, [{ kind: "add", ...meta, id: "t", symbol: "2", geometry: { kind: "text", at: { x: 0, y: 0 } }, text: "Hej" }]))).toEqual(["INVALID_CHANGE"]);
      expect(codes(apply(s, [{ kind: "modify", ...meta, ref: s.ref(1), geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 1 }] } }]))).toEqual(["INVALID_CHANGE"]);
      expect(codes(apply(s, [{ kind: "add", ...meta, id: "l", symbol: "0", geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }] } }]))).toEqual(["INVALID_CHANGE"]);
      expect(codes(apply(s, [{ kind: "add", ...meta, id: "l", symbol: "0", geometry: { kind: "point", at: { x: 0, y: 0 } } }]))).toEqual(["INVALID_CHANGE"]);
      expect(codes(apply(s, [{ kind: "modify", ...meta, ref: s.ref(0), angle: 5 }]))).toEqual(["INVALID_CHANGE"]);
    });
    it("OCAD (kommer i K7)", () => {
      const bytes = buildOcd(SPEC);
      expect(codes(applyMapRevision(bytes, { baseFileSha256: sha256Hex(bytes), format: "OCD", changes: [] }))).toEqual(["UNSUPPORTED_VERSION"]);
    });
    it("ogiltig UTF-8", () => {
      const raw = encoder.encode(OMAP.replace("Djurgårds", "Djurg@rds"));
      raw[raw.indexOf(64)] = 0xff;
      const change: MapRevisionChangeSet = { baseFileSha256: sha256Hex(raw), format: "OMAP", changes: [{ kind: "delete", ...meta, ref: s.ref(1) }] };
      expect(codes(applyMapRevision(raw, change))).toEqual(["UNSAFE_FILE"]);
    });
  });
});

/** En Mapper-fil med många objekt av alla slag i två kartdelar. */
function bigMap(random: () => number): string {
  const n = (scale: number) => Math.round((random() - 0.5) * scale);
  const object = (k: number) => {
    switch (k % 4) {
      case 0: return `<object type="0" symbol="2" rotation="${(random() * 6).toFixed(3)}"><coords count="1">${n(1e5)} ${n(1e5)};</coords></object>`;
      case 1: return `<object type="1" symbol="0"><coords count="5">${n(1e5)} ${n(1e5)} 1;${n(1e5)} ${n(1e5)};${n(1e5)} ${n(1e5)};${n(1e5)} ${n(1e5)} 4;${n(1e5)} ${n(1e5)} 32;</coords></object>`;
      case 2: return `<object type="1" symbol="3"><coords count="5">0 0;${n(1e5)} 0;${n(1e5)} ${n(1e5)};0 ${n(1e5)};0 0 18;</coords></object>`;
      default: return `<object type="4" symbol="4"><coords count="1">${n(1e5)} ${n(1e5)};</coords><text>T${k} &amp; å</text></object>`;
    }
  };
  const part = (name: string, count: number, offset: number) =>
    `<part name="${name}"><objects count="${count}">\n${Array.from({ length: count }, (_, k) => object(k + offset)).join("\n")}\n</objects></part>`;
  return OMAP.replace(/<parts count="2" current="0">[\s\S]*<\/parts>/, `<parts count="2" current="1">\n${part("A", 40, 0)}\n${part("B", 30, 1)}\n</parts>`);
}

describe("Mapper: kontrollen efter skrivningen", () => {
  it("hittar ett orört objekt som ändrats, ett nytt som läses fel och ett ändrat huvud", () => {
    const s = setup();
    const changeSet: MapRevisionChangeSet = { baseFileSha256: s.sha, format: "OMAP", changes: [
      { kind: "add", ...meta, id: "p", symbol: "2", geometry: { kind: "point", at: { x: 1, y: 2 } } }
    ] };
    const map = readOmap(OMAP, { sources: true });
    const raw = scanParts(OMAP);
    const planned = planOmapRevision(OMAP, map, raw, changeSet);
    if (!planned.ok) throw new Error("plan");
    let text = OMAP;
    for (const edit of [...planned.plan.edits].reverse()) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    expect(verifyOmap(OMAP, raw, text, planned.plan).ok).toBe(true);
    expect(verifyOmap(OMAP, raw, text.replace("5000 -6000;", "5000 -6001;"), planned.plan)).toMatchObject({ ok: false });
    expect(verifyOmap(OMAP, raw, text.replace("1000 -2000;", "1000 -2001;"), planned.plan)).toMatchObject({ ok: false });
    expect(verifyOmap(OMAP, raw, text.replace(`name="Gul"`, `name="Gul!"`), planned.plan)).toMatchObject({ ok: false });
    expect(verifyOmap(OMAP, raw, text.replace(`<objects count="6">`, `<objects count="7">`), planned.plan)).toMatchObject({ ok: false });
  });
});

describe("Mapper: slumpade ändringssatser", () => {
  it("lämnar orörda objekt oförändrade och läser tillbaka ändrade och nya som beställt", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seededRandom(seed);
      const s = setup(bigMap(random));
      const changes: MapRevisionChange[] = [];
      const touched = new Set<number>();
      const expected = new Map<number, MapObject | null>();
      s.map.objects.forEach((object, index) => {
        const roll = random();
        if (roll < 0.1) { changes.push({ kind: "delete", ...meta, ref: s.ref(index) }); touched.add(index); expected.set(index, null); }
        else if (roll < 0.25) {
          const dx = Math.round((random() - 0.5) * 2000) / 1000, dy = Math.round((random() - 0.5) * 2000) / 1000;
          const geometry = geometryOf(object, dx, dy);
          changes.push({ kind: "modify", ...meta, ref: s.ref(index), geometry });
          touched.add(index);
          expected.set(index, { ...plain(object), ...(geometry.kind === "line" ? { path: geometry.path } : geometry.kind === "area" ? { rings: geometry.rings } : { at: geometry.at }) } as MapObject);
        }
      });
      const adds = Math.floor(random() * 4);
      for (let k = 0; k < adds; k++) {
        changes.push({ kind: "add", ...meta, id: `n${k}`, symbol: "2", part: Math.floor(random() * 2), geometry: { kind: "point", at: { x: k, y: -k } } });
      }
      const result = apply(s, changes);
      const { map, text, report } = ok(result);
      const original = decoder.decode(s.bytes);
      const kept = s.map.objects.filter((_object, index) => !touched.has(index));
      for (const object of kept) expect(text, `frö ${seed}`).toContain(original.slice(object.source!.locator.format === "OMAP" ? object.source!.locator.start : 0, (object.source!.locator as { end: number }).end));
      const keptHashes = kept.map(object => object.source!.objectHash);
      const newHashes = new Set(map.objects.map(object => object.source!.objectHash));
      expect(keptHashes.every(hash => newHashes.has(hash)), `frö ${seed}`).toBe(true);
      expect(map.objects).toHaveLength(s.map.objects.length - [...expected.values()].filter(value => value === null).length + adds);
      expect(report.verification.checkedObjects).toBe(changes.filter(change => change.kind !== "delete").length);
      // Ordningen inom en kartdel är kvar: de orörda och ändrade i sin ordning, de nya sist.
      const survivors = s.map.objects.flatMap((object, index) => (expected.get(index) === null ? [] : [{ index, part: (object.source!.locator as { part: number }).part }]));
      for (const partIndex of [0, 1]) {
        const before = survivors.filter(row => row.part === partIndex);
        const after = map.objects.filter(object => (object.source!.locator as { part: number }).part === partIndex);
        before.forEach((row, k) => {
          const want = expected.get(row.index) ?? plain(s.map.objects[row.index]!);
          const got = plain(after[k]!);
          if (want.kind === "point" || want.kind === "text") expect(got).toMatchObject({ kind: want.kind, symbol: want.symbol });
          else expect(got.kind).toBe(want.kind);
        });
      }
    }
  });
});

describe("Mapper: fixturkartorna", () => {
  for (const name of ["kartfil.omap", "vagval.omap"]) {
    it(`${name}: tom sats och några ändringar`, () => {
      const s = setup(new Uint8Array(readFileSync(new URL(`../../../fixtures/maps/${name}`, import.meta.url))));
      expect((apply(s, []) as { bytes: Uint8Array }).bytes).toEqual(s.bytes);
      const line = s.map.objects.findIndex(object => object.kind === "line");
      const changes: MapRevisionChange[] = s.map.objects.slice(0, 3).map((object, index) => ({ kind: "modify", ...meta, ref: s.ref(index), geometry: geometryOf(object, 1, -1) }));
      changes.push({ kind: "delete", ...meta, ref: s.ref(s.map.objects.length - 1) });
      changes.push({ kind: "add", ...meta, id: "ny", symbol: s.map.objects[line]!.symbol, geometry: { kind: "line", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 5, y: 5 }] } });
      const { map, report } = ok(apply(s, changes));
      expect(map.objects).toHaveLength(s.map.objects.length);
      expect(report).toMatchObject({ modified: 3, added: 1, deleted: 1 });
      expect(map.warnings).toEqual(s.map.warnings);
    });
  }
});
