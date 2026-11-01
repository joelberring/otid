/**
 * Vägvalsanalysen på ägarens riktiga kartfiler (Djurgården 2025 i OCAD och Mapper, Purple Pens banfil för Natt-KM
 * 2026; Högdalen med Purple Pens banfil för Stockholm by Night 2026). Filerna är klubbens och committas inte; testen körs bara när
 * OTID_REAL_MAP_DIR respektive OTID_SBN_DIR pekar på mapparna.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMapFile, type Point } from "@o-tid/map-file";
import { courseVariants, readPpen } from "@o-tid/course-setting";
import { analyseCourse, analyseLeg, buildCostModel, legGrid, type LegAnalysis, type LegInput } from "../src";
import { NO_TRACK, type Grid } from "../src/raster";

const directory = process.env.OTID_REAL_MAP_DIR;
const COURSE = process.env.OTID_REAL_COURSE ?? "H21";
const sbnDirectory = process.env.OTID_SBN_DIR;

function find(suffix: string, folder = directory): string {
  const name = readdirSync(folder!).find(file => file.normalize("NFC").toLowerCase().endsWith(suffix));
  if (!name) throw new Error(`Hittar ingen fil som slutar på ${suffix} i ${folder}`);
  return join(folder!, name);
}

function readLegs(path: string, course: string): LegInput[] {
  const xml = readFileSync(path, "utf8");
  const controls = new Map<string, Point>();
  for (const match of xml.matchAll(/<Control\b[^>]*>([\s\S]*?)<\/Control>/g)) {
    const id = /<Id>([^<]*)<\/Id>/.exec(match[1]!)?.[1];
    const position = /<MapPosition x="([^"]+)" y="([^"]+)"/.exec(match[1]!);
    if (id && position) controls.set(id, { x: Number(position[1]), y: Number(position[2]) });
  }
  const body = [...xml.matchAll(/<Course>([\s\S]*?)<\/Course>/g)].map(match => match[1]!)
    .find(text => /<Name>([^<]*)<\/Name>/.exec(text)?.[1] === course);
  if (!body) throw new Error(`Banan ${course} saknas`);
  const ids = [...body.matchAll(/<Control>([^<]*)<\/Control>/g)].map(match => match[1]!);
  const others = ids.map(id => ({ code: id, at: controls.get(id)! }));
  return ids.slice(1).map((id, index) => ({
    key: `${ids[index]}-${id}`, from: controls.get(ids[index]!)!, to: controls.get(id)!, otherControls: others
  }));
}

function analyse(suffix: string, legs: readonly LegInput[]): { results: LegAnalysis[]; modelMs: number } {
  const map = readMapFile(new Uint8Array(readFileSync(find(suffix))));
  const started = performance.now();
  const model = buildCostModel(map);
  const modelMs = performance.now() - started;
  expect(model.unknownSymbols, suffix).toEqual([]);
  return { results: analyseCourse(model, legs), modelMs };
}

describe.skipIf(!directory)("vägval på riktiga kartfiler (OTID_REAL_MAP_DIR)", () => {
  it(`analyserar ${COURSE} i OCAD och Mapper med samma resultat`, () => {
    const legs = readLegs(find(".xml"), COURSE);
    const ocd = analyse(".ocd", legs);
    const omap = analyse(".omap", legs);
    const rows = [`kostnadsmodell: OCD ${ocd.modelMs.toFixed(0)} ms, Mapper ${omap.modelMs.toFixed(0)} ms`,
      "sträcka      fågel  bästa  kvot  stign  besked        alt  OCD ms  Mapper ms  varningar"];
    legs.forEach((leg, index) => {
      const a = ocd.results[index]!, b = omap.results[index]!;
      rows.push([
        leg.key.padEnd(10), a.straightMeters.toFixed(0).padStart(6), (a.best?.meters ?? NaN).toFixed(0).padStart(6),
        ((a.best?.meters ?? NaN) / a.straightMeters).toFixed(2).padStart(5), (a.best?.climbMeters ?? 0).toFixed(0).padStart(5),
        `  ${a.verdict.padEnd(12)}`, String(a.alternatives.length).padStart(3), a.milliseconds.toFixed(0).padStart(7),
        b.milliseconds.toFixed(0).padStart(10), `  ${a.warnings.map(w => w.kind + ("code" in w ? ` ${w.code}` : "")).join(", ")}`
      ].join(" "));
    });
    console.info(rows.join("\n"));

    for (const [index, leg] of legs.entries()) {
      for (const result of [ocd.results[index]!, omap.results[index]!]) {
        expect(result.warnings, leg.key).not.toContainEqual({ kind: "NO_ROUTE" });
        expect(result.best!.meters, leg.key).toBeGreaterThanOrEqual(result.straightMeters * 0.999);
        expect(result.best!.meters, leg.key).toBeLessThanOrEqual(result.straightMeters * 2.5);
        for (const alternative of result.alternatives) expect(alternative.timeRatio, leg.key).toBeGreaterThanOrEqual(0.999);
      }
      const a = ocd.results[index]!, b = omap.results[index]!;
      expect(b.verdict, leg.key).toBe(a.verdict);
      expect(b.best!.meters, leg.key).toBeCloseTo(a.best!.meters, -1);
    }
  }, 120_000);

  it("räknar en sträcka på 1,5 km i terräng på under 1 s", () => {
    // Från kontroll 41 mot sydväst, 1 500 m i terrängen (100 mm på kartan i 1:15 000). Första körningen värmer upp.
    const model = buildCostModel(readMapFile(new Uint8Array(readFileSync(find(".ocd")))));
    const from = { x: 168.01, y: 746.94 };
    const to = { x: from.x + 100 * Math.cos(225 * Math.PI / 180), y: from.y + 100 * Math.sin(225 * Math.PI / 180) };
    const times: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const result = analyseCourse(model, [{ key: "41-P", from, to }])[0]!;
      expect(result.best).toBeDefined();
      times.push(result.milliseconds);
    }
    const warm = Math.min(...times.slice(1));
    console.info(`1,5 km: ${times.map(t => t.toFixed(0)).join(", ")} ms (bästa efter uppvärmning ${warm.toFixed(0)} ms)`);
    expect(warm).toBeLessThan(1000);
  }, 60_000);
});

describe.skipIf(!sbnDirectory)("vägval i Högdalen, Stockholm by Night 2026 (OTID_SBN_DIR)", () => {
  /** Sträckorna för en bana ur Purple Pen-filen, alla varianter (gafflingar), nycklade "kod-kod". */
  function ppenLegs(course: string): Map<string, LegInput> {
    const { document } = readPpen(readFileSync(find("sbn26_2.ppen", sbnDirectory), "utf8"));
    const id = document.courses.find(item => item.name === course)!.id;
    const legs = new Map<string, LegInput>();
    for (const variant of courseVariants(document, id)) {
      const points = variant.courseControls.map(control => document.controls[document.courseControls[control]!.control]!);
      points.slice(1).forEach((to, index) => {
        const from = points[index]!;
        const key = `${from.code ?? from.kind}-${to.code ?? to.kind}`;
        legs.set(key, { key, from: from.at, to: to.at });
      });
    }
    return legs;
  }

  /** Andelen av linjen (längd) som går på väg eller stig i rutnätet. */
  function trackShare(grid: Grid, points: readonly Point[]): number {
    let on = 0, total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!, b = points[index]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.cellMm / 2)));
      for (let step = 0; step < steps; step += 1) {
        const x = a.x + (b.x - a.x) * (step + 0.5) / steps, y = a.y + (b.y - a.y) * (step + 0.5) / steps;
        const col = Math.floor((x - grid.x0) / grid.cellMm), row = Math.floor((grid.yTop - y) / grid.cellMm);
        // En cell åt varje håll: linjen är utjämnad och kan ligga en halv cell vid sidan av stigen.
        let track = false;
        for (let dr = -1; dr <= 1 && !track; dr += 1) for (let dc = -1; dc <= 1 && !track; dc += 1) {
          track = grid.track[(row + dr) * grid.width + col + dc] !== NO_TRACK;
        }
        if (track) on += 1;
        total += 1;
      }
    }
    return on / total;
  }

  /**
   * Ägarens rapport 2026-11-01: på bana A, kontroll 8 till 9, valde analysen en lång väg runt kullens fot i vit skog
   * med skrå och branter i stället för över kullen med öppen mark på toppen. Gafflingen ger två sträckor 8–9: 36–37
   * (ACEG) och 36–56 (ADEG). Förr räknades nedför som uppför (16 passager över kullen = 640 m), och skrå, branter och
   * tät kurvbild var gratis.
   */
  it("går inte längre runt kullens fot i vit skog, och vägen över kullen är ett jämbördigt vägval", () => {
    const model = buildCostModel(readMapFile(new Uint8Array(readFileSync(find(".ocd", sbnDirectory)))));
    const legs = ppenLegs("A");
    const results = ["36-37", "36-56"].map(key => ({ input: legs.get(key)!, result: analyseLeg(model, legs.get(key)!) }));
    for (const { input, result } of results) {
      const lines = [{ ...result.best!, timeRatio: 1 }, ...result.alternatives];
      const grid = legGrid(model, input);
      console.info(input.key, result.verdict, Math.round(result.straightMeters), `${Math.round(result.milliseconds)} ms`, lines.map(line =>
        `${Math.round(line.meters)} m, ${Math.round(line.climbMeters)} m upp, ${Math.round(trackShare(grid, line.points) * 100)} % stig, ` +
        `+${Math.round((line.timeRatio - 1) * 100)} %`).join(" | "));
      expect(result.verdict, input.key).not.toBe("NO_CHOICE");
      // Förr gick bästa vägen till stor del i skogen nedanför stigen (36–37: 594 m, 36–56: 449 m); nu längs stigen
      // utom de första och sista metrarna till kontrollerna, som står i skogen.
      expect(trackShare(grid, result.best!.points), input.key).toBeGreaterThan(0.7);
    }
    // 36–37: vägen över kullen (högst 25 % längre än fågelvägen) är jämbördig (inom osäkerheten ±15 %).
    const [toThirtySeven] = results;
    const over = toThirtySeven!.result.alternatives.find(alternative => alternative.meters <= toThirtySeven!.result.straightMeters * 1.25);
    expect(over).toBeDefined();
    expect(over!.timeRatio).toBeLessThanOrEqual(1.15);
    expect(toThirtySeven!.result.verdict).toBe("ABOUT_EQUAL");
  }, 60_000);
});
