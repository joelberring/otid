import { describe, expect, it } from "vitest";
import type { GeoJobView } from "@o-tid/contracts";
import { fetchLaserCandidateSources, mapWithConcurrency } from "./use-map-project-laser";

function makeJob(jobId: string, outputs: string[]): GeoJobView {
  return {
    jobId, name: jobId, kind: "PULLAUTIN", status: "DONE", createdAt: "2026-11-20T10:00:00Z",
    outputs: outputs.map(name => ({ name, bytes: 100 }))
  } as unknown as GeoJobView;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("use-map-project-laser: parallella geokällor och begränsad parallellitet", () => {
  it("mapWithConcurrency håller max N samtidiga anrop och bevarar ordningen", async () => {
    let active = 0, peak = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);
    const results = await mapWithConcurrency(items, 4, async value => {
      active += 1;
      peak = Math.max(peak, active);
      // Senare objekt blir klara snabbare än tidigare för att pröva ordningsbevarandet.
      await new Promise(resolve => setTimeout(resolve, (12 - value) * 2));
      active -= 1;
      return `v-${value}`;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
    expect(results).toEqual(items.map(value => `v-${value}`));
  });

  it("startar alla 4 geokällor parallellt med laserutdata och isolerar fel per källa", async () => {
    const job1 = makeJob("j1", ["a.dxf", "b.dxf", "fuktdjup.png", "berg.png", "hojd.png"]);
    const job2 = makeJob("j2", ["c.dxf", "d.dxf", "fuktdjup.png"]);
    const geoGates = {
      osm: deferred<{ status: number; json: unknown }>(),
      avverkningar: deferred<{ status: number; json: unknown }>(),
      jordarter: deferred<{ status: number; json: unknown }>(),
      "marktacke-nmd": deferred<{ status: number; json: unknown }>()
    };
    const startedGeo: string[] = [];
    let activeLaser = 0, peakLaser = 0;

    const run = fetchLaserCandidateSources({
      jobsToRead: [job1, job2],
      filesOf: row => row.outputs.filter(o => o.name.endsWith(".dxf")).map(o => o.name),
      depths: [job1, job2],
      rocks: [job1],
      heights: [job1],
      hasBox: true,
      concurrency: 3,
      readOutput: async (row, output) => {
        activeLaser += 1; peakLaser = Math.max(peakLaser, activeLaser);
        await new Promise(resolve => setTimeout(resolve, output === "a.dxf" ? 10 : 2));
        activeLaser -= 1;
        return `${row.jobId}:${output}`;
      },
      readSlope: async row => {
        activeLaser += 1; peakLaser = Math.max(peakLaser, activeLaser);
        await new Promise(resolve => setTimeout(resolve, 2));
        activeLaser -= 1;
        return row.jobId === "j1" ? "failed" : undefined;
      },
      readRock: async () => "failed",
      readHeight: async () => "failed",
      fetchGeo: path => {
        startedGeo.push(path);
        return geoGates[path].promise;
      }
    });

    // Alla 4 geokällor startas omedelbart i parallell utan att vänta på varandra eller på laserutdata.
    expect(startedGeo).toEqual(["osm", "avverkningar", "jordarter", "marktacke-nmd"]);

    // Isolerade fel per geokälla: OSM kastar nätverksfel, jordarter ger 500, övriga 200.
    geoGates.osm.reject(new Error("offline"));
    geoGates.avverkningar.resolve({ status: 200, json: { cuts: [] } });
    geoGates.jordarter.resolve({ status: 500, json: { error: "SGU nere" } });
    geoGates["marktacke-nmd"].resolve({ status: 200, json: { width: 1, height: 1 } });

    const outcome = await run;
    expect(peakLaser).toBeLessThanOrEqual(3);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.read.map(row => row.parts.map(part => part.body))).toEqual([
      ["j1:a.dxf", "j1:b.dxf"],
      ["j2:c.dxf", "j2:d.dxf"]
    ]);
    expect(outcome.slopes.get("j1")).toBe("failed");
    expect(outcome.rockImages.get("j1")).toBe("failed");
    expect(outcome.heightParts).toEqual([]);
    expect(outcome.geo?.osm).toEqual({ status: 0, json: undefined });
    expect(outcome.geo?.cuts.status).toBe(200);
    expect(outcome.geo?.soil.status).toBe(500);
    expect(outcome.geo?.landCover.status).toBe(200);
  });

  it("avbryter rent med felstatus när en laserfil inte kan hämtas", async () => {
    const job = makeJob("j1", ["a.dxf", "b.dxf", "c.dxf"]);
    const outcome = await fetchLaserCandidateSources({
      jobsToRead: [job],
      filesOf: () => ["a.dxf", "b.dxf", "c.dxf"],
      depths: [], rocks: [], heights: [], hasBox: true, concurrency: 2,
      readOutput: async (_row, output) => output === "b.dxf" ? 502 : "ok",
      readSlope: async () => undefined,
      readRock: async () => undefined,
      readHeight: async () => undefined,
      fetchGeo: async () => ({ status: 200, json: {} })
    });
    expect(outcome).toEqual({ kind: "failed", status: 502 });
  });
});
