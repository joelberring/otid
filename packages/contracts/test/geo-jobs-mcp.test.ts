import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MCP_TRAINING_RASTERS, mcpToolInputSchemas, type GeoJobView } from "../src";

describe("Etapp G1C: MCP laser- och rasterkontrakt", () => {
  const projectId = randomUUID();

  it("MCP_TRAINING_RASTERS inkluderar berg, fukt och karta", () => {
    expect(MCP_TRAINING_RASTERS).toEqual(expect.arrayContaining(["hojd", "fuktdjup", "vegetationsklasser", "relief", "skuggning", "lasveg", "lasmark", "laskron", "berg", "fukt", "karta"]));
    for (const name of ["berg", "fukt", "karta"] as const) {
      expect(mcpToolInputSchemas.training_raster.safeParse({ project_id: projectId, name }).success).toBe(true);
    }
    expect(mcpToolInputSchemas.training_raster.safeParse({ project_id: projectId, name: "okand" }).success).toBe(false);
  });

  it("start_laser_job godtar clip, rerun_of, cliffs, moisture, vegetation och raw_laser med rätt gränser", () => {
    const parsed = mcpToolInputSchemas.start_laser_job.parse({
      project_id: projectId,
      clip: { min_x: 665000, min_y: 6576000, max_x: 666000, max_y: 6577000 },
      cliffs: { min_drop: 1.5, impassable_drop: 4.5, impassable_length: 15, tags: true, raw_ticks: true },
      moisture: { channel_ha: 0.75, wet_meters: 0.3 },
      vegetation: { min_area_m2: 250 },
      raw_laser: true
    });
    expect(parsed.clip).toEqual({ minX: 665000, minY: 6576000, maxX: 666000, maxY: 6577000 });
    expect(parsed.cliffs).toEqual({ minDrop: 1.5, impassableDrop: 4.5, impassableLength: 15, tags: true, rawTicks: true });
    expect(parsed.moisture).toEqual({ channelHa: 0.75, wetMeters: 0.3, moistMeters: 0.48 });
    expect(parsed.vegetation).toEqual({ minAreaM2: 250 });
    expect(parsed.raw_laser).toBe(true);

    // Litet wet_meters (0,1) klampas till minst 0,2 för moistMeters enligt geoJobCreateRequestSchema.
    const lowWet = mcpToolInputSchemas.start_laser_job.parse({
      project_id: projectId,
      moisture: { channel_ha: 1, wet_meters: 0.1 }
    });
    expect(lowWet.moisture).toEqual({ channelHa: 1, wetMeters: 0.1, moistMeters: 0.2 });

    // rerun_of går att kombinera med clip men inte med area_id.
    const rerunId = randomUUID();
    expect(mcpToolInputSchemas.start_laser_job.safeParse({
      project_id: projectId, rerun_of: rerunId, clip: { min_x: 665000, min_y: 6576000, max_x: 666000, max_y: 6577000 }
    }).success).toBe(true);
    expect(mcpToolInputSchemas.start_laser_job.safeParse({
      project_id: projectId, area_id: randomUUID(), clip: { min_x: 665000, min_y: 6576000, max_x: 666000, max_y: 6577000 }
    }).success).toBe(false);
    expect(mcpToolInputSchemas.start_laser_job.safeParse({
      project_id: projectId, area_id: randomUUID(), rerun_of: rerunId
    }).success).toBe(false);

    // Ogiltiga klipprutor och trösklar avvisas.
    expect(mcpToolInputSchemas.start_laser_job.safeParse({ project_id: projectId, clip: { min_x: 0, min_y: 0, max_x: 10, max_y: 100 } }).success).toBe(false);
    expect(mcpToolInputSchemas.start_laser_job.safeParse({ project_id: projectId, clip: { min_x: 0, min_y: 0, max_x: 13_000, max_y: 1000 } }).success).toBe(false);
    expect(mcpToolInputSchemas.start_laser_job.safeParse({ project_id: projectId, cliffs: { min_drop: 3, impassable_drop: 3 } }).success).toBe(false);
    expect(mcpToolInputSchemas.start_laser_job.safeParse({ project_id: projectId, moisture: { channel_ha: 1, wet_meters: 1, moist_meters: 0.5 } }).success).toBe(false);
    expect(mcpToolInputSchemas.start_laser_job.safeParse({ project_id: projectId, vegetation: { min_area_m2: 20 } }).success).toBe(false);
  });

  it("GeoJobView tillåter valfria diagnostikfält bakåtkompatibelt", () => {
    const base: GeoJobView = {
      jobId: randomUUID(), name: "Test", kind: "PULLAUTIN", status: "DONE", tiles: 1, settings: {}, clip: null,
      areaId: null, scannedAt: null, cliffs: null, extras: [], progress: null, error: null, layerId: null,
      skippedSteps: [], moistureLayerId: null, moisture: null, vegetation: null, outputs: [],
      createdBy: { accountId: null, name: null }, own: true, createdAt: "2026-11-27T00:00:00.000Z", finishedAt: null
    };
    const withTelemetry: GeoJobView = { ...base, startedAt: "2026-11-27T00:01:00.000Z", attempts: 1, summary: { worker: 41, msTotal: 5000, peakRssMb: 412 } };
    expect(withTelemetry.summary?.peakRssMb).toBe(412);
    expect(base.summary).toBeUndefined();
  });
});
