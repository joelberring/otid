import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { issueRouteUploadGrantAsAdmin, listRouteUploadGrantsAsAdmin, revokeRouteUploadGrantAsAdmin } from "../../src/route-upload-grant";
import { authenticateRouteUploadSession, redeemRouteUploadBearerLink, routeUploadBearerTokenPrefix } from "../../src/route-upload-session";
import { readRouteUploadStatusAsParticipant, reserveRouteUploadAsParticipant, transferRouteUploadAsParticipant } from "../../src/route-upload";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-20T18:00:00.000Z");
const hash = "a".repeat(64);
const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-20T10:00:00Z</time></trkpt><trkpt lat="59.322" lon="18.072"><time>2026-09-20T10:01:00Z</time></trkpt></trkseg></trk></gpx>');
const gpxHash = createHash("sha256").update(gpx).digest("hex");

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK111','2026-09-20','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK111','2026-09-20')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'TASK111')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Öppen',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Route')", [entryId, raceId, classId]);
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK111", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic route administrator login failed");
  return { raceId, entryId, auth: { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

it("TASK111 creates exactly one active hash-only grant and journals an exact immutable revoke retry", async () => {
  const f = await fixture(), issueId = randomUUID(), grantId = randomUUID();
  const bearerSecret = Buffer.alloc(32, 9);
  const issue = { formatVersion: 1 as const, grantId, entryId: f.entryId,
    secretHash: createHash("sha256").update(bearerSecret).digest("hex"), expiresAt: new Date(now.getTime() + 86_400_000).toISOString() };
  const issued = await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${issueId}`, request: issue }, now);
  expect(issued).toMatchObject({ status: "issued", response: { grantId, entryId: f.entryId, revokedAt: null, replayed: false } });
  expect(await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${issueId}`, request: issue }, now))
    .toEqual({ status: "issued", response: { ...(issued.status === "issued" ? issued.response : undefined), replayed: true } });
  expect((await pool.query("SELECT secret_hash FROM route_upload_grant WHERE id=$1", [grantId])).rows).toEqual([{ secret_hash: issue.secretHash }]);
  expect((await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${randomUUID()}`,
    request: { ...issue, grantId: randomUUID(), secretHash: "b".repeat(64) } }, now)).status).toBe("conflict");
  expect(await listRouteUploadGrantsAsAdmin(db, f.auth, now)).toMatchObject({ status: "ok", response: {
    raceId: f.raceId, grants: [{ grantId, entryId: f.entryId, revokedAt: null }]
  } });

  const redeemed = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${grantId}.${bearerSecret.toString("base64url")}`, now);
  expect(redeemed).toMatchObject({ status: "redeemed", raceId: f.raceId, entryId: f.entryId });
  if (redeemed.status !== "redeemed") throw new Error("Route link was not redeemed");
  expect(await authenticateRouteUploadSession(db, { sessionToken: redeemed.sessionToken, csrfCookie: redeemed.csrfToken, csrfHeader: redeemed.csrfToken, requireCsrf: true }, now))
    .toMatchObject({ status: "authenticated", principal: { grantId, entryId: f.entryId } });
  expect(await authenticateRouteUploadSession(db, { sessionToken: redeemed.sessionToken, csrfCookie: redeemed.csrfToken, csrfHeader: "invalid", requireCsrf: true }, now)).toEqual({ status: "forbidden" });
  const participantAuth = { sessionToken: redeemed.sessionToken, csrfCookie: redeemed.csrfToken, csrfHeader: redeemed.csrfToken };
  expect(await readRouteUploadStatusAsParticipant(db, participantAuth, now)).toEqual({ status: "ok", response: { formatVersion: 1, status: "not-uploaded" } });
  const reserved = await reserveRouteUploadAsParticipant(db, { ...participantAuth, idempotencyKey: `route-upload:${randomUUID()}`,
    request: { formatVersion: 1, fileName: "ada-rutt.gpx", mediaType: "application/gpx+xml", byteLength: gpx.byteLength, sha256: gpxHash } }, now);
  expect(reserved).toMatchObject({ status: "reserved", response: { grantId, replayed: false } });
  if (reserved.status !== "reserved") throw new Error("Route reservation failed");
  async function* body(): AsyncIterable<Uint8Array> { yield gpx; }
  const storeId = randomUUID();
  const stored = await transferRouteUploadAsParticipant(db, { ...participantAuth, uploadId: reserved.response.uploadId, readBody: () => body() }, {
    async put(input) { return { formatVersion: 1, storeId, key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength }; }
  }, () => now);
  expect(stored).toMatchObject({ status: "stored", response: { pointCount: 2, segmentCount: 1, replayed: false } });
  expect(await readRouteUploadStatusAsParticipant(db, participantAuth, now)).toEqual({ status: "ok", response: {
    formatVersion: 1, status: "stored", receipt: {
      storedAt: now.toISOString(), pointCount: 2, segmentCount: 1,
      firstRecordedAt: "2026-09-20T10:00:00.000Z", lastRecordedAt: "2026-09-20T10:01:00.000Z"
    }
  } });
  expect(await transferRouteUploadAsParticipant(db, { ...participantAuth, uploadId: reserved.response.uploadId, readBody: () => body() }, {
    async put() { throw new Error("A stored route must not put again"); }
  }, () => now)).toEqual({ status: "stored", response: { ...(stored.status === "stored" ? stored.response : undefined), replayed: true } });
  expect((await pool.query<{ point_count: number; parser: string }>("SELECT point_count,parser FROM route_object_manifest WHERE upload_id=$1", [reserved.response.uploadId])).rows)
    .toEqual([{ point_count: 2, parser: "otid-gpx-1.1" }]);
  expect((await pool.query<{ sequence: number; segment: number }>("SELECT sequence,segment FROM route_point WHERE upload_id=$1 ORDER BY sequence", [reserved.response.uploadId])).rows)
    .toEqual([{ sequence: 0, segment: 0 }, { sequence: 1, segment: 0 }]);

  const revokeId = randomUUID(), revoke = { formatVersion: 1 as const, grantId, reason: "Ny uppladdningslänk behövs" };
  const revoked = await revokeRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant-revoke:${revokeId}`, request: revoke }, now);
  expect(revoked).toMatchObject({ status: "revoked", response: { grantId, replayed: false } });
  expect(await revokeRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant-revoke:${revokeId}`, request: revoke }, now))
    .toEqual({ status: "revoked", response: { ...(revoked.status === "revoked" ? revoked.response : undefined), replayed: true } });
  expect(await listRouteUploadGrantsAsAdmin(db, f.auth, now)).toMatchObject({ status: "ok", response: {
    raceId: f.raceId, grants: [{ grantId, entryId: f.entryId, revokedAt: now.toISOString() }]
  } });
  expect(await authenticateRouteUploadSession(db, { sessionToken: redeemed.sessionToken }, now)).toEqual({ status: "unauthorized" });
  expect(await readRouteUploadStatusAsParticipant(db, participantAuth, now)).toEqual({ status: "unauthorized" });
  expect((await pool.query<{ action: string }>("SELECT action FROM audit_event WHERE race_id=$1 AND action LIKE 'ROUTE_UPLOAD_%' ORDER BY created_at, id", [f.raceId])).rows.map(row => row.action))
    .toEqual(["ROUTE_UPLOAD_GRANT_ISSUED", "ROUTE_UPLOAD_RESERVED", "ROUTE_UPLOAD_ATTEMPT_CHARGED", "ROUTE_UPLOAD_STORED", "ROUTE_UPLOAD_GRANT_REVOKED"]);
  expect(await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${randomUUID()}`,
    request: { ...issue, grantId: randomUUID(), secretHash: "c".repeat(64) } }, now)).toMatchObject({ status: "issued", response: { replayed: false } });
});

it("TASK111 rejects expired, cross-entry and altered idempotent grant operations without another journal row", async () => {
  const f = await fixture(), requestId = randomUUID(), grantId = randomUUID();
  const request = { formatVersion: 1 as const, grantId, entryId: f.entryId, secretHash: hash, expiresAt: new Date(now.getTime() + 86_400_000).toISOString() };
  expect((await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${randomUUID()}`,
    request: { ...request, expiresAt: now.toISOString() } }, now)).status).toBe("invalid-request");
  expect((await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${requestId}`, request }, now)).status).toBe("issued");
  expect((await issueRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant:${requestId}`,
    request: { ...request, secretHash: "d".repeat(64) } }, now)).status).toBe("conflict");
  expect((await revokeRouteUploadGrantAsAdmin(db, { ...f.auth, idempotencyKey: `route-upload-grant-revoke:${randomUUID()}`,
    request: { formatVersion: 1, grantId, reason: "   " } }, now)).status).toBe("invalid-request");
  expect((await pool.query("SELECT count(*)::int AS value FROM route_upload_grant WHERE race_id=$1", [f.raceId])).rows).toEqual([{ value: 1 }]);
});
