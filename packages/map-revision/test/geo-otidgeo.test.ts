import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../../../scripts/geo-moisture.ts";
import {
  formlineModeOf, otidgeoRastersArgs, otidgeoRunArgs, otidgeoVegArgs, pullautinPlan,
  resolveEngine, summaryFromRasters, vegetationFromClassPng
} from "../../../scripts/geo-otidgeo.ts";
import { SEMI_ALPHA } from "../../../scripts/geo-vegetation.ts";
import { iniWith, WORKER_VERSION } from "../../../scripts/geo-worker.ts";
import { importLayers } from "../src/vector-import";
import { parseDxf } from "../src/vector-parse";

const ROOT = join(import.meta.dirname, "../../..");

describe("otidgeo CLI-mappning och dubbelmotorplan (Etapp G4B)", () => {
  it("mappar alla 5 kurvprofiler (skog 5 m och sprint 2,5 m) med rätt flaggor", () => {
    const profiles = [
      { name: "veryDetailed-5m", settings: { contour_interval: 5, smooth_m: 1.0, taubin: 1, curviness: 0.24, min_loop_area: 20, min_clearance: 1.0 },
        expect: ["--interval", "5", "--smooth-m", "1", "--taubin-passes", "1", "--curviness", "0.24", "--min-loop-area-m2", "20", "--min-clearance-m", "1"] },
      { name: "detailed-5m", settings: { contour_interval: 5, smooth_m: 1.35, taubin: 2, curviness: 0.20, min_loop_area: 30, min_clearance: 1.4 },
        expect: ["--interval", "5", "--smooth-m", "1.35", "--taubin-passes", "2", "--curviness", "0.2", "--min-loop-area-m2", "30", "--min-clearance-m", "1.4"] },
      { name: "normal-5m", settings: { contour_interval: 5 },
        expect: ["--interval", "5"] },
      { name: "generalized-5m", settings: { contour_interval: 5, smooth_m: 2.3, taubin: 3, curviness: 0.13, min_loop_area: 65, min_clearance: 2.1 },
        expect: ["--interval", "5", "--smooth-m", "2.3", "--taubin-passes", "3", "--curviness", "0.13", "--min-loop-area-m2", "65", "--min-clearance-m", "2.1"] },
      { name: "veryGeneralized-sprint", settings: { contour_interval: 2.5, smooth_m: 2.2, taubin: 4, curviness: 0.08, min_loop_area: 40, min_clearance: 1.5 },
        expect: ["--interval", "2.5", "--smooth-m", "2.2", "--taubin-passes", "4", "--curviness", "0.08", "--min-loop-area-m2", "40", "--min-clearance-m", "1.5"] }
    ];
    for (const profile of profiles) {
      const args = otidgeoRunArgs(["in/ruta00.las", "in/ruta01.las"], "out-otidgeo", {
        settings: profile.settings, clip: { minX: 664_780, minY: 6_576_500, maxX: 665_080, maxY: 6_576_800 }
      });
      expect(args.slice(0, 7)).toEqual(["run", "--input", "in/ruta00.las", "--input", "in/ruta01.las", "--out", "out-otidgeo"]);
      for (let i = 0; i < profile.expect.length; i += 2) {
        const idx = args.indexOf(profile.expect[i]!);
        expect(idx, `${profile.name}: ${profile.expect[i]}`).toBeGreaterThan(0);
        expect(args[idx + 1]).toBe(profile.expect[i + 1]);
      }
      expect(args).toContain("--overview");
      expect(args).toContain("--clip");
      expect(args[args.indexOf("--clip") + 1]).toBe("664780,6576500,665080,6576800");
    }
  });

  it("mappar formline 0–3, overview 0/1, veg_smooth, knollshare, greenscale-inversion och vegetationsflaggor", () => {
    expect([0, 1, 2, 3].map(formlineModeOf)).toEqual(["off", "sparse", "normal", "dense"]);
    expect(formlineModeOf(undefined)).toBeUndefined();

    const args = otidgeoRunArgs(["in/ruta00.las"], "out-otidgeo", {
      settings: {
        formline: 3, formline_gap: 4.5, formline_max_slope: 22,
        veg_smooth: 0.65, greenscale: 1.5, openshare: 0.72, topweight: 0.4, undergrowth: 0.04,
        knollshare: 0.75, overview: 0
      },
      vegetation: { minAreaM2: 150 }
    });
    expect(args).toEqual([
      "run", "--input", "in/ruta00.las", "--out", "out-otidgeo",
      "--formline-mode", "dense", "--formline-min-gap-m", "4.5", "--formline-max-slope-deg", "22",
      "--veg-smooth", "0.65", "--green-scale", "0.6667", "--open-share", "0.72",
      "--canopy-weight", "0.4", "--undergrowth-thresh", "0.04", "--min-veg-area-m2", "150",
      "--knoll-share", "0.75"
    ]);
    expect(args).not.toContain("--overview");

    // `greenscale: 0.65` (mer grönt i O-Tid) inverteras till > 1 i otidgeo.
    const moreGreen = otidgeoRunArgs(["in/ruta00.las"], "out", { settings: { greenscale: 0.65, overview: 1 } });
    expect(moreGreen[moreGreen.indexOf("--green-scale") + 1]).toBe("1.5385");
    expect(moreGreen).toContain("--overview");
  });

  it("planerar bildmotorfri pullautin (0 pngmerge, contoursonly=1, otidgeo veg, rawTicks stänger av contoursonly)", () => {
    expect(resolveEngine("otidgeo")).toBe("otidgeo");
    expect(resolveEngine("pullautin")).toBe("pullautin");
    expect(resolveEngine(undefined)).toBe("pullautin");

    expect(pullautinPlan({ vegetation: { minAreaM2: 300 } }, true)).toEqual({
      contoursOnly: true, useOtidgeoVeg: true, kpVegeBitmode: false, runPngMerge: false
    });
    expect(pullautinPlan({ vegetation: { minAreaM2: 300 }, cliffs: { rawTicks: true } }, true)).toEqual({
      contoursOnly: false, useOtidgeoVeg: true, kpVegeBitmode: false, runPngMerge: false
    });
    // Fallback när otidgeo saknas: KP får köra vege_bitmode utan contoursonly så gamla miljöer inte bryts.
    expect(pullautinPlan({ vegetation: { minAreaM2: 300 } }, false)).toEqual({
      contoursOnly: false, useOtidgeoVeg: false, kpVegeBitmode: true, runPngMerge: false
    });
    // `otidgeo veg` för pullautin skalar KP:s undergrowth (0,35) och topweight (0,8) till otidgeo:s skala.
    const vegArgs = otidgeoVegArgs(["in/ruta00.las"], "out-veg", {
      settings: { greenscale: 1.5, undergrowth: 0.35, topweight: 0.8, veg_smooth: 1.05 },
      vegetation: { minAreaM2: 300 },
      clip: { minX: 100, minY: 200, maxX: 500, maxY: 600 }
    }, true);
    expect(vegArgs).toEqual([
      "veg", "--input", "in/ruta00.las", "--out", "out-veg",
      "--veg-smooth", "1.05", "--green-scale", "0.6667", "--canopy-weight", "0.34",
      "--undergrowth-thresh", "0.058", "--min-veg-area-m2", "300", "--clip", "100,200,500,600"
    ]);
    // `iniWith` med contoursonly=1 och formline=3.
    const ini = iniWith("contoursonly=0\nformline=2\n", { formline: 3 }, false, false, 2, false, true);
    expect(ini).toContain("contoursonly=1");
    expect(ini).toContain("formline=2");
    expect(ini).toContain("formlinesteepness=0.25");
  });

  it("bygger CLI och summering för delad otidgeo rasters", () => {
    const args = otidgeoRastersArgs({
      groundFiles: ["mark0.bin", "mark1.bin"],
      waterFiles: ["vatten0.bin"],
      pointFiles: ["punkter0.bin"],
      vegPng: "vegetationsklasser.png",
      outDir: ".",
      heightRasters: true,
      pointImages: true,
      waterGeoJson: true,
      moisture: { channelHa: 1, wetMeters: 0.25, moistMeters: 0.4 },
      cliffs: { minDrop: 1.3, impassableDrop: 4.5, impassableLength: 20, tags: true, c3g: "merged_c3g.dxf", c2g: "merged_c2g.dxf" },
      ditchesTracks: true,
      rock: { mode: 2, knolls: true, knollShare: 0.82 }
    });
    expect(args).toEqual([
      "rasters", "--ground", "mark0.bin", "--ground", "mark1.bin",
      "--water", "vatten0.bin", "--points", "punkter0.bin",
      "--veg-png", "vegetationsklasser.png", "--out", ".",
      "--height-rasters", "--point-images", "--water-geojson",
      "--moisture", "--channel-ha", "1", "--wet-meters", "0.25", "--moist-meters", "0.4",
      "--cliffs", "--cliff-min-drop", "1.3", "--cliff-impassable-drop", "4.5", "--cliff-impassable-length", "20",
      "--cliff-tags", "--cliff-c3g", "merged_c3g.dxf", "--cliff-c2g", "merged_c2g.dxf",
      "--ditches-tracks", "--rock", "--rock-mode", "2", "--knolls", "--knoll-share", "0.82"
    ]);

    const summary = summaryFromRasters({
      waterHa: 0.64, wetHa: 1.2, moistHa: 2.3, channels: 4,
      cliffs201: 2, cliffs202: 5, cliffMeters201: 80, cliffMeters202: 140, cliffsDropped: 1,
      ditches: 3, terrainChannels: 2, tracks: 1,
      boulders: 12, knolls: 7, bareRockAreas: 4, cappedPoints: 0,
      msHeight: 14.6, msMoisture: 31.2, msCliffs: 20.1, msTracks: 18.9, msRock: 22.4
    }, { water: true, moisture: true, cliffs: true, ditchesTracks: true, rock: true });
    expect(summary).toEqual({
      waterHa: 0.64, wetHa: 1.2, moistHa: 2.3, channels: 4,
      cliffs201: 2, cliffs202: 5, cliffMeters201: 80, cliffMeters202: 140, cliffsDropped: 1,
      ditches: 3, terrainChannels: 2, tracks: 1,
      boulders: 12, knolls: 7, bareRockAreas: 4,
      msRastersHeight: 15, msRastersMoisture: 31, msRastersCliffs: 20, msRastersTracks: 19, msRastersRock: 22
    });
  });

  it("vektoriserar otidgeos vegetationsklasser.png (inkl. SEMI_ALPHA, utan tredubbla 406/408) till vegetation.dxf", () => {
    const w = 40, h = 40, cell = 2;
    // Väster (x < 12): öppen (401), remsa 12..18: halvöppen (404, SEMI_ALPHA), mitten: skog (2), öster (x >= 26): 410 (R=6).
    const png = encodePng(w, h, (x, y) => {
      if (x < 12) return [1, 160, 1, 255];
      if (x < 18) return [1, 160, 1, SEMI_ALPHA];
      if (x >= 26) return [6, 160, 6, 255];
      // Liten fläck med undervegetation 407 i skogen.
      if (y >= 10 && y < 22 && x >= 19 && x < 25) return [2 | (1 << 4), 160, 2 | (1 << 4), 255];
      return [2, 160, 2, 255];
    });
    const pgw = `${cell}\n0\n0\n${-cell}\n664001\n6576079\n`;
    const res = vegetationFromClassPng(new Uint8Array(png), pgw, { vegSmooth: 0.65 });
    const layers = importLayers(parseDxf(res.dxf)).map(l => l.name).sort();
    expect(layers).toEqual(["gron_mycket_svarlopt", "oppen_mark", "oppen_mark_spridda_trad", "undervegetation_lattlopt"]);
    expect(res.summary.ha401).toBeGreaterThan(0.15);
    expect(res.summary.ha404).toBeGreaterThan(0.05);
    expect(res.summary.ha410).toBeGreaterThan(0.2);
    expect(res.summary.ha406).toBe(0);
    expect(res.summary.ha408).toBe(0);
    expect(res.openAt(664_005, 6_576_040)).toBe(true);
    expect(res.forestAt(664_044, 6_576_040)).toBe(true);
    expect(res.openAt(664_065, 6_576_040)).toBe(false);
  });
});

