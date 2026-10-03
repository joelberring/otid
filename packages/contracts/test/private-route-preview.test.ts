import { describe, expect, it } from "vitest";
import { privateRoutePreviewQuerySchema, privateRoutePreviewResponseSchema } from "../src";

const id = "12345678-1234-4234-8234-123456789abc";
describe("TASK115 private route preview contracts", () => {
  it("accepts only exact private IDs and a pixel-only response", () => {
    expect(privateRoutePreviewQuerySchema.parse({ routeUploadId: id, mapManifestId: id, georeferenceId: id })).toBeTruthy();
    expect(privateRoutePreviewQuerySchema.safeParse({ routeUploadId: id, mapManifestId: id }).success).toBe(false);
    const response = { formatVersion: 1 as const, raceId: id, imageWidth: 100, imageHeight: 50, mapSourceHash: "a".repeat(64), points: [{ x: 1, y: 2, segment: 0 }, { x: 3, y: 4, segment: 0 }] };
    expect(privateRoutePreviewResponseSchema.parse(response)).toEqual(response);
    for (const field of ["latitude", "longitude", "objectKey", "storeId", "versionId", "entryId", "grantId"]) expect(privateRoutePreviewResponseSchema.safeParse({ ...response, [field]: id }).success).toBe(false);
  });
});
