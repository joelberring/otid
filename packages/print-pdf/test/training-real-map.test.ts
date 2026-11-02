import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, emptyDocument, presetFilter, printSheetGroups, symbolCatalog, type CourseSettingDocument
} from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { writeSheetsPdf } from "../src";
import { fontFiles } from "./helpers";

/**
 * Träningsläget på en riktig karta (ADR-0192), bara när ägarens kartfil finns lokalt: `OTID_REAL_MAP` (t.ex. Högdalen,
 * aldrig i repot). Symbolerna grupperas, en påhittad bana över kartan får korridor, bara kurvbild och fönster, och PDF:en
 * skrivs (till `OTID_TRAINING_REAL_OUT` om satt) för att granskas med pdftoppm.
 */
const path = process.env.OTID_REAL_MAP;
const has = path !== undefined && existsSync(path);

describe.skipIf(!has)("träningsläget på ägarens karta (OTID_REAL_MAP)", () => {
  it("grupperar symbolerna, lägger avsnitt i följd och skriver PDF:en", async () => {
    const map = readMapFile(new Uint8Array(readFileSync(path!)), basename(path!));
    const catalog = symbolCatalog(map);
    const other = catalog.filter(row => row.group === "OTHER");
    console.log(`symboler ${catalog.length}, övrigt ${other.length}: ${other.map(row => `${row.code} ${row.name}`).slice(0, 12).join("; ")}`);
    expect(catalog.filter(row => row.group === "LANDFORM").length).toBeGreaterThan(2);
    expect(other.length).toBeLessThan(catalog.length / 4);
    const bounds = map.bounds!;
    const at = (fx: number, fy: number) => ({ x: bounds.minX + (bounds.maxX - bounds.minX) * fx, y: bounds.minY + (bounds.maxY - bounds.minY) * fy });
    let document: CourseSettingDocument = emptyDocument({ title: "Träning", mapScale: map.scale });
    const add = (kind: "START" | "NORMAL" | "FINISH", fx: number, fy: number) => {
      const result = applyEdit(document, { type: "ADD_CONTROL", kind, at: at(fx, fy) });
      document = result.document;
      return result.created!;
    };
    add("START", 0.3, 0.3);
    const controls = [add("NORMAL", 0.4, 0.45), add("NORMAL", 0.5, 0.4), add("NORMAL", 0.6, 0.55), add("NORMAL", 0.55, 0.65), add("NORMAL", 0.4, 0.6)];
    add("FINISH", 0.32, 0.35);
    const created = applyEdit(document, { type: "ADD_COURSE", name: "Träning" });
    document = created.document;
    const course = created.created!;
    for (const control of controls) document = applyEdit(document, { type: "INSERT_COURSE_CONTROL", course, control }).document;
    const cc = (control: string) => Object.values(document.courseControls).find(item => item.control === control)!.id;
    document = applyEdit(document, { type: "PUT_TRAINING", courses: { [course]: { outside: { kind: "TINT", lighten: 0.8 }, sections: [
      { id: "a", from: null, to: cc(controls[1]!), form: "CORRIDOR", corridor: { shape: "SMOOTH", widthMeters: 80, smoothing: 0.5 }, filter: presetFilter("ALL"), marker: { kind: "NONE" } },
      { id: "b", from: cc(controls[1]!), to: cc(controls[3]!), form: "BAND", bandMeters: 250, filter: presetFilter("CONTOURS"), marker: { kind: "TEXT" } },
      { id: "c", from: cc(controls[3]!), to: null, form: "WINDOW", window: { shape: "CIRCLE", radiusMeters: 60 }, filter: presetFilter("ALL"), marker: { kind: "TEXT" } }
    ] } }, attackPoints: { t: { id: "t", from: controls[2]!, to: controls[3]!, at: at(0.57, 0.5) } } }).document;
    const sheets = printSheetGroups(document, { kind: "COURSE", header: true }, [{ course }], { mapBounds: bounds }).flatMap(group => group.sheets);
    const started = Date.now();
    const result = await writeSheetsPdf({ sheets, map, profile: BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!, mode: "PRESS", fonts: fontFiles(),
      descriptionStandard: "2018", title: "Träning" });
    console.log(`PDF ${result.pages} sidor, ${Math.round(result.bytes.byteLength / 1024)} kB, ${Date.now() - started} ms, plåtar ${result.plates.join(", ")}`);
    if (process.env.OTID_TRAINING_REAL_OUT) writeFileSync(process.env.OTID_TRAINING_REAL_OUT, result.bytes);
    expect(result.pages).toBeGreaterThan(0);
  }, 300_000);
});