interface MockWorkerResult {
  readonly code: number | null;
  readonly output: string;
  readonly uploaded: Map<string, { readonly contentType: string; readonly bytes: Buffer }>;
  readonly finished: { readonly status: string; readonly error?: string; readonly summary?: Record<string, number | string> } | undefined;
  readonly pullautaCalls: readonly { readonly args: readonly string[]; readonly ini: string }[];
}

async function runWorkerOnce(job: Record<string, unknown>, extraEnv: Record<string, string> = {}): Promise<MockWorkerResult> {
  const work = await mkdtemp(join(tmpdir(), "otid-g4b-worker-"));
  const uploaded = new Map<string, { readonly contentType: string; readonly bytes: Buffer }>();
  let finished: MockWorkerResult["finished"];
  let claimed = false;
  const pullautaCalls: { args: string[]; ini: string }[] = [];
  const callLog = join(work, "pullauta-calls.jsonl");
  const spyPullauta = join(work, "spy-pullauta.mjs");
  await writeFile(spyPullauta, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const ini = existsSync("pullauta.ini") ? readFileSync("pullauta.ini", "utf8") : "";
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify({ args: process.argv.slice(2), ini }) + "\\n");
const res = spawnSync(process.execPath, [${JSON.stringify(join(ROOT, "tests/e2e/fake-pullauta.mjs"))}, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(res.status ?? 1);
`);
  await chmod(spyPullauta, 0o755);
  const iniPath = join(work, "pullauta.default.ini");
  await writeFile(iniPath, "batch=0\nprocesses=2\ncontoursonly=0\noutput_dxf=1\n");

  const tileBox = JSON.stringify({ minE: 664_780, maxE: 665_380, minN: 6_576_500, maxN: 6_577_100 });
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? "/";
      if (url === "/api/geo-worker/claim" && req.method === "POST") {
        expect(req.headers["x-otid-geo-version"]).toBe(String(WORKER_VERSION));
        if (claimed) { res.writeHead(204).end(); return; }
        claimed = true;
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ job }));
        return;
      }
      if (url.endsWith("/heartbeat")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ action: "continue" }));
        return;
      }
      if (url.includes("/laser/")) {
        res.writeHead(200, { "content-type": "application/octet-stream" }).end(tileBox);
        return;
      }
      const outMatch = /\/outputs\/([^/]+)$/.exec(url);
      if (outMatch && req.method === "PUT") {
        uploaded.set(outMatch[1]!, { contentType: String(req.headers["content-type"] ?? ""), bytes: body });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.endsWith("/finish") && req.method === "POST") {
        finished = JSON.parse(body.toString("utf8")) as MockWorkerResult["finished"];
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404).end();
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  try {
    const result = await new Promise<{ code: number | null; output: string }>(resolve => {
      const child = spawn(process.execPath, [join(ROOT, "scripts/geo-worker.ts")], {
        cwd: work,
        env: {
          ...process.env,
          OTID_GEO_ORIGIN: `http://127.0.0.1:${port}`,
          OTID_GEO_WORKER_TOKEN: "test-token-0123456789abcdefghijklmnopqrstuvwxyz",
          OTID_GEO_WORKER_NAME: "vitest-geo",
          OTID_GEO_ONCE: "1",
          OTID_OTIDGEO: join(ROOT, "tests/e2e/fake-otidgeo.mjs"),
          OTID_PULLAUTA: spyPullauta,
          OTID_PULLAUTA_INI: iniPath,
          OTID_LASCLIP: join(ROOT, "tests/e2e/fake-lasclip.mjs"),
          OTID_GEO_WORKDIR: join(work, "work"),
          OTID_GEO_CACHE_DIR: join(work, "cache"),
          OTID_CWEBP: "/nonexistent/cwebp",
          ...extraEnv
        }
      });
      let output = "";
      child.stdout.on("data", (d: Buffer) => { output += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { output += d.toString(); });
      child.on("close", code => resolve({ code, output }));
    });
    const rawLog = await import("node:fs/promises").then(fs => fs.readFile(callLog, "utf8").catch(() => ""));
    for (const line of rawLog.trim().split("\n").filter(Boolean)) pullautaCalls.push(JSON.parse(line) as { args: string[]; ini: string });
    return { ...result, uploaded, finished, pullautaCalls };
  } finally {
    server.close();
    await rm(work, { recursive: true, force: true });
  }
}

