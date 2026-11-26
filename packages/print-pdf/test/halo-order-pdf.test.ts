/**
 * ADR-0211 beslut 3 och 11: normen bestämmer bara sidan av banan, kartfilens ordning gäller inom varje sida. Ägarens
 * provtryck (Stockholm by Night, skog 1:10 000): de gröna träden blev vita skivor (vitt lyftes över banan, ringen låg
 * kvar under), järnvägen fick vita streck över de svarta och numren täckte kurvorna. Kartan är påhittad (`halo-map.ts`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, emptyDocument, layoutCoursePage, officePrintProfile, sheetOfPage, toPage,
  type CourseSettingDocument, type CourseSettingEdit, type PrintProfile
} from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { colorsOverCourse, writeSheetsPdf, type WritePdfInput } from "../src";
import { HALO_OMAP, HALO_RAILWAY, HALO_TREES, RING } from "./halo-map";
import { fontFiles, parsePdf } from "./helpers";

/** Som BL-profilerna: CMYK, banan i normens ordning och banans lila utan övertryck (numren slår ut det de ligger på). */
const profile: PrintProfile = { ...BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!, id: "halo", courseLayer: "REFERENCE", processColors: true,
  pressNorm: "ISOM", course: { cmyk: { c: 20, m: 100, y: 0, k: 0 }, spotName: "Purple", overprint: false, process: true } };

const fonts = fontFiles();
const map = readMapFile(new TextEncoder().encode(HALO_OMAP), "halo.omap");

function sheets() {
  let document: CourseSettingDocument = emptyDocument({ title: "Halo", mapScale: 10000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const start = edit({ type: "ADD_CONTROL", kind: "START", at: { x: 20, y: 20 } });
  const control = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "38" });
  const finish = edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 80, y: 20 } });
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of [start, control, finish]) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  return layoutCoursePage(document, { course, mapBounds: map.bounds ?? undefined }).map(sheetOfPage);
}

async function write(options: Partial<WritePdfInput> = {}) {
  const list = sheets();
  const result = await writeSheetsPdf({ sheets: list, map, profile, mode: "PRESS", fonts, title: "Halo", ...options });
  const pdf = await parsePdf(result.bytes);
  const forms = [...pdf.forms.values()];
  return { result, pdf, sheets: list, content: pdf.pages[0]!.content, under: forms[0]!, over: forms[1]! };
}

const WHITE_FILL = "0 0 0 0 k", WHITE_STROKE = "0 0 0 0 K", GREEN_RING = "0.76 0 0.91 0 K", BLACK_STROKE = "0 0 0 1 K";
const names = (ids: ReadonlySet<number> | undefined) => map.colors.filter(color => ids?.has(color.id)).map(color => color.name);

