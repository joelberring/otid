import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { bindPrivateRouteContextAsAdmin, readPrivateRouteContextStateAsAdmin, readMyPrivateRouteOverlay, resolveMyPrivateRouteMap } from "../../src/private-participant-route-context";
import { readMyPrivateRoute } from "../../src/participant-private-route";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { createMapGeoreferenceAsAdmin } from "../../src/map-georeference";
import { publishMapAssetAsAdmin, reserveMapAssetAsAdmin, transferMapAssetAsAdmin, withdrawMapAssetAsAdmin } from "../../src/map-asset";
import { createCourseControlGeometryAsAdmin } from "../../src/course-control-geometry";
import { issueParticipantEntryClaimAsAdmin, redeemParticipantEntryClaimAsAccount, revokeParticipantEntryClaimAsAdmin } from "../../src/participant-entry-claim";
import { issueRouteUploadGrantAsAdmin, revokeRouteUploadGrantAsAdmin } from "../../src/route-upload-grant";
import { redeemRouteUploadBearerLink, routeUploadBearerTokenPrefix } from "../../src/route-upload-session";
import { reserveRouteUploadAsParticipant, transferRouteUploadAsParticipant } from "../../src/route-upload";
import { contentHash } from "../../src/hash";
import { ingestDeviceBatch } from "../../src/ingest";
import { loginUserAccount, provisionUserAccount } from "../../src/user-account";
import { decideRoutePublicationConsentAsParticipant } from "../../src/route-publication-consent";
import { readPublicParticipantRoute, releasePublicParticipantRouteAsAdmin, withdrawPublicParticipantRouteAsAdmin } from "../../src/public-participant-route";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK155 kräver uttrycklig isolerad TEST_DATABASE_URL med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task155_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const now = new Date("2026-09-23T10:00:00.000Z");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="synthetic"><trk><trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-23T10:00:00Z</time></trkpt><trkpt lat="59.322" lon="18.072"><time>2026-09-23T10:01:00Z</time></trkpt></trkseg></trk></gpx>');
const gpxSecond = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="synthetic"><trk><trkseg><trkpt lat="59.3215" lon="18.071"/><trkpt lat="59.3225" lon="18.073"/></trkseg></trk></gpx>');
async function* bytes(value: Buffer): AsyncIterable<Uint8Array> { yield value; }

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task155_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig syntetisk testdatabas");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("TASK155 explicit privat route context", () => {
  it("binds an exact route/map/course projection and fails closed when its proofs change", async () => {
    const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID();
    const courseVersionId = randomUUID(), laterCourseVersionId = randomUUID();
    const classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
    const courseControlId = randomUUID(), laterControlId = randomUUID(), laterCourseControlId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, name: "TASK155 synthetic", startsOn: "2026-09-23", timeZone: "Europe/Stockholm" });
    await db.insert(schema.races).values({ id: raceId, eventId, name: "TASK155 synthetic", raceDate: "2026-09-23" });
    await db.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic course" });
    await db.insert(schema.courseVersions).values([{ id: courseVersionId, courseId, version: 1 }, { id: laterCourseVersionId, courseId, version: 2 }]);
    await db.insert(schema.controls).values([{ id: controlId, raceId, code: 31 }, { id: laterControlId, raceId, code: 32 }]);
    await db.insert(schema.courseControls).values([
      { id: courseControlId, courseVersionId, controlId, sequence: 1 },
      { id: laterCourseControlId, courseVersionId: laterCourseVersionId, controlId: laterControlId, sequence: 1 }
    ]);
    await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Synthetic class", startRule: "FIXED" });
    await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Test", familyName: "Runner", fixedStartTime: new Date("2026-09-23T10:00:00Z") });
    const cardNumber = `155${entryId.slice(0, 8)}`;
    await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber });

    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK155", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
    const adminLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
    if (adminLogin.status !== "authenticated") throw new Error("Synthetic administrator login failed");
    const adminProof = { raceId, sessionToken: adminLogin.sessionToken, csrfCookie: adminLogin.csrfToken, csrfHeader: adminLogin.csrfToken };

    const loginName = `task155.${randomUUID().slice(0, 8)}`;
    const account = await provisionUserAccount(db, { loginName, displayName: "Synthetic owner" }, { now });
    const ownerLogin = await loginUserAccount(db, { formatVersion: 1, loginName, password: account.initialPassword }, { now });
    if (ownerLogin.status !== "authenticated") throw new Error("Synthetic owner login failed");
    const owner = { sessionToken: ownerLogin.sessionToken, csrfCookie: ownerLogin.csrfToken, csrfHeader: ownerLogin.csrfToken };
    const otherName = `other.${randomUUID().slice(0, 8)}`;
    const otherAccount = await provisionUserAccount(db, { loginName: otherName, displayName: "Synthetic other" }, { now });
    const otherLogin = await loginUserAccount(db, { formatVersion: 1, loginName: otherName, password: otherAccount.initialPassword }, { now });
    if (otherLogin.status !== "authenticated") throw new Error("Synthetic other account login failed");
    const other = { sessionToken: otherLogin.sessionToken, csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken };

    const claimSecret = randomBytes(16), claimRequestId = randomUUID();
    const claim = await issueParticipantEntryClaimAsAdmin(db, { ...adminProof, entryId,
      idempotencyKey: `participant-claim-issue:${claimRequestId}`,
      request: { formatVersion: 1, requestId: claimRequestId, raceId, entryId, secretHash: sha256(claimSecret),
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attestation: "IDENTITY_CHECKED" } }, now);
    if (claim.status !== "issued") throw new Error("Synthetic entry claim issue failed");
    const redemptionId = randomUUID();
    expect(await redeemParticipantEntryClaimAsAccount(db, { ...owner,
      idempotencyKey: `participant-claim-redeem:${redemptionId}`,
      request: { formatVersion: 1, requestId: redemptionId, code: claimSecret.toString("base64url") } }, now)).toMatchObject({ status: "redeemed" });

    const map = await reserveMapAssetAsAdmin(db, { ...adminProof, idempotencyKey: `map-upload:${randomUUID()}`,
      request: { formatVersion: 1, title: "Synthetic map", mediaType: "image/png", byteLength: png.byteLength, sha256: sha256(png) } }, now);
    if (map.status !== "reserved") throw new Error("Synthetic map reservation failed");
    expect(await transferMapAssetAsAdmin(db, { ...adminProof, uploadId: map.response.uploadId, readBody: () => bytes(png) }, { async put(input) {
      return { formatVersion: 1, storeId: randomUUID(), key: `map/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
    } }, () => now)).toMatchObject({ status: "stored" });
    const georef = await createMapGeoreferenceAsAdmin(db, { ...adminProof, idempotencyKey: `map-georeference:${randomUUID()}`,
      request: { formatVersion: 1, manifestId: map.response.uploadId, expectedGeoreferenceRevision: 0, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326", tiePoints: [
        { pixelX: 0, pixelY: 0, longitude: 18.07, latitude: 59.323 },
        { pixelX: 1000, pixelY: 0, longitude: 18.08, latitude: 59.323 },
        { pixelX: 0, pixelY: 500, longitude: 18.07, latitude: 59.32 }
      ] } }, now);
    if (georef.status !== "created") throw new Error("Synthetic georeference creation failed");
    const geometry = await createCourseControlGeometryAsAdmin(db, { ...adminProof,
      idempotencyKey: `course-control-geometry:${randomUUID()}`,
      request: { formatVersion: 1, courseVersionId, mapManifestId: map.response.uploadId, georeferenceId: georef.response.georeferenceId,
        expectedGeometryRevision: 0, points: [{ courseControlId, pixelX: 100, pixelY: 200 }] } }, now);
    if (geometry.status !== "created") throw new Error("Synthetic course geometry creation failed");

    const grantId = randomUUID(), grantSecret = randomBytes(32);
    const grant = await issueRouteUploadGrantAsAdmin(db, { ...adminProof, idempotencyKey: `route-upload-grant:${randomUUID()}`,
      request: { formatVersion: 1, grantId, entryId, secretHash: sha256(grantSecret), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
    if (grant.status !== "issued") throw new Error("Synthetic route grant failed");
    const routeSession = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${grantId}.${grantSecret.toString("base64url")}`, now);
    if (routeSession.status !== "redeemed") throw new Error("Synthetic route session failed");
    const participant = { sessionToken: routeSession.sessionToken, csrfCookie: routeSession.csrfToken, csrfHeader: routeSession.csrfToken };
    const reservation = await reserveRouteUploadAsParticipant(db, { ...participant, idempotencyKey: `route-upload:${randomUUID()}`,
      request: { formatVersion: 1, fileName: "synthetic.gpx", mediaType: "application/gpx+xml", byteLength: gpx.byteLength, sha256: sha256(gpx) } }, now);
    if (reservation.status !== "reserved") throw new Error("Synthetic route reservation failed");
    expect(await transferRouteUploadAsParticipant(db, { ...participant, uploadId: reservation.response.uploadId, readBody: () => bytes(gpx) }, { async put(input) {
      return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-route-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
    } }, () => now)).toMatchObject({ status: "stored" });
    expect(await readMyPrivateRoute(db, owner, reservation.response.uploadId, now)).toMatchObject({
      status: "ok", response: { sharing: { consent: "NOT_GRANTED", publicRoute: { status: "UNAVAILABLE" } } }
    });
    expect(await decideRoutePublicationConsentAsParticipant(db, { ...participant,
      idempotencyKey: `route-publication-consent:${randomUUID()}`,
      request: { formatVersion: 1, decision: "GRANT" } }, now)).toMatchObject({ status: "stored" });
    expect(await revokeRouteUploadGrantAsAdmin(db, { ...adminProof, idempotencyKey: `route-upload-grant-revoke:${randomUUID()}`,
      request: { formatVersion: 1, grantId, reason: "synthetic second version" } }, now)).toMatchObject({ status: "revoked" });
    const secondGrantId = randomUUID(), secondGrantSecret = randomBytes(32);
    const secondGrant = await issueRouteUploadGrantAsAdmin(db, { ...adminProof, idempotencyKey: `route-upload-grant:${randomUUID()}`,
      request: { formatVersion: 1, grantId: secondGrantId, entryId, secretHash: sha256(secondGrantSecret), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
    if (secondGrant.status !== "issued") throw new Error("Synthetic second route grant failed");
    const secondRouteSession = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${secondGrantId}.${secondGrantSecret.toString("base64url")}`, now);
    if (secondRouteSession.status !== "redeemed") throw new Error("Synthetic second route session failed");
    const secondParticipant = { sessionToken: secondRouteSession.sessionToken, csrfCookie: secondRouteSession.csrfToken, csrfHeader: secondRouteSession.csrfToken };
    const secondReservation = await reserveRouteUploadAsParticipant(db, { ...secondParticipant, idempotencyKey: `route-upload:${randomUUID()}`,
      request: { formatVersion: 1, fileName: "synthetic-second.gpx", mediaType: "application/gpx+xml", byteLength: gpxSecond.byteLength, sha256: sha256(gpxSecond) } }, now);
    if (secondReservation.status !== "reserved") throw new Error("Synthetic second route reservation failed");
    expect(await transferRouteUploadAsParticipant(db, { ...secondParticipant, uploadId: secondReservation.response.uploadId, readBody: () => bytes(gpxSecond) }, { async put(input) {
      return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-route-second-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
    } }, () => now)).toMatchObject({ status: "stored" });

    const payload = { cardNumber, startPunchedAt: "2026-09-23T10:00:00Z", finishPunchedAt: "2026-09-23T10:20:00Z", punches: [{ code: 31, punchedAt: "2026-09-23T10:10:00Z" }] };
    const deviceId = randomUUID();
    await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2026-09-23T10:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });

    const routeUploadId = reservation.response.uploadId;
    const secondRouteUploadId = secondReservation.response.uploadId;
    const publicResultId = (await db.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries).where(eq(schema.entries.id, entryId)))[0]?.publicResultId;
    if (!publicResultId) throw new Error("Synthetic public result identity missing");
    const share = (routeId: string) => readMyPrivateRoute(db, owner, routeId, now);
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { routeUploadId, sharing: {
      consent: "GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect(await share(secondRouteUploadId)).toMatchObject({ status: "ok", response: { routeUploadId: secondRouteUploadId, sharing: {
      consent: "NOT_GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect(await share(secondRouteUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "NOT_GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    const mapPublication = await publishMapAssetAsAdmin(db, { ...adminProof,
      idempotencyKey: `map-publish:${randomUUID()}`,
      request: { formatVersion: 1, uploadId: map.response.uploadId, expectedPublicationRevision: 0 } }, now);
    expect(mapPublication).toMatchObject({ status: "published" });
    const routeRelease = await releasePublicParticipantRouteAsAdmin(db, { ...adminProof,
      idempotencyKey: `route-publication-release:${randomUUID()}`,
      request: { formatVersion: 1, routeUploadId, mapManifestId: map.response.uploadId,
        georeferenceId: georef.response.georeferenceId, expectedPublicationRevision: 0 } }, now);
    expect(routeRelease).toMatchObject({ status: "released" });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "GRANTED", adminRelease: "ACTIVE", publicRoute: { status: "AVAILABLE", publicResultId }
    } } });
    expect(await share(secondRouteUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "NOT_GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect((await readPublicParticipantRoute(db, raceId, publicResultId)).status).toBe("ok");
    if (mapPublication.status !== "published") throw new Error("Synthetic map publication failed");
    expect(await withdrawMapAssetAsAdmin(db, { ...adminProof,
      idempotencyKey: `map-withdraw:${randomUUID()}`,
      request: { formatVersion: 1, publicationId: mapPublication.response.publicationId,
        expectedPublicationRevision: mapPublication.response.revision } }, now)).toMatchObject({ status: "withdrawn" });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect((await readPublicParticipantRoute(db, raceId, publicResultId)).status).toBe("not-found");
    expect(await publishMapAssetAsAdmin(db, { ...adminProof,
      idempotencyKey: `map-publish:${randomUUID()}`,
      request: { formatVersion: 1, uploadId: map.response.uploadId, expectedPublicationRevision: 2 } }, now)).toMatchObject({ status: "published" });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "GRANTED", adminRelease: "ACTIVE", publicRoute: { status: "AVAILABLE", publicResultId }
    } } });
    // The first upload grant was revoked to permit a second version. TASK116
    // covers the consent mutator; insert its immutable journal fact here to
    // exercise C2c's exact-version read after the old session is no longer live.
    await db.insert(schema.routePublicationConsents).values({ requestId: randomUUID(), grantId,
      raceId, entryId, manifestId: routeUploadId, sourceHash: sha256(gpx), revision: 2,
      decision: "WITHDRAW", decidedAt: now });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "NOT_GRANTED", adminRelease: "ACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect((await readPublicParticipantRoute(db, raceId, publicResultId)).status).toBe("not-found");
    expect((await share(routeUploadId)).status).toBe("ok");
    if (routeRelease.status !== "released") throw new Error("Synthetic route release failed");
    expect(await withdrawPublicParticipantRouteAsAdmin(db, { ...adminProof,
      idempotencyKey: `route-publication-withdraw:${randomUUID()}`,
      request: { formatVersion: 1, publicationId: routeRelease.response.publicationId,
        expectedPublicationRevision: routeRelease.response.revision } }, now)).toMatchObject({ status: "withdrawn" });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect((await readPublicParticipantRoute(db, raceId, publicResultId)).status).toBe("not-found");
    expect((await share(routeUploadId)).status).toBe("ok");

    const bindRequest = { formatVersion: 1 as const, routeUploadId, mapManifestId: map.response.uploadId,
      georeferenceId: georef.response.georeferenceId, geometryRevisionId: geometry.response.geometryRevisionId,
      expectedContextRevision: 0 };
    const missing = await readMyPrivateRouteOverlay(db, owner, routeUploadId, now);
    expect(missing.status).toBe("not-found");
    expect((await resolveMyPrivateRouteMap(db, owner, routeUploadId, 1, now)).status).toBe("not-found");
    const bind = (request: typeof bindRequest, requestId = randomUUID()) => bindPrivateRouteContextAsAdmin(db, {
      ...adminProof, idempotencyKey: `private-route-context-bind:${requestId}`, request
    }, now);
    expect((await bind({ ...bindRequest, mapManifestId: randomUUID() })).status).toBe("conflict");
    expect((await bind({ ...bindRequest, geometryRevisionId: randomUUID() })).status).toBe("conflict");
    expect((await bind({ ...bindRequest, routeUploadId: randomUUID() })).status).toBe("not-found");

    const requestId = randomUUID();
    const bound = await bind(bindRequest, requestId);
    expect(bound).toMatchObject({ status: "bound", response: { revision: 1, replayed: false,
      routeUploadId, mapManifestId: map.response.uploadId, georeferenceId: georef.response.georeferenceId,
      geometryRevisionId: geometry.response.geometryRevisionId, courseVersionId } });
    expect(await bind(bindRequest, requestId)).toMatchObject({ status: "bound", response: { revision: 1, replayed: true } });
    expect(await bind({ ...bindRequest, mapManifestId: randomUUID() }, requestId)).toMatchObject({ status: "conflict" });
    expect(await readPrivateRouteContextStateAsAdmin(db, { ...adminProof, routeUploadId }, now)).toMatchObject({
      status: "ok", response: { latestContextRevision: 1, activeContext: { mapManifestId: map.response.uploadId, courseVersionId } }
    });
    const overlay = await readMyPrivateRouteOverlay(db, owner, routeUploadId, now);
    expect(overlay).toMatchObject({ status: "ok", response: { formatVersion: 4, routeUploadId, contextRevision: 1, imageWidth: 1001, imageHeight: 501,
      points: [{ segment: 0 }, { segment: 0 }], controls: [{ sequence: 1, controlCode: 31, x: 100, y: 200 }],
      playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] },
      resultSplits: { status: "AVAILABLE", resultRevision: 1,
        splits: [{ controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 }] },
      resultStart: { status: "AVAILABLE", resultRevision: 1, startedAt: "2026-09-23T10:00:00.000Z" },
      metadata: { pointCount: 2, timing: { status: "AVAILABLE", durationMilliseconds: 60_000 } } } });
    expect(await resolveMyPrivateRouteMap(db, owner, routeUploadId, 1, now)).toMatchObject({ status: "ok", response: {
      uploadId: map.response.uploadId, sha256: sha256(png), versionId: "synthetic-v1"
    } });
    expect(JSON.stringify(overlay)).not.toContain(entryId);
    expect(JSON.stringify(overlay)).not.toMatch(/latitude|longitude|courseVersionId|geometryRevisionId|sourceResultRevisionId|recordedAt/);
    expect((await readMyPrivateRouteOverlay(db, owner, secondRouteUploadId, now)).status).toBe("not-found");
    expect((await resolveMyPrivateRouteMap(db, owner, secondRouteUploadId, 1, now)).status).toBe("not-found");
    const secondBindRequest = { ...bindRequest, routeUploadId: secondRouteUploadId };
    expect(await bind(secondBindRequest)).toMatchObject({ status: "bound", response: { revision: 1, routeUploadId: secondRouteUploadId } });
    expect(await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).toMatchObject({ status: "ok", response: { contextRevision: 1 } });
    expect(await readMyPrivateRouteOverlay(db, owner, secondRouteUploadId, now)).toMatchObject({ status: "ok", response: {
      routeUploadId: secondRouteUploadId, contextRevision: 1, metadata: { timing: { status: "UNAVAILABLE" } },
      playback: { status: "UNAVAILABLE" }, resultSplits: { status: "AVAILABLE", resultRevision: 1 },
      resultStart: { status: "AVAILABLE", resultRevision: 1, startedAt: "2026-09-23T10:00:00.000Z" }
    } });
    expect((await readMyPrivateRouteOverlay(db, other, routeUploadId, now)).status).toBe("not-found");
    expect((await readMyPrivateRoute(db, other, routeUploadId, now)).status).toBe("not-found");
    expect((await resolveMyPrivateRouteMap(db, other, routeUploadId, 1, now)).status).toBe("not-found");
    expect((await readMyPrivateRouteOverlay(db, { sessionToken: null }, routeUploadId, now)).status).toBe("unauthorized");
    expect((await readMyPrivateRoute(db, { sessionToken: null }, routeUploadId, now)).status).toBe("unauthorized");
    expect((await resolveMyPrivateRouteMap(db, { sessionToken: null }, routeUploadId, 1, now)).status).toBe("unauthorized");

    await db.update(schema.classes).set({ courseVersionId: laterCourseVersionId }).where(eq(schema.classes.id, classId));
    const changedPayload = { ...payload, punches: [{ code: 32, punchedAt: "2026-09-23T10:10:00Z" }] };
    await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 2, lastSequence: 2,
      events: [{ localSequence: 2, stationReceivedAt: "2026-09-23T10:22:00Z", transport: "simulator", payload: changedPayload, contentHash: contentHash(changedPayload) }] });
    await db.insert(schema.routePublicationConsents).values({ requestId: randomUUID(), grantId,
      raceId, entryId, manifestId: routeUploadId, sourceHash: sha256(gpx), revision: 3,
      decision: "GRANT", decidedAt: now });
    const releaseWithoutGeometry = await releasePublicParticipantRouteAsAdmin(db, { ...adminProof,
      idempotencyKey: `route-publication-release:${randomUUID()}`,
      request: { formatVersion: 1, routeUploadId, mapManifestId: map.response.uploadId,
        georeferenceId: georef.response.georeferenceId, expectedPublicationRevision: 2 } }, now);
    expect(releaseWithoutGeometry).toMatchObject({ status: "released" });
    expect(await share(routeUploadId)).toMatchObject({ status: "ok", response: { sharing: {
      consent: "GRANTED", adminRelease: "ACTIVE", publicRoute: { status: "UNAVAILABLE" }
    } } });
    expect((await readPublicParticipantRoute(db, raceId, publicResultId)).status).toBe("not-found");
    expect((await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).status).toBe("not-found");
    expect((await resolveMyPrivateRouteMap(db, owner, routeUploadId, 1, now)).status).toBe("not-found");
    await db.update(schema.classes).set({ courseVersionId }).where(eq(schema.classes.id, classId));
    await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 3, lastSequence: 3,
      events: [{ localSequence: 3, stationReceivedAt: "2026-09-23T10:23:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
    expect((await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).status).toBe("ok");
    expect(await bind({ ...bindRequest, expectedContextRevision: 1 })).toMatchObject({ status: "bound", response: { revision: 2 } });
    expect((await resolveMyPrivateRouteMap(db, owner, routeUploadId, 1, now)).status).toBe("not-found");
    expect(await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).toMatchObject({ status: "ok", response: {
      contextRevision: 2, resultSplits: { status: "AVAILABLE", resultRevision: 3,
        splits: [{ controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 }] },
      resultStart: { status: "AVAILABLE", resultRevision: 3, startedAt: "2026-09-23T10:00:00.000Z" }
    } });
    expect((await resolveMyPrivateRouteMap(db, owner, routeUploadId, 2, now)).status).toBe("ok");
    expect(await readMyPrivateRouteOverlay(db, owner, secondRouteUploadId, now)).toMatchObject({ status: "ok", response: {
      routeUploadId: secondRouteUploadId, contextRevision: 1
    } });
    expect(await readPrivateRouteContextStateAsAdmin(db, { ...adminProof, routeUploadId: secondRouteUploadId }, now)).toMatchObject({
      status: "ok", response: { latestContextRevision: 1, activeContext: { mapManifestId: map.response.uploadId, courseVersionId } }
    });
    const missingControlPayload = { ...payload, punches: [] };
    await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 4, lastSequence: 4,
      events: [{ localSequence: 4, stationReceivedAt: "2026-09-23T10:24:00Z", transport: "simulator",
        payload: missingControlPayload, contentHash: contentHash(missingControlPayload) }] });
    expect(await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).toMatchObject({ status: "ok", response: {
      contextRevision: 2, resultSplits: { status: "UNAVAILABLE" },
      resultStart: { status: "AVAILABLE", resultRevision: 4, startedAt: "2026-09-23T10:00:00.000Z" }
    } });
    await db.update(schema.classes).set({ startRule: "PUNCH" }).where(eq(schema.classes.id, classId));
    const missingStartPayload = { cardNumber, finishPunchedAt: "2026-09-23T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-23T10:10:00Z" }] };
    await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 5, lastSequence: 5,
      events: [{ localSequence: 5, stationReceivedAt: "2026-09-23T10:25:00Z", transport: "simulator",
        payload: missingStartPayload, contentHash: contentHash(missingStartPayload) }] });
    expect(await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).toMatchObject({ status: "ok", response: {
      contextRevision: 2, resultSplits: { status: "UNAVAILABLE" }, resultStart: { status: "UNAVAILABLE" }
    } });
    const revokeRequestId = randomUUID();
    expect(await revokeParticipantEntryClaimAsAdmin(db, { ...adminProof, entryId, claimId: claim.response.claimId,
      idempotencyKey: `participant-claim-revoke:${revokeRequestId}`,
      request: { formatVersion: 1, requestId: revokeRequestId, raceId, entryId, claimId: claim.response.claimId, reason: "synthetic test" } }, now)).toMatchObject({ status: "revoked" });
    expect((await readMyPrivateRouteOverlay(db, owner, routeUploadId, now)).status).toBe("not-found");
    expect((await share(routeUploadId)).status).toBe("not-found");
    expect((await resolveMyPrivateRouteMap(db, owner, routeUploadId, 2, now)).status).toBe("not-found");
    expect(await revokeRouteUploadGrantAsAdmin(db, { ...adminProof, idempotencyKey: `route-upload-grant-revoke:${randomUUID()}`,
      request: { formatVersion: 1, grantId: secondGrantId, reason: "synthetic test" } }, now)).toMatchObject({ status: "revoked" });
  });
});