const BASE_JOB = {
  jobId: "00000000-0000-4000-8000-000000000001",
  kind: "PULLAUTIN",
  attempt: 1,
  tiles: [{ index: 0, id: "tile-0", epsg: 3006 }],
  clip: { minX: 664_830, minY: 6_576_550, maxX: 665_330, maxY: 6_577_050 },
  moisture: { channelHa: 1, wetMeters: 0.25, moistMeters: 0.4 },
  vegetation: { minAreaM2: 300 }
};

describe("geo-worker.ts dubbelmotor E2E mot fake-mockar", () => {
  it("engine=otidgeo kör 0 Karttapullautin, skapar karta.png + kurvor + vegetation + rasters och rapporterar msOtidgeo", async () => {
    const res = await runWorkerOnce({ ...BASE_JOB, engine: "otidgeo", settings: { contour_interval: 5, formline: 2 } });
    expect(res.code, res.output).toBe(0);
    expect(res.finished?.status).toBe("DONE");
    expect(res.finished?.summary?.engine).toBe("otidgeo");
    expect(Number(res.finished?.summary?.msOtidgeo)).toBeGreaterThanOrEqual(0);
    expect(Number(res.finished?.summary?.msRasters)).toBeGreaterThanOrEqual(0);
    expect(res.pullautaCalls).toHaveLength(0);
    for (const name of ["karta.png", "karta.pgw", "kurvor.dxf", "formlinjer.dxf", "knollar.dxf", "vegetation.dxf",
      "vegetationsklasser.png", "vegetationsklasser.pgw", "fukt.png", "fuktdjup.png", "fukt.dxf", "brantlinjer.dxf",
      "hojd.png", "skuggning.png", "relief.png", "berg.png", "vatten.geojson"]) {
      expect(res.uploaded.has(name), `saknar ${name}`).toBe(true);
    }
  }, 30_000);

  it("engine=otidgeo med overview=0 hoppar över karta.png utan krasch", async () => {
    const res = await runWorkerOnce({ ...BASE_JOB, engine: "otidgeo", settings: { contour_interval: 5, overview: 0 } });
    expect(res.code, res.output).toBe(0);
    expect(res.finished?.status).toBe("DONE");
    expect(res.uploaded.has("karta.png")).toBe(false);
    expect(res.uploaded.has("karta.pgw")).toBe(false);
    expect(res.uploaded.has("kurvor.dxf")).toBe(true);
  }, 30_000);

  it("engine=pullautin kör contoursonly=1 + 0 pngmerge + otidgeo veg + otidgeo rasters utan karta.png", async () => {
    const res = await runWorkerOnce({ ...BASE_JOB, engine: "pullautin", settings: { contour_interval: 5, formline: 3 } });
    expect(res.code, res.output).toBe(0);
    expect(res.finished?.status).toBe("DONE");
    expect(res.finished?.summary?.engine).toBe("pullautin");
    expect(Number(res.finished?.summary?.msPullauta)).toBeGreaterThanOrEqual(0);
    expect(Number(res.finished?.summary?.msOtidgeoVeg)).toBeGreaterThanOrEqual(0);
    expect(res.pullautaCalls.map(c => c.args)).toEqual([[], ["dxfmerge"]]);
    expect(res.pullautaCalls[0]!.ini).toContain("contoursonly=1");
    expect(res.pullautaCalls[0]!.ini).toContain("output_dxf=0");
    expect(res.pullautaCalls[0]!.ini).toContain("formline=2");
    expect(res.pullautaCalls[0]!.ini).toContain("formlinesteepness=0.25");
    expect(res.pullautaCalls[1]!.ini).toContain("output_dxf=1");
    expect(res.uploaded.has("karta.png")).toBe(false);
    expect(res.uploaded.has("kurvor.dxf")).toBe(true);
    expect(res.uploaded.has("vegetation.dxf")).toBe(true);
    expect(res.uploaded.has("vegetationsklasser.png")).toBe(true);
    expect(res.uploaded.has("brantlinjer.dxf")).toBe(true);
  }, 30_000);

  it("engine=pullautin med rawTicks=true stänger av contoursonly och laddar upp branter.dxf", async () => {
    const res = await runWorkerOnce({
      ...BASE_JOB, engine: "pullautin", settings: { contour_interval: 5 },
      cliffs: { minDrop: 1.3, impassableDrop: 4.5, rawTicks: true }
    });
    expect(res.code, res.output).toBe(0);
    expect(res.finished?.status).toBe("DONE");
    expect(res.pullautaCalls.map(c => c.args)).toEqual([[], ["dxfmerge"]]);
    expect(res.pullautaCalls[0]!.ini).not.toContain("contoursonly=1");
    expect(res.uploaded.has("branter.dxf")).toBe(true);
    expect(res.uploaded.has("karta.png")).toBe(false);
  }, 30_000);

  it("engine=pullautin faller automatiskt tillbaka på JS-steg och KP-vegetation när otidgeo saknas", async () => {
    const res = await runWorkerOnce(
      { ...BASE_JOB, engine: "pullautin", settings: { contour_interval: 5 } },
      { OTID_OTIDGEO: "/nonexistent/otidgeo" }
    );
    expect(res.code, res.output).toBe(0);
    expect(res.finished?.status).toBe("DONE");
    expect(res.finished?.summary?.engine).toBe("pullautin");
    expect(res.pullautaCalls[0]!.ini).toContain("vege_bitmode=1");
    expect(res.uploaded.has("kurvor.dxf")).toBe(true);
    expect(res.uploaded.has("vegetation.dxf")).toBe(true);
    expect(res.uploaded.has("fukt.dxf")).toBe(true);
    expect(res.uploaded.has("skuggning.png")).toBe(true);
    expect(res.uploaded.has("hojd.png")).toBe(true);
  }, 30_000);
});
