/**
 * Vägvalsanalysen på ägarens riktiga kartfiler (Djurgården 2025 i OCAD och Mapper, Purple Pens banfil för Natt-KM
 * 2026). Filerna är klubbens och committas inte; testet körs bara när OTID_REAL_MAP_DIR pekar på mappen.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMapFile, type Point } from "@o-tid/map-file";
import { analyseCourse, buildCostModel, type LegAnalysis, type LegInput } from "../src";

const directory = process.env.OTID_REAL_MAP_DIR;
const COURSE = process.env.OTID_REAL_COURSE ?? "H21";

function find(suffix: string): string {
  const name = readdirSync(directory!).find(file => file.normalize("NFC").toLowerCase().endsWith(suffix));
  if (!name) throw new Error(`Hittar ingen fil som slutar på ${suffix} i ${directory}`);
  return join(directory!, name);
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
