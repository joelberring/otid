import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routeObjectManifests, routePoints, routeUploadGrants, routeUploadReservations } from "../src/schema";

const migration = readFileSync(new URL("../migrations/0068_task_111_private_gpx_route_upload.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK111 privat GPX-schema", () => {
  it("binder en hash-only grant och högst en reservation till exakt race och entry", () => {
    expect(routeUploadGrants.secretHash.name).toBe("secret_hash");
    expect(routeUploadReservations.grantId.name).toBe("grant_id");
    expect(migration).toContain("route_upload_grant_expiry_check CHECK(expires_at > issued_at AND expires_at <= issued_at + interval '30 days')");
    expect(migration).toContain("route_upload_reservation_grant_uidx UNIQUE");
    expect(migration).toContain("route_upload_grant_revocation");
  });

  it("bevarar exakt objektversion och ordnade WGS84-punkter immutabelt", () => {
    expect(routeObjectManifests.versionId.name).toBe("version_id");
    expect(routePoints.sequence.name).toBe("sequence");
    expect(migration).toContain("route_object_manifest_store_key_version_uidx UNIQUE(store_id, object_key, version_id)");
    expect(migration).toContain("route_point_pk PRIMARY KEY(upload_id, sequence)");
    expect(migration).toContain("route_point_immutable");
  });

  it("registrerar en additiv migration med separat rollback-/restoregräns", () => {
    expect(journal.entries?.find((entry) => entry.idx === 68)).toMatchObject({ idx: 68, tag: "0068_task_111_private_gpx_route_upload" });
    expect(migration).toContain("Expand-only");
    expect(migration).toContain("Never delete, rewrite or");
  });
});
