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
  it("över banan: bara äkta övre vitt (vitt för rött överst), svart, brunt och rött; gloria, järnvägens vitt och odlad mark under", () => {
    expect(names(colorsOverCourse(map, profile))).toEqual(["Röd", "Vit för röd", "Svart 100%", "Brun 100%"]);
  });

  it("den gröna ringen ritas efter sin vita gloria, båda under banan", async () => {
    const { under, over } = await write();
    expect(under).toContain(GREEN_RING);
    expect(under.lastIndexOf(WHITE_FILL)).toBeGreaterThan(-1);
    expect(under.lastIndexOf(WHITE_FILL)).toBeLessThan(under.indexOf(GREEN_RING));
    expect(over).not.toContain(GREEN_RING);
  });

  it("järnvägens svarta streck ritas efter den vita linjen under dem", async () => {
    const { under, over } = await write();
    const white = under.indexOf(WHITE_STROKE);
    expect(white).toBeGreaterThan(-1);
    expect(under.indexOf(BLACK_STROKE, white)).toBeGreaterThan(white);
    expect(over).not.toContain(WHITE_STROKE);
  });

  it("vitt trycks aldrig med övertryck (det syns inte då); vitt för rött över banan slår ut", async () => {
    const { over, under } = await write();
    for (const form of [over, under]) {
      for (let at = form.indexOf(WHITE_FILL); at >= 0; at = form.indexOf(WHITE_FILL, at + 1)) {
        // Innehållet börjar i knockout (GKO); efter ett GOP måste ett GKO komma före vitt.
        const overprint = form.lastIndexOf("/GOP gs", at);
        expect(overprint === -1 || form.lastIndexOf("/GKO gs", at) > overprint).toBe(true);
      }
    }
    expect(over).toContain(WHITE_FILL);
    // Rött och svart över banan med övertryck.
    expect(over.lastIndexOf("/GOP gs", over.indexOf(BLACK_STROKE))).toBeGreaterThan(over.lastIndexOf("/GKO gs", over.indexOf(BLACK_STROKE)));
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

  it("kontorsskrivaren: samma lager, kartans färger över banan multiplicerade (inget övertryck i filen), vitt slår ut", async () => {
    const { pdf, over, result } = await write({ mode: "OFFICE", profile: officePrintProfile(profile) });
    expect(pdf.extGStates.get("GOP")).toMatchObject({ BM: "/Multiply" });
    expect(pdf.extGStates.get("GOP")).not.toHaveProperty("OP");
    expect(over).toMatch(/\/GOP gs/);
    expect(result.overprint).toBe(false);
    expect(result.notes.some(note => /multiplicerade/.test(note))).toBe(true);
    const white = over.indexOf(WHITE_FILL);
    const multiply = over.lastIndexOf("/GOP gs", white);
    expect(multiply === -1 || over.lastIndexOf("/GKO gs", white) > multiply).toBe(true);
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
    // Numret: bildpunkter där brunt ligger över lila med övertryck (cyan från lila, gult och svart från brunt) blir fler med
    // numren i undre lila; överst slår numret ut brunt (banans lila utan övertryck, som BL).
    const mixed = async (options: Partial<WritePdfInput>) => {
      const written = await write(options);
      const label = written.sheets[0]!.frames[0]!.figures.find(figure => figure.kind === "text" && figure.role === "NUMBER");
      if (!label || label.kind !== "text") throw new Error("inget nummer");
      const box = rasterize(written.result.bytes, written.sheets[0]!.paper.widthMm);
      let count = 0;
      for (let dx = -label.heightMm; dx <= label.heightMm; dx += 0.05) {
        for (let dy = -label.heightMm; dy <= label.heightMm; dy += 0.05) {
          const pixel = box.at(toPage(frame, { x: label.at.x + dx, y: label.at.y + dy }));
          if (pixel.c > 0.1 && pixel.y > 0.8 && pixel.k > 0.1) count += 1;
        }
      }
      return count;
    };
    expect(await mixed({})).toBeGreaterThan(await mixed({ profile: { ...profile, numbersOnTop: true } }) + 20);
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
