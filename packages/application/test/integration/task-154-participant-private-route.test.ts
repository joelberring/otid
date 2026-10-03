import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { issueParticipantEntryClaimAsAdmin, redeemParticipantEntryClaimAsAccount, revokeParticipantEntryClaimAsAdmin } from "../../src/participant-entry-claim";
import { listMyPrivateRoutes, readMyPrivateRoute } from "../../src/participant-private-route";
import { issueRouteUploadGrantAsAdmin, revokeRouteUploadGrantAsAdmin } from "../../src/route-upload-grant";
import { reserveRouteUploadAsParticipant, transferRouteUploadAsParticipant } from "../../src/route-upload";
import { redeemRouteUploadBearerLink, routeUploadBearerTokenPrefix } from "../../src/route-upload-session";
import { loginUserAccount, logoutUserAccountSession, provisionUserAccount } from "../../src/user-account";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK154 kräver uttrycklig isolerad TEST_DATABASE_URL med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task154_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const now = new Date("2026-09-23T10:00:00.000Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task154_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig syntetisk testdatabas");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function* bytes(value: Buffer): AsyncIterable<Uint8Array> { yield value; }
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const gpx = (points: string) => Buffer.from(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="synthetic"><trk>${points}</trk></gpx>`);

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID();
  const courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetiskt arrangemang", startsOn: "2026-09-23", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Syntetiskt lopp", raceDate: "2026-09-23" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Öppen", startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Test", familyName: "Deltagare" });
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK154", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Syntetisk administratörsinloggning misslyckades");
  const adminProof = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };

  const loginName = `participant.${randomUUID().slice(0, 8)}`;
  const created = await provisionUserAccount(db, { loginName, displayName: "Syntetisk deltagare" }, { now });
  const accountLogin = await loginUserAccount(db, { formatVersion: 1, loginName, password: created.initialPassword }, { now });
  if (accountLogin.status !== "authenticated") throw new Error("Syntetisk kontoinloggning misslyckades");
  const proof = { sessionToken: accountLogin.sessionToken, csrfCookie: accountLogin.csrfToken, csrfHeader: accountLogin.csrfToken };
  const otherName = `other.${randomUUID().slice(0, 8)}`;
  const otherCreated = await provisionUserAccount(db, { loginName: otherName, displayName: "Annat syntetiskt konto" }, { now });
  const otherLogin = await loginUserAccount(db, { formatVersion: 1, loginName: otherName, password: otherCreated.initialPassword }, { now });
  if (otherLogin.status !== "authenticated") throw new Error("Syntetiskt andra kontot saknas");
  const otherProof = { sessionToken: otherLogin.sessionToken, csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken };

  const secret = randomBytes(16), requestId = randomUUID();
  const claim = await issueParticipantEntryClaimAsAdmin(db, { ...adminProof, entryId,
    idempotencyKey: `participant-claim-issue:${requestId}`,
    request: { formatVersion: 1, requestId, raceId, entryId, secretHash: hash(secret),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attestation: "IDENTITY_CHECKED" } }, now);
  if (claim.status !== "issued") throw new Error("Syntetisk kontokoppling kunde inte utfärdas");
  const redeemId = randomUUID();
  const redeemed = await redeemParticipantEntryClaimAsAccount(db, { ...proof,
    idempotencyKey: `participant-claim-redeem:${redeemId}`,
    request: { formatVersion: 1, requestId: redeemId, code: secret.toString("base64url") } }, now);
  if (redeemed.status !== "redeemed") throw new Error("Syntetisk kontokoppling kunde inte lösas in");
  return { raceId, entryId, adminProof, proof, otherProof, claimId: claim.response.claimId };
}

async function upload(f: Awaited<ReturnType<typeof fixture>>, content: Buffer, at = now) {
  const grantId = randomUUID(), secret = randomBytes(32);
  const grant = await issueRouteUploadGrantAsAdmin(db, { ...f.adminProof,
    idempotencyKey: `route-upload-grant:${randomUUID()}`,
    request: { formatVersion: 1, grantId, entryId: f.entryId,
      secretHash: hash(secret), expiresAt: new Date(at.getTime() + 3_600_000).toISOString() } }, at);
  if (grant.status !== "issued") throw new Error(`Syntetiskt upload-grant misslyckades: ${grant.status}`);
  const session = await redeemRouteUploadBearerLink(db,
    `${routeUploadBearerTokenPrefix}.${grantId}.${secret.toString("base64url")}`, at);
  if (session.status !== "redeemed") throw new Error("Syntetiskt upload-grant kunde inte lösas in");
  const participant = { sessionToken: session.sessionToken, csrfCookie: session.csrfToken, csrfHeader: session.csrfToken };
  const reservation = await reserveRouteUploadAsParticipant(db, { ...participant,
    idempotencyKey: `route-upload:${randomUUID()}`,
    request: { formatVersion: 1, fileName: "synthetic.gpx", mediaType: "application/gpx+xml", byteLength: content.byteLength, sha256: hash(content) } }, at);
  if (reservation.status !== "reserved") throw new Error("Syntetisk GPX-reservation misslyckades");
  const stored = await transferRouteUploadAsParticipant(db, { ...participant,
    uploadId: reservation.response.uploadId, readBody: () => bytes(content) }, { async put(input) {
      return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`,
        versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
    } }, () => at);
  if (stored.status !== "stored") throw new Error(`Syntetisk GPX-lagring misslyckades: ${stored.status}`);
  return { grantId, uploadId: reservation.response.uploadId };
}