describe("kartfilens ordning inom varje sida av banan (ägarens provtryck)", () => {
  it("över banan: monoton snittpunkt från Brun 100% uppåt (inkl. vit gloria + grön ring i obruten ordning); järnväg och odlad mark under", () => {
    expect(names(colorsOverCourse(map, profile))).toEqual(["Röd", "Vit för röd", "Grön 100% – Punktobjekt", "Vit över grön", "Svart 100%", "Brun 100%"]);
  });

  it("den gröna ringen ritas efter sin vita gloria i obruten ritordning över banan", async () => {
    const { under, over } = await write();
    expect(over).toContain(GREEN_RING);
    expect(under).not.toContain(GREEN_RING);
    // Vit över grön ligger direkt före Grön 100% – Punktobjekt i OVER, och efter svart/brunt.
    const halo = over.lastIndexOf(WHITE_FILL, over.indexOf(GREEN_RING));
    expect(halo).toBeGreaterThan(-1);
    expect(over.indexOf(BLACK_STROKE)).toBeLessThan(halo);
  });

  it("järnvägens svarta streck ritas efter den vita linjen under dem", async () => {
    const { under, over } = await write();
    const white = under.indexOf(WHITE_STROKE);
    expect(white).toBeGreaterThan(-1);
    expect(under.indexOf(BLACK_STROKE, white)).toBeGreaterThan(white);
    expect(over).not.toContain(WHITE_STROKE);
  });

  it("vitt trycks aldrig med övertryck (det syns inte då); ren knockout i PROCESS utan TAC-blödning", async () => {
    const { over, under } = await write();
    for (const form of [over, under]) {
      expect(form).not.toContain("/GOP gs");
    }
    expect(over).toContain(WHITE_FILL);
    expect(over).toContain(BLACK_STROKE);
  });

  it("ISOM: numret i undre lila före kartans färger över banan; \"Kontrollnummer och texter överst\" lägger det efter", async () => {
    const number = "0.2 1 0 0 k";
    const lower = await write();
    expect(lower.content.indexOf(number)).toBeGreaterThan(-1);
    expect(lower.content.indexOf(number)).toBeLessThan(lower.content.indexOf("/Fm1 Do"));
    const top = await write({ profile: { ...profile, numbersOnTop: true } });
    expect(top.content.lastIndexOf(number)).toBeGreaterThan(top.content.indexOf("/Fm1 Do"));
    const sprint = await write({ profile: { ...profile, pressNorm: "ISSPROM" } });
    expect(sprint.content.lastIndexOf(number)).toBeGreaterThan(sprint.content.indexOf("/Fm1 Do"));
  });

  it("kontorsskrivaren: samma lager, isolerade INK-band med Darken på sidan (noll intern blödning), WHITE-band med knockout", async () => {
    const { pdf, content, result } = await write({ mode: "OFFICE", profile: officePrintProfile(profile) });
    expect(pdf.extGStates.get("GOP")).toMatchObject({ BM: "/Darken" });
    expect(pdf.extGStates.get("GOP")).not.toHaveProperty("OP");
    expect(result.overprint).toBe(false);
    expect(result.notes.some(note => /lila syns genom dem/.test(note))).toBe(true);
    // Inuti alla kartutsnitt råder knockout (inga /GOP gs inuti Form XObjects → noll TAC-blödning).
    for (const form of pdf.forms.values()) expect(form).not.toContain("/GOP gs");
    // På sidan placeras isolerade INK-band med /GOP gs (/BM /Darken) och WHITE-band utan /GOP gs (knockout).
    const isolated = [...pdf.formGroups.entries()].filter(([, g]) => g.S === "/Transparency" && g.CS === "/DeviceCMYK" && g.I === "true");
    expect(isolated.length).toBeGreaterThanOrEqual(2);
    for (const [name] of isolated) {
      const at = content.indexOf(`/${name} Do`);
      expect(content.slice(content.lastIndexOf("\nq\n", at), at)).toContain("/GOP gs");
    }
    const whiteBands = [...pdf.forms.entries()].filter(([name, body]) => name !== "Fm0" && !pdf.formGroups.has(name) && body.includes(WHITE_FILL));
    expect(whiteBands.length).toBeGreaterThanOrEqual(1);
    for (const [name] of whiteBands) {
      const at = content.indexOf(`/${name} Do`);
      expect(content.slice(content.lastIndexOf("\nq\n", at), at)).not.toContain("/GOP gs");
    }
  });

  it("tryck-PDF:en har ingen genomskinlighet (bara /OP och /OPM)", async () => {
    const { pdf } = await write();
    for (const state of pdf.extGStates.values()) expect(state).not.toHaveProperty("BM");
  });

  // Ghostscript (bitcmyk, simulerar övertryck): pixlarna på sidan.
  it.skipIf(!hasGhostscript())("Ghostscript: ringen är grön, järnvägen svart och kurvorna korsar numret i skog", async () => {
    const { result, sheets: list } = await write();
    const frame = list[0]!.frames[0]!;
    const raster = rasterize(result.bytes, list[0]!.paper.widthMm);
    const at = (point: { x: number; y: number }) => raster.at(toPage(frame, point));
    const tree = HALO_TREES[1]!;
    const ring = at({ x: tree.x + (RING.inner + RING.outer) / 2, y: tree.y });
    expect(ring.c).toBeGreaterThan(0.6);
    expect(ring.y).toBeGreaterThan(0.8);
    let black = 0;
    for (let x = HALO_RAILWAY.from.x + 1; x < HALO_RAILWAY.to.x - 1; x += 0.1) if (at({ x, y: HALO_RAILWAY.from.y }).k > 0.9) black += 1;
    expect(black).toBeGreaterThan(100);
    // Numret: i ren PROCESS-enpassordning skär bruna kurvor (y > 0,8, k > 0,1) skarpt över undre lila; överst täcker numret kurvorna.
    const brownPixels = async (options: Partial<WritePdfInput>) => {
      const written = await write(options);
      const label = written.sheets[0]!.frames[0]!.figures.find(figure => figure.kind === "text" && figure.role === "NUMBER");
      if (!label || label.kind !== "text") throw new Error("inget nummer");
      const box = rasterize(written.result.bytes, written.sheets[0]!.paper.widthMm);
      let count = 0;
      for (let dx = -label.heightMm; dx <= label.heightMm; dx += 0.05) {
        for (let dy = -label.heightMm; dy <= label.heightMm; dy += 0.05) {
          const pixel = box.at(toPage(frame, { x: label.at.x + dx, y: label.at.y + dy }));
          if (pixel.y > 0.8 && pixel.k > 0.1) count += 1;
        }
      }
      return count;
    };
    expect(await brownPixels({})).toBeGreaterThan(await brownPixels({ profile: { ...profile, numbersOnTop: true } }) + 20);
  });
});

function hasGhostscript(): boolean {
  try { execFileSync("gs", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

/** Sidan i CMYK (0–1) renderad av Ghostscript i 288 dpi; `at` tar mm från övre vänstra hörnet. */
function rasterize(bytes: Uint8Array, widthMm: number) {
  const directory = mkdtempSync(join(tmpdir(), "otid-halo-"));
  const dpi = 288;
  try {
    writeFileSync(join(directory, "halo.pdf"), bytes);
    execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=bitcmyk", "-dGrayValues=256", `-r${dpi}`, "-dFirstPage=1", "-dLastPage=1",
      `-sOutputFile=${join(directory, "halo.cmyk")}`, join(directory, "halo.pdf")]);
    const raw = readFileSync(join(directory, "halo.cmyk"));
    const width = Math.round(widthMm / 25.4 * dpi);
    return {
      at(point: { x: number; y: number }) {
        const index = (Math.round(point.y / 25.4 * dpi) * width + Math.round(point.x / 25.4 * dpi)) * 4;
        return { c: raw[index]! / 255, m: raw[index + 1]! / 255, y: raw[index + 2]! / 255, k: raw[index + 3]! / 255 };
      }
    };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
