import { describe, expect, it } from "vitest";
import {
  adminRaceMapSourceSchema,
  courseSettingStateSchema,
  mapProjectUpdateRequestSchema,
  raceMapSourceMetadataSchema,
  raceMapSourceUpdateRequestSchema,
  raceMapSourceUpdateResponseSchema
} from "../src";

const UUID = "10000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const NOW = "2026-11-26T12:00:00.000Z";

describe("Etapp 2: kontrakt för karträttigheter och nedladdningsspärr", () => {
  it("mapProjectUpdateRequestSchema tillåter sourceDownloadPolicy och avvisar ogiltiga värden", () => {
    expect(mapProjectUpdateRequestSchema.parse({ formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }))
      .toEqual({ formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" });
    expect(mapProjectUpdateRequestSchema.parse({ formatVersion: 1, sourceDownloadPolicy: "ALLOWED" }))
      .toEqual({ formatVersion: 1, sourceDownloadPolicy: "ALLOWED" });
    expect(mapProjectUpdateRequestSchema.safeParse({ formatVersion: 1, sourceDownloadPolicy: "LOCKED" }).success).toBe(false);
    expect(mapProjectUpdateRequestSchema.safeParse({ formatVersion: 1 }).success).toBe(false);
    expect(mapProjectUpdateRequestSchema.safeParse({ formatVersion: 1, sourceDownloadPolicy: "ALLOWED", extra: true }).success).toBe(false);
  });

  it("raceMapSourceMetadataSchema stödjer valfritt sourceDownloadLocked vid manuell uppladdning", () => {
    const base = {
      formatVersion: 1 as const,
      format: "OMAP" as const,
      version: "Mapper v9",
      scale: 10_000,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      georeference: null,
      render: { pxPerMm: 8, originX: -2, originY: 102 },
      summary: { objectCount: 12, warnings: [], simplifications: [] },
      tiePoints: null
    };
    expect(raceMapSourceMetadataSchema.parse(base).sourceDownloadLocked).toBeUndefined();
    expect(raceMapSourceMetadataSchema.parse({ ...base, sourceDownloadLocked: true }).sourceDownloadLocked).toBe(true);
    expect(raceMapSourceMetadataSchema.parse({ ...base, sourceDownloadLocked: false }).sourceDownloadLocked).toBe(false);
    expect(raceMapSourceMetadataSchema.safeParse({ ...base, sourceDownloadLocked: "yes" }).success).toBe(false);
  });

  it("raceMapSourceUpdateRequestSchema och response-schema validerar PATCH på tävlingskartspärr", () => {
    expect(raceMapSourceUpdateRequestSchema.parse({ formatVersion: 1, sourceDownloadLocked: true }))
      .toEqual({ formatVersion: 1, sourceDownloadLocked: true });
    expect(raceMapSourceUpdateRequestSchema.safeParse({ formatVersion: 1 }).success).toBe(false);
    expect(raceMapSourceUpdateRequestSchema.safeParse({ formatVersion: 1, sourceDownloadLocked: true, extra: 1 }).success).toBe(false);

    expect(raceMapSourceUpdateResponseSchema.parse({ formatVersion: 1, sourceDownloadLocked: true, sourceDownloadLockedByOrigin: false }))
      .toEqual({ formatVersion: 1, sourceDownloadLocked: true, sourceDownloadLockedByOrigin: false });
    expect(raceMapSourceUpdateResponseSchema.safeParse({ formatVersion: 1, sourceDownloadLocked: true }).success).toBe(false);
  });

  it("adminRaceMapSourceSchema och courseSettingStateSchema exponerar sourceDownloadLockedByOrigin", () => {
    const source = adminRaceMapSourceSchema.parse({
      fileName: "skog.omap",
      format: "OMAP",
      version: "Mapper v9",
      byteLength: 1024,
      scale: 10_000,
      crs: null,
      georeferencedFromFile: false,
      summary: { objectCount: 5, warnings: [], simplifications: [] },
      uploadedAt: NOW,
      sourceDownloadLocked: true,
      sourceDownloadLockedByOrigin: true
    });
    expect(source.sourceDownloadLocked).toBe(true);
    expect(source.sourceDownloadLockedByOrigin).toBe(true);

    const state = courseSettingStateSchema.parse({
      formatVersion: 1,
      raceId: UUID,
      access: { accountId: UUID, displayName: "Anna", level: "EDIT", admin: true },
      setting: null,
      original: null,
      mapFile: {
        sha256: SHA,
        fileName: "skog.omap",
        scale: 10_000,
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        georeferenced: false,
        sourceDownloadLocked: true,
        sourceDownloadLockedByOrigin: true
      }
    });
    expect(state.mapFile?.sourceDownloadLockedByOrigin).toBe(true);
  });
});
