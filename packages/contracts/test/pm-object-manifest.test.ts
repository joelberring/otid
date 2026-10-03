import { describe, expect, it } from "vitest";
import { pmObjectManifestSchema } from "../src";

const raceId = "a0000000-0000-4000-8000-000000000002";
const attemptId = "b0000000-0000-4000-8000-000000000003";
const manifest = {
  formatVersion: 1,
  storeId: "c0000000-0000-4000-8000-000000000004",
  key: `pm/${raceId}/${attemptId}`,
  versionId: "version-a_1~safe+value/part",
  sha256: "a".repeat(64),
  byteLength: 1024
};

describe("TASK013 PM object manifest contract", () => {
  it("accepts only a canonical immutable object-version reference", () => {
    expect(pmObjectManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("rejects malformed identity, key, version, digest, length and extras", () => {
    const malformed = [
      { ...manifest, formatVersion: 2 },
      { ...manifest, storeId: manifest.storeId.toUpperCase() },
      { ...manifest, key: `pm/${raceId}/../../secret` },
      { ...manifest, key: `pm/${raceId}/${attemptId}/suffix` },
      { ...manifest, versionId: "null" },
      { ...manifest, versionId: "space value" },
      { ...manifest, versionId: "x".repeat(1025) },
      { ...manifest, sha256: "A".repeat(64) },
      { ...manifest, byteLength: 0 },
      { ...manifest, byteLength: 10 * 1024 * 1024 + 1 },
      { ...manifest, byteLength: 1024.5 },
      { ...manifest, objectUrl: "forbidden" }
    ];
    for (const value of malformed) expect(pmObjectManifestSchema.safeParse(value).success).toBe(false);
  });
});
