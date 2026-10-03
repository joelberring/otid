import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import {
  publishMapAssetAsAdmin,
  readActiveMapPublication,
  readMapAssetStateAsAdmin,
  readStoredMapManifestAsAdmin,
  readPublicMapMetadata,
  reserveMapAssetAsAdmin,
  transferMapAssetAsAdmin,
  withdrawMapAssetAsAdmin
} from "../../src/map-asset";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-20T18:00:00.000Z");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const sha256 = createHash("sha256").update(png).digest("hex");

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK106','2026-09-20','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK106','2026-09-20')", [raceId, eventId]);
  const issued = await issuePairingAdminAccessCredential(db, {
    raceId, capability: "MANAGE_RACE", label: "TASK106", expiresAt: new Date(now.getTime() + 3_600_000)
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, {
    expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now
  });
  if (login.status !== "authenticated") throw new Error("Synthetic map administrator login failed");
  return { raceId, auth: { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

async function* body(): AsyncIterable<Uint8Array> { yield png; }

it("TASK106 persists one private exact image manifest and journals release/withdrawal with exact retries", async () => {
  const f = await fixture(), uploadRequestId = randomUUID();
  const uploadRequest = { formatVersion: 1 as const, title: "Skärgårdshelgen lång", mediaType: "image/png" as const, byteLength: png.byteLength, sha256 };
  const reserved = await reserveMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-upload:${uploadRequestId}`, request: uploadRequest }, now);
  expect(reserved.status).toBe("reserved");
  if (reserved.status !== "reserved") return;
  expect(await readStoredMapManifestAsAdmin(db, { ...f.auth, uploadId: reserved.response.uploadId }, now)).toEqual({ status: "not-found" });
  expect(await reserveMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-upload:${uploadRequestId}`, request: uploadRequest }, now))
    .toEqual({ status: "reserved", response: { ...reserved.response, replayed: true } });

  const storeId = randomUUID();
  const stored = await transferMapAssetAsAdmin(db, { ...f.auth, uploadId: reserved.response.uploadId, readBody: () => body() }, {
    async put(input) {
      return { formatVersion: 1, storeId, key: `map/${input.raceId}/${input.attemptId}`,
        versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
    }
  }, () => now);
  expect(stored.status).toBe("stored");
  expect((await pool.query("SELECT * FROM map_object_manifest WHERE upload_id=$1", [reserved.response.uploadId])).rowCount).toBe(1);
  const candidate = await readStoredMapManifestAsAdmin(db, { ...f.auth, uploadId: reserved.response.uploadId }, now);
  expect(candidate).toMatchObject({ status: "ok", manifest: { uploadId: reserved.response.uploadId,
    raceId: f.raceId, storeId, versionId: "synthetic-v1", sha256 } });
  expect(await readStoredMapManifestAsAdmin(db, { ...f.auth, uploadId: "not-a-uuid" }, now)).toEqual({ status: "invalid-request" });
  const other = await fixture();
  expect(await readStoredMapManifestAsAdmin(db, { ...other.auth, uploadId: reserved.response.uploadId }, now)).toEqual({ status: "not-found" });

  const publishId = randomUUID();
  const publishRequest = { formatVersion: 1 as const, uploadId: reserved.response.uploadId, expectedPublicationRevision: 0 };
  const published = await publishMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-publish:${publishId}`, request: publishRequest }, now);
  expect(published.status).toBe("published");
  if (published.status !== "published") return;
  expect(await publishMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-publish:${publishId}`, request: publishRequest }, now))
    .toEqual({ status: "published", response: { ...published.response, replayed: true } });
  expect((await readPublicMapMetadata(db, f.raceId)).status).toBe("ok");
  expect((await readActiveMapPublication(db, f.raceId))?.manifest.versionId).toBe("synthetic-v1");
  const activeAdminState = await readMapAssetStateAsAdmin(db, f.auth, now);
  expect(activeAdminState).toMatchObject({ status: "ok", response: {
    raceId: f.raceId, latestPublicationRevision: 1,
    activePublication: { publicationId: published.response.publicationId, uploadId: reserved.response.uploadId, title: uploadRequest.title },
    storedCandidates: [{ uploadId: reserved.response.uploadId, title: uploadRequest.title }]
  } });
  expect((await publishMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-publish:${publishId}`, request: { ...publishRequest, expectedPublicationRevision: 1 } }, now)).status).toBe("conflict");

  const withdrawId = randomUUID();
  const withdrawRequest = { formatVersion: 1 as const, publicationId: published.response.publicationId, expectedPublicationRevision: 1 };
  const withdrawn = await withdrawMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-withdraw:${withdrawId}`, request: withdrawRequest }, now);
  expect(withdrawn.status).toBe("withdrawn");
  if (withdrawn.status !== "withdrawn") return;
  expect(await withdrawMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-withdraw:${withdrawId}`, request: withdrawRequest }, now))
    .toEqual({ status: "withdrawn", response: { ...withdrawn.response, replayed: true } });
  expect((await withdrawMapAssetAsAdmin(db, { ...f.auth, idempotencyKey: `map-withdraw:${withdrawId}`, request: { ...withdrawRequest, expectedPublicationRevision: 2 } }, now)).status).toBe("conflict");
  expect(await readPublicMapMetadata(db, f.raceId)).toEqual({ status: "not-found" });
  expect(await readActiveMapPublication(db, f.raceId)).toBeNull();
  expect(await readMapAssetStateAsAdmin(db, f.auth, now)).toMatchObject({ status: "ok", response: {
    latestPublicationRevision: 2, activePublication: null, storedCandidates: [{ uploadId: reserved.response.uploadId }]
  } });
  expect(await readStoredMapManifestAsAdmin(db, { ...f.auth, uploadId: reserved.response.uploadId }, now)).toEqual(candidate);
  expect((await pool.query<{ action: string; revision: number }>("SELECT action,revision FROM map_publication WHERE race_id=$1 ORDER BY revision", [f.raceId])).rows)
    .toEqual([{ action: "PUBLISH", revision: 1 }, { action: "WITHDRAW", revision: 2 }]);
});
