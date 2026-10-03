import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { createMapGeoreferenceAsAdmin, readMapGeoreferenceStateAsAdmin } from "../../src/map-georeference";
import { reserveMapAssetAsAdmin, transferMapAssetAsAdmin } from "../../src/map-asset";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-21T18:00:00.000Z");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const sha256 = createHash("sha256").update(png).digest("hex");

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function* body(): AsyncIterable<Uint8Array> { yield png; }

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK114','2026-09-21','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK114','2026-09-21')", [raceId, eventId]);
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK114", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic georeference administrator login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const upload = await reserveMapAssetAsAdmin(db, { ...auth, idempotencyKey: `map-upload:${randomUUID()}`, request: { formatVersion: 1, title: "Kalibreringskarta", mediaType: "image/png", byteLength: png.byteLength, sha256 } }, now);
  if (upload.status !== "reserved") throw new Error("Synthetic map reservation failed");
  const stored = await transferMapAssetAsAdmin(db, { ...auth, uploadId: upload.response.uploadId, readBody: () => body() }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `map/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now);
  if (stored.status !== "stored") throw new Error("Synthetic map storage failed");
  return { auth, manifestId: upload.response.uploadId };
}

function request(manifestId: string, expectedGeoreferenceRevision = 0) {
  return { formatVersion: 1 as const, manifestId, expectedGeoreferenceRevision, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326" as const, tiePoints: [
    { pixelX: 0, pixelY: 0, longitude: 18.1, latitude: 59.2 },
    { pixelX: 1000, pixelY: 0, longitude: 18.11, latitude: 59.2 },
    { pixelX: 0, pixelY: 500, longitude: 18.1, latitude: 59.195 }
  ] };
}

it("TASK114 journals a private exact-manifest calibration with retry, scope and immutability barriers", async () => {
  const f = await fixture(), requestId = randomUUID(), intent = request(f.manifestId);
  const created = await createMapGeoreferenceAsAdmin(db, { ...f.auth, idempotencyKey: `map-georeference:${requestId}`, request: intent }, now);
  expect(created.status).toBe("created");
  if (created.status !== "created") return;
  expect(created.response).toMatchObject({ manifestId: f.manifestId, sourceHash: sha256, revision: 1, crs: "EPSG:4326", replayed: false });
  expect(created.response.transform.a).toBeCloseTo(0.00001, 12);
  expect(created.response.transform.b).toBe(0);
  expect(created.response.transform.c).toBeCloseTo(18.1, 12);
  expect(created.response.transform.d).toBe(0);
  expect(created.response.transform.e).toBeCloseTo(-0.00001, 12);
  expect(created.response.transform.f).toBeCloseTo(59.2, 12);
  expect(await createMapGeoreferenceAsAdmin(db, { ...f.auth, idempotencyKey: `map-georeference:${requestId}`, request: intent }, now))
    .toEqual({ status: "created", response: { ...created.response, replayed: true } });
  expect((await createMapGeoreferenceAsAdmin(db, { ...f.auth, idempotencyKey: `map-georeference:${requestId}`, request: { ...intent, imageWidth: 1002 } }, now)).status).toBe("conflict");
  expect((await createMapGeoreferenceAsAdmin(db, { ...f.auth, idempotencyKey: `map-georeference:${randomUUID()}`, request: { ...intent, expectedGeoreferenceRevision: 0 } }, now)).status).toBe("conflict");
  expect((await createMapGeoreferenceAsAdmin(db, { ...f.auth, idempotencyKey: `map-georeference:${randomUUID()}`, request: { ...intent, manifestId: randomUUID(), expectedGeoreferenceRevision: 1 } }, now)).status).toBe("not-found");
  expect((await createMapGeoreferenceAsAdmin(db, { ...f.auth, idempotencyKey: `map-georeference:${randomUUID()}`, request: { ...intent, expectedGeoreferenceRevision: 1, tiePoints: [intent.tiePoints[0]!, intent.tiePoints[1]!, { ...intent.tiePoints[1]!, pixelX: 999, pixelY: 0, longitude: 18.10999 }] } }, now)).status).toBe("invalid-request");
  const state = await readMapGeoreferenceStateAsAdmin(db, f.auth, now);
  expect(state).toMatchObject({ status: "ok", response: { latestGeoreferenceRevision: 1, georeferences: [{ georeferenceId: created.response.georeferenceId, manifestId: f.manifestId, sourceHash: sha256 }] } });
  if (state.status === "ok") expect(JSON.stringify(state.response)).not.toContain("objectKey");
  await expect(pool.query("UPDATE map_georeference SET crs='EPSG:3006' WHERE id=$1", [created.response.georeferenceId])).rejects.toThrow();
  expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM map_georeference WHERE race_id=$1", [f.auth.raceId])).rows[0]?.count).toBe(1);
});