async function revokeGrant(f: Awaited<ReturnType<typeof fixture>>, grantId: string) {
  return revokeRouteUploadGrantAsAdmin(db, { ...f.adminProof,
    idempotencyKey: `route-upload-grant-revoke:${randomUUID()}`,
    request: { formatVersion: 1, grantId, reason: "synthetic test" } }, now);
}

describe("TASK154 kontobunden privat GPX-läsning", () => {
  it("listar och öppnar exakt två lagrade versioner utan att uppladdningsgrant ger läsrätt", async () => {
    const f = await fixture();
    const first = await upload(f, gpx('<trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-23T10:00:00Z</time></trkpt><trkpt lat="59.322" lon="18.072"><time>2026-09-23T10:01:00Z</time></trkpt></trkseg>'));
    expect(await revokeGrant(f, first.grantId)).toMatchObject({ status: "revoked" });
    const second = await upload(f, gpx('<trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-23T10:02:00Z</time></trkpt><trkpt lat="59.323" lon="18.073"><time>2026-09-23T10:04:00Z</time></trkpt></trkseg>'), new Date(now.getTime() + 1_000));
    const list = await listMyPrivateRoutes(db, f.proof, new Date(now.getTime() + 2_000));
    expect(list.status).toBe("ok");
    if (list.status !== "ok") throw new Error("Syntetisk privat ruttlista saknas");
    expect(list.response.items.map(item => item.routeUploadId)).toEqual(expect.arrayContaining([first.uploadId, second.uploadId]));
    expect(await readMyPrivateRoute(db, f.proof, first.uploadId, new Date(now.getTime() + 2_000)))
      .toMatchObject({ status: "ok", response: { routeUploadId: first.uploadId, metadata: { timing: { status: "AVAILABLE", durationMilliseconds: 60_000 } } } });
    expect(await readMyPrivateRoute(db, f.proof, second.uploadId, new Date(now.getTime() + 2_000)))
      .toMatchObject({ status: "ok", response: { routeUploadId: second.uploadId, metadata: { timing: { status: "AVAILABLE", durationMilliseconds: 120_000 } } } });
    expect((await readMyPrivateRoute(db, f.otherProof, first.uploadId, now)).status).toBe("not-found");
    expect((await readMyPrivateRoute(db, { sessionToken: null }, first.uploadId, now)).status).toBe("unauthorized");
    expect(await listMyPrivateRoutes(db, f.otherProof, now)).toMatchObject({ status: "ok", response: { items: [] } });
    expect((await listMyPrivateRoutes(db, { sessionToken: null }, now)).status).toBe("unauthorized");
    expect(JSON.stringify(list)).not.toContain(f.entryId);
    const detail = await readMyPrivateRoute(db, f.proof, first.uploadId, now);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('"latitude"');
    expect(serialized).not.toContain('"longitude"');
    expect(serialized).not.toContain('"entryId"');
    expect(serialized).not.toContain('"objectKey"');
    expect(serialized).not.toContain('"grantId"');
    expect(serialized).not.toContain('"resultRevision"');
    expect(serialized).not.toContain('"versionId"');
    expect(serialized).not.toContain('"storeId"');
    // A trusted-database inconsistency must not be presented as valid route facts.
    await db.insert(schema.routePoints).values({ uploadId: first.uploadId, sequence: 2,
      segment: 0, latitude: 59.324, longitude: 18.074, recordedAt: now });
    expect((await readMyPrivateRoute(db, f.proof, first.uploadId, now)).status).toBe("invalid-route");
  });

  it("keeps split-segment distance safe and reports missing or non-monotonic timing as unavailable", async () => {
    const f = await fixture();
    const split = await upload(f, gpx('<trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-23T10:00:00Z</time></trkpt><trkpt lat="59.321" lon="18.072"><time>2026-09-23T10:01:00Z</time></trkpt></trkseg><trkseg><trkpt lat="60.321" lon="28.071"><time>2026-09-23T10:02:00Z</time></trkpt><trkpt lat="60.321" lon="28.072"><time>2026-09-23T10:03:00Z</time></trkpt></trkseg>'));
    expect(await readMyPrivateRoute(db, f.proof, split.uploadId, now)).toMatchObject({ status: "ok", response: { metadata: { segmentCount: 2, timing: { status: "AVAILABLE" } } } });
    const splitDetail = await readMyPrivateRoute(db, f.proof, split.uploadId, now);
    if (splitDetail.status !== "ok") throw new Error("Split route detail saknas");
    expect(splitDetail.response.metadata.distanceMeters).toBeLessThan(1_000);

    expect(await revokeGrant(f, split.grantId)).toMatchObject({ status: "revoked" });
    const undated = await upload(f, gpx('<trkseg><trkpt lat="59.321" lon="18.071"/><trkpt lat="59.322" lon="18.072"/></trkseg>'), new Date(now.getTime() + 1_000));
    expect(await readMyPrivateRoute(db, f.proof, undated.uploadId, new Date(now.getTime() + 2_000)))
      .toMatchObject({ status: "ok", response: { metadata: { timing: { status: "UNAVAILABLE" } } } });

    expect(await revokeGrant(f, undated.grantId)).toMatchObject({ status: "revoked" });
    const nonMonotonic = await upload(f, gpx('<trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-23T10:03:00Z</time></trkpt><trkpt lat="59.322" lon="18.072"><time>2026-09-23T10:02:00Z</time></trkpt></trkseg>'), new Date(now.getTime() + 2_000));
    expect(await readMyPrivateRoute(db, f.proof, nonMonotonic.uploadId, new Date(now.getTime() + 3_000)))
      .toMatchObject({ status: "ok", response: { metadata: { timing: { status: "UNAVAILABLE" } } } });
  });

  it("stops reads after claim revocation or account logout", async () => {
    const f = await fixture();
    const route = await upload(f, gpx('<trkseg><trkpt lat="59.321" lon="18.071"/><trkpt lat="59.322" lon="18.072"/></trkseg>'));
    const revokeId = randomUUID();
    expect(await revokeParticipantEntryClaimAsAdmin(db, { ...f.adminProof, entryId: f.entryId, claimId: f.claimId,
      idempotencyKey: `participant-claim-revoke:${revokeId}`,
      request: { formatVersion: 1, requestId: revokeId, raceId: f.raceId, entryId: f.entryId,
        claimId: f.claimId, reason: "synthetic test" } }, now)).toMatchObject({ status: "revoked" });
    const afterRevoke = await listMyPrivateRoutes(db, f.proof, now);
    expect(afterRevoke.status).toBe("ok");
    if (afterRevoke.status !== "ok") throw new Error("Privat ruttlista saknas efter spärr");
    expect(afterRevoke.response.items).toHaveLength(0);
    expect((await readMyPrivateRoute(db, f.proof, route.uploadId, now)).status).toBe("not-found");

    const logout = await logoutUserAccountSession(db, f.proof, now);
    expect(logout.status).toBe("logged-out");
    expect((await listMyPrivateRoutes(db, f.proof, now)).status).toBe("unauthorized");
  });
});
