import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { createMapGeoreferenceAsAdmin } from "../../src/map-georeference";
import { publishMapAssetAsAdmin, reserveMapAssetAsAdmin, transferMapAssetAsAdmin } from "../../src/map-asset";
import { readPrivateRoutePreviewAsAdmin, listPrivateRoutePreviewCandidatesAsAdmin, resolvePrivateRoutePreviewMapAsAdmin } from "../../src/private-route-preview";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { issueRouteUploadGrantAsAdmin } from "../../src/route-upload-grant";
import { redeemRouteUploadBearerLink, routeUploadBearerTokenPrefix } from "../../src/route-upload-session";
import { reserveRouteUploadAsParticipant, transferRouteUploadAsParticipant } from "../../src/route-upload";
import { decideRoutePublicationConsentAsParticipant } from "../../src/route-publication-consent";
import { readPublicParticipantRoute, readPublicParticipantRouteComparison, readPublicParticipantRoutePublicationStateAsAdmin, releasePublicParticipantRouteAsAdmin, withdrawPublicParticipantRouteAsAdmin } from "../../src/public-participant-route";
import { createCourseControlGeometryAsAdmin, readCourseControlGeometryStateAsAdmin } from "../../src/course-control-geometry";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-21T19:00:00.000Z");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const pngHash = createHash("sha256").update(png).digest("hex");
const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-21T10:00:00Z</time></trkpt><trkpt lat="59.322" lon="18.072"><time>2026-09-21T10:01:00Z</time></trkpt></trkseg></trk></gpx>');
const gpxHash = createHash("sha256").update(gpx).digest("hex");
const gpxSecond = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.3205" lon="18.071"><time>2026-09-21T10:02:00Z</time></trkpt><trkpt lat="59.3215" lon="18.073"><time>2026-09-21T10:03:30Z</time></trkpt></trkseg></trk></gpx>');
const gpxSecondHash = createHash("sha256").update(gpxSecond).digest("hex");
const gpxThird = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.3215" lon="18.071"><time>2026-09-21T10:05:00Z</time></trkpt><trkpt lat="59.3225" lon="18.074"><time>2026-09-21T10:07:00Z</time></trkpt></trkseg></trk></gpx>');
const gpxThirdHash = createHash("sha256").update(gpxThird).digest("hex");

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function* bytes(value: Buffer): AsyncIterable<Uint8Array> { yield value; }

it("TASK115/TASK120/TASK121/TASK122/TASK124 selects exact private versions and emits only compatible historical public routes", async () => {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(), currentCourseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID(), secondEntryId = randomUUID(), thirdEntryId = randomUUID(), controlId = randomUUID(), courseControlId = randomUUID(), currentControlId = randomUUID(), currentCourseControlId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK115','2026-09-21','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK115','2026-09-21')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'TASK115')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,2)", [currentCourseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(id,course_version_id,control_id,sequence) VALUES($1,$2,$3,1)", [courseControlId, courseVersionId, controlId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,32)", [currentControlId, raceId]);
  await pool.query("INSERT INTO course_control(id,course_version_id,control_id,sequence) VALUES($1,$2,$3,1)", [currentCourseControlId, currentCourseVersionId, currentControlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Öppen',$3,'FIXED')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$2,$3,'Ada','Route',$4)", [entryId, raceId, classId, "2026-09-21T10:00:00Z"]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$2,$3,'Bea','Route',$4)", [secondEntryId, raceId, classId, "2026-09-21T10:00:00Z"]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$2,$3,'Cy','Route',$4)", [thirdEntryId, raceId, classId, "2026-09-21T10:00:00Z"]);
  const cardNumber = `117${entryId.slice(0, 8)}`;
  const secondCardNumber = `117${secondEntryId.slice(0, 8)}`;
  const thirdCardNumber = `117${thirdEntryId.slice(0, 8)}`;
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [raceId, entryId, cardNumber]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [raceId, secondEntryId, secondCardNumber]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [raceId, thirdEntryId, thirdCardNumber]);
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK115", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic preview administrator login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };

  const map = await reserveMapAssetAsAdmin(db, { ...auth, idempotencyKey: `map-upload:${randomUUID()}`, request: { formatVersion: 1, title: "Preview map", mediaType: "image/png", byteLength: png.byteLength, sha256: pngHash } }, now);
  if (map.status !== "reserved") throw new Error(`Synthetic map reservation failed: ${map.status}`);
  const storedMap = await transferMapAssetAsAdmin(db, { ...auth, uploadId: map.response.uploadId, readBody: () => bytes(png) }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `map/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now);
  if (storedMap.status !== "stored") throw new Error("Synthetic map storage failed");
  const publishedMap = await publishMapAssetAsAdmin(db, { ...auth, idempotencyKey: `map-publish:${randomUUID()}`, request: { formatVersion: 1, uploadId: map.response.uploadId, expectedPublicationRevision: 0 } }, now);
  if (publishedMap.status !== "published") throw new Error("Synthetic map publication failed");
  const georeference = await createMapGeoreferenceAsAdmin(db, { ...auth, idempotencyKey: `map-georeference:${randomUUID()}`, request: { formatVersion: 1, manifestId: map.response.uploadId, expectedGeoreferenceRevision: 0, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326", tiePoints: [
    { pixelX: 0, pixelY: 0, longitude: 18.07, latitude: 59.323 },
    { pixelX: 1000, pixelY: 0, longitude: 18.08, latitude: 59.323 },
    { pixelX: 0, pixelY: 500, longitude: 18.07, latitude: 59.32 }
  ] } }, now);
  if (georeference.status !== "created") throw new Error("Synthetic georeference creation failed");
  const geometryRequest = { formatVersion: 1 as const, courseVersionId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, expectedGeometryRevision: 0, points: [{ courseControlId, pixelX: 100, pixelY: 200 }] };
  const geometryKey = `course-control-geometry:${randomUUID()}`;
  const geometry = await createCourseControlGeometryAsAdmin(db, { ...auth, idempotencyKey: geometryKey, request: geometryRequest }, now);
  expect(geometry).toMatchObject({ status: "created", response: { courseVersionId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, revision: 1, replayed: false } });
  expect(await createCourseControlGeometryAsAdmin(db, { ...auth, idempotencyKey: geometryKey, request: geometryRequest }, now)).toMatchObject({ status: "created", response: { replayed: true, revision: 1 } });
  expect((await createCourseControlGeometryAsAdmin(db, { ...auth, idempotencyKey: `course-control-geometry:${randomUUID()}`, request: { ...geometryRequest, points: [] } }, now)).status).toBe("invalid-request");
  const currentGeometry = await createCourseControlGeometryAsAdmin(db, { ...auth, idempotencyKey: `course-control-geometry:${randomUUID()}`, request: { formatVersion: 1, courseVersionId: currentCourseVersionId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, expectedGeometryRevision: 0, points: [{ courseControlId: currentCourseControlId, pixelX: 300, pixelY: 400 }] } }, now);
  expect(currentGeometry).toMatchObject({ status: "created", response: { courseVersionId: currentCourseVersionId, revision: 1 } });
  const geometryState = await readCourseControlGeometryStateAsAdmin(db, { raceId, sessionToken: auth.sessionToken }, now);
  expect(geometryState.status).toBe("ok");
  if (geometryState.status === "ok") {
    expect(geometryState.response.raceId).toBe(raceId);
    expect(geometryState.response.courses.find(course => course.courseVersionId === courseVersionId)).toMatchObject({ courseName: "TASK115", version: 1, controls: [{ courseControlId, controlCode: 31, sequence: 1 }] });
    expect(geometryState.response.courses.find(course => course.courseVersionId === currentCourseVersionId)).toMatchObject({ courseName: "TASK115", version: 2, controls: [{ courseControlId: currentCourseControlId, controlCode: 32, sequence: 1 }] });
    expect(geometryState.response.geometries.filter(geometry => geometry.mapManifestId === map.response.uploadId && geometry.georeferenceId === georeference.response.georeferenceId)).toHaveLength(2);
  }
  const laterGeoreference = await createMapGeoreferenceAsAdmin(db, { ...auth, idempotencyKey: `map-georeference:${randomUUID()}`, request: { formatVersion: 1, manifestId: map.response.uploadId, expectedGeoreferenceRevision: 1, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326", tiePoints: [
    { pixelX: 0, pixelY: 0, longitude: 18.07, latitude: 59.323 },
    { pixelX: 1000, pixelY: 0, longitude: 18.08, latitude: 59.323 },
    { pixelX: 0, pixelY: 500, longitude: 18.07, latitude: 59.32 }
  ] } }, now);
  if (laterGeoreference.status !== "created") throw new Error("Synthetic later georeference creation failed");

  const grantId = randomUUID(), secret = Buffer.alloc(32, 5);
  const grant = await issueRouteUploadGrantAsAdmin(db, { ...auth, idempotencyKey: `route-upload-grant:${randomUUID()}`, request: { formatVersion: 1, grantId, entryId, secretHash: createHash("sha256").update(secret).digest("hex"), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
  if (grant.status !== "issued") throw new Error("Synthetic route grant failed");
  const redeemed = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${grantId}.${secret.toString("base64url")}`, now);
  if (redeemed.status !== "redeemed") throw new Error("Synthetic route redeem failed");
  const participant = { sessionToken: redeemed.sessionToken, csrfCookie: redeemed.csrfToken, csrfHeader: redeemed.csrfToken };
  const route = await reserveRouteUploadAsParticipant(db, { ...participant, idempotencyKey: `route-upload:${randomUUID()}`, request: { formatVersion: 1, fileName: "ada.gpx", mediaType: "application/gpx+xml", byteLength: gpx.byteLength, sha256: gpxHash } }, now);
  if (route.status !== "reserved") throw new Error("Synthetic route reservation failed");
  const storedRoute = await transferRouteUploadAsParticipant(db, { ...participant, uploadId: route.response.uploadId, readBody: () => bytes(gpx) }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now);
  expect(storedRoute.status).toBe("stored");
  const secondGrantId = randomUUID(), secondSecret = Buffer.alloc(32, 6);
  const secondGrant = await issueRouteUploadGrantAsAdmin(db, { ...auth, idempotencyKey: `route-upload-grant:${randomUUID()}`, request: { formatVersion: 1, grantId: secondGrantId, entryId: secondEntryId, secretHash: createHash("sha256").update(secondSecret).digest("hex"), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
  if (secondGrant.status !== "issued") throw new Error("Synthetic second route grant failed");
  const secondRedeemed = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${secondGrantId}.${secondSecret.toString("base64url")}`, now);
  if (secondRedeemed.status !== "redeemed") throw new Error("Synthetic second route redeem failed");
  const secondParticipant = { sessionToken: secondRedeemed.sessionToken, csrfCookie: secondRedeemed.csrfToken, csrfHeader: secondRedeemed.csrfToken };
  const secondRoute = await reserveRouteUploadAsParticipant(db, { ...secondParticipant, idempotencyKey: `route-upload:${randomUUID()}`, request: { formatVersion: 1, fileName: "bea.gpx", mediaType: "application/gpx+xml", byteLength: gpxSecond.byteLength, sha256: gpxSecondHash } }, now);
  if (secondRoute.status !== "reserved") throw new Error("Synthetic second route reservation failed");
  expect((await transferRouteUploadAsParticipant(db, { ...secondParticipant, uploadId: secondRoute.response.uploadId, readBody: () => bytes(gpxSecond) }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now)).status).toBe("stored");
  const thirdGrantId = randomUUID(), thirdSecret = Buffer.alloc(32, 7);
  const thirdGrant = await issueRouteUploadGrantAsAdmin(db, { ...auth, idempotencyKey: `route-upload-grant:${randomUUID()}`, request: { formatVersion: 1, grantId: thirdGrantId, entryId: thirdEntryId, secretHash: createHash("sha256").update(thirdSecret).digest("hex"), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
  if (thirdGrant.status !== "issued") throw new Error("Synthetic third route grant failed");
  const thirdRedeemed = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${thirdGrantId}.${thirdSecret.toString("base64url")}`, now);
  if (thirdRedeemed.status !== "redeemed") throw new Error("Synthetic third route redeem failed");
  const thirdParticipant = { sessionToken: thirdRedeemed.sessionToken, csrfCookie: thirdRedeemed.csrfToken, csrfHeader: thirdRedeemed.csrfToken };
  const thirdRoute = await reserveRouteUploadAsParticipant(db, { ...thirdParticipant, idempotencyKey: `route-upload:${randomUUID()}`, request: { formatVersion: 1, fileName: "cy.gpx", mediaType: "application/gpx+xml", byteLength: gpxThird.byteLength, sha256: gpxThirdHash } }, now);
  if (thirdRoute.status !== "reserved") throw new Error("Synthetic third route reservation failed");
  expect((await transferRouteUploadAsParticipant(db, { ...thirdParticipant, uploadId: thirdRoute.response.uploadId, readBody: () => bytes(gpxThird) }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now)).status).toBe("stored");
  const payload = { cardNumber, startPunchedAt: "2026-09-21T10:00:00Z", finishPunchedAt: "2026-09-21T10:20:00Z", punches: [{ code: 31, punchedAt: "2026-09-21T10:10:00Z" }] };
  const deviceId = randomUUID();
  await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-21T10:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const secondPayload = { ...payload, cardNumber: secondCardNumber, finishPunchedAt: "2026-09-21T10:22:00Z" };
  const secondDeviceId = randomUUID();
  await ingestDeviceBatch(db, raceId, { deviceId: secondDeviceId, sessionId: secondDeviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-21T10:23:00Z", transport: "simulator", payload: secondPayload, contentHash: contentHash(secondPayload) }] });
  const thirdPayload = { ...payload, cardNumber: thirdCardNumber, finishPunchedAt: "2026-09-21T10:24:00Z" };
  const thirdDeviceId = randomUUID();
  await ingestDeviceBatch(db, raceId, { deviceId: thirdDeviceId, sessionId: thirdDeviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-21T10:25:00Z", transport: "simulator", payload: thirdPayload, contentHash: contentHash(thirdPayload) }] });
  await pool.query("UPDATE class SET course_version_id=$2 WHERE id=$1", [classId, currentCourseVersionId]);
  const publicResultId = (await pool.query<{ public_result_id: string }>("SELECT public_result_id FROM entry WHERE id=$1", [entryId])).rows[0]?.public_result_id;
  const secondPublicResultId = (await pool.query<{ public_result_id: string }>("SELECT public_result_id FROM entry WHERE id=$1", [secondEntryId])).rows[0]?.public_result_id;
  const thirdPublicResultId = (await pool.query<{ public_result_id: string }>("SELECT public_result_id FROM entry WHERE id=$1", [thirdEntryId])).rows[0]?.public_result_id;
  if (!publicResultId || !secondPublicResultId || !thirdPublicResultId) throw new Error("Synthetic public result identity missing");

  const beforeConsent = await releasePublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: `route-publication-release:${randomUUID()}`, request: { formatVersion: 1, routeUploadId: route.response.uploadId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, expectedPublicationRevision: 0 } }, now);
  expect(beforeConsent.status).toBe("conflict");
  const consent = await decideRoutePublicationConsentAsParticipant(db, { ...participant, idempotencyKey: `route-publication-consent:${randomUUID()}`, request: { formatVersion: 1, decision: "GRANT" } }, now);
  expect(consent.status).toBe("stored");
  expect((await decideRoutePublicationConsentAsParticipant(db, { ...secondParticipant, idempotencyKey: `route-publication-consent:${randomUUID()}`, request: { formatVersion: 1, decision: "GRANT" } }, now)).status).toBe("stored");
  expect((await decideRoutePublicationConsentAsParticipant(db, { ...thirdParticipant, idempotencyKey: `route-publication-consent:${randomUUID()}`, request: { formatVersion: 1, decision: "GRANT" } }, now)).status).toBe("stored");
  const mismatchedRelease = await releasePublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: `route-publication-release:${randomUUID()}`, request: { formatVersion: 1, routeUploadId: route.response.uploadId, mapManifestId: map.response.uploadId, georeferenceId: laterGeoreference.response.georeferenceId, expectedPublicationRevision: 0 } }, now);
  expect(mismatchedRelease).toMatchObject({ status: "released", response: { revision: 1, action: "RELEASE" } });
  expect(await readPublicParticipantRoute(db, raceId, publicResultId)).toEqual({ status: "not-found" });
  if (mismatchedRelease.status !== "released") throw new Error("Synthetic mismatched release failed");
  const mismatchedWithdrawal = await withdrawPublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: `route-publication-withdraw:${randomUUID()}`, request: { formatVersion: 1, publicationId: mismatchedRelease.response.publicationId, expectedPublicationRevision: 1 } }, now);
  expect(mismatchedWithdrawal).toMatchObject({ status: "withdrawn", response: { revision: 2 } });
  const releaseKey = `route-publication-release:${randomUUID()}`;
  const releaseRequest = { formatVersion: 1 as const, routeUploadId: route.response.uploadId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, expectedPublicationRevision: 2 };
  const released = await releasePublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: releaseKey, request: releaseRequest }, now);
  expect(released).toMatchObject({ status: "released", response: { revision: 3, action: "RELEASE", routeUploadId: route.response.uploadId } });
  expect(await releasePublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: releaseKey, request: releaseRequest }, now)).toMatchObject({ status: "released", response: { replayed: true, revision: 3 } });
  const secondReleased = await releasePublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: `route-publication-release:${randomUUID()}`, request: { formatVersion: 1, routeUploadId: secondRoute.response.uploadId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, expectedPublicationRevision: 0 } }, now);
  expect(secondReleased).toMatchObject({ status: "released", response: { revision: 1, action: "RELEASE" } });
  const thirdReleased = await releasePublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: `route-publication-release:${randomUUID()}`, request: { formatVersion: 1, routeUploadId: thirdRoute.response.uploadId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId, expectedPublicationRevision: 0 } }, now);
  expect(thirdReleased).toMatchObject({ status: "released", response: { revision: 1, action: "RELEASE" } });
  if (released.status === "released") {
    const publicRoute = await readPublicParticipantRoute(db, raceId, publicResultId);
    expect(publicRoute).toMatchObject({ status: "ok", response: { formatVersion: 2, imageWidth: 1001, imageHeight: 501, notice: "ROUTE_NOT_GPS_VERIFIED", metadata: { pointCount: 2, segmentCount: 1, timing: { status: "AVAILABLE", durationMilliseconds: 60_000 } }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] } } });
    if (publicRoute.status === "ok") {
      const first = publicRoute.response.points[0];
      expect(first?.segment).toBe(0);
      expect(first?.x).toBeCloseTo(100, 6);
      expect(first?.y).toBeCloseTo(333.333333, 6);
      expect(publicRoute.response.controls).toEqual([{ sequence: 1, controlCode: 31, x: 100, y: 200 }]);
      expect(JSON.stringify(publicRoute.response)).not.toContain(courseVersionId);
      expect(JSON.stringify(publicRoute.response)).not.toContain(courseControlId);
      expect(JSON.stringify(publicRoute.response)).not.toContain(pngHash);
      expect(JSON.stringify(publicRoute.response.playback)).not.toMatch(/latitude|longitude|startedAt|finishedAt|entryId|uploadId|publicationId|hash/i);
    }
    const comparison = await readPublicParticipantRouteComparison(db, raceId, publicResultId, secondPublicResultId);
    expect(comparison).toMatchObject({ status: "ok", response: { formatVersion: 2, imageWidth: 1001, imageHeight: 501, notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED", controls: [{ sequence: 1, controlCode: 31, x: 100, y: 200 }], routes: [{ participant: { givenName: "Ada", familyName: "Route" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 }] }, metadata: { pointCount: 2 }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] } }, { participant: { givenName: "Bea", familyName: "Route" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 }] }, metadata: { pointCount: 2 }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 90_000] } }] } });
    if (comparison.status === "ok") {
      expect(comparison.response.routes[0].points[0]?.x).toBeCloseTo(100, 6);
      expect(comparison.response.routes[1].points[1]?.x).toBeCloseTo(300, 6);
      expect(JSON.stringify(comparison.response)).not.toContain(entryId);
      expect(JSON.stringify(comparison.response)).not.toContain(secondEntryId);
      expect(JSON.stringify(comparison.response)).not.toContain(courseVersionId);
      expect(JSON.stringify(comparison.response)).not.toContain(pngHash);
      expect(JSON.stringify(comparison.response)).not.toContain("organisationName");
      expect(JSON.stringify(comparison.response)).not.toContain("timeBehind");
      expect(JSON.stringify(comparison.response)).not.toContain("position");
      expect(JSON.stringify(comparison.response)).not.toContain("startTime");
      expect(JSON.stringify(comparison.response.routes.map((route) => route.playback))).not.toMatch(/latitude|longitude|startedAt|finishedAt|entryId|uploadId|publicationId|hash/i);
    }
    const tripleComparison = await readPublicParticipantRouteComparison(db, raceId, publicResultId, secondPublicResultId, thirdPublicResultId);
    expect(tripleComparison).toMatchObject({ status: "ok", response: { formatVersion: 3, imageWidth: 1001, imageHeight: 501, controls: [{ sequence: 1, controlCode: 31, x: 100, y: 200 }], routes: [{ participant: { givenName: "Ada", familyName: "Route" } }, { participant: { givenName: "Bea", familyName: "Route" } }, { participant: { givenName: "Cy", familyName: "Route" }, metadata: { pointCount: 2 }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 120_000] } }] } });
    if (tripleComparison.status === "ok") {
      expect(JSON.stringify(tripleComparison.response)).not.toContain(entryId);
      expect(JSON.stringify(tripleComparison.response)).not.toContain(secondEntryId);
      expect(JSON.stringify(tripleComparison.response)).not.toContain(thirdEntryId);
      expect(JSON.stringify(tripleComparison.response)).not.toMatch(/latitude|longitude|uploadId|publicationId|sourceHash|courseVersionId/i);
    }
    expect(await readPublicParticipantRouteComparison(db, raceId, publicResultId, publicResultId)).toEqual({ status: "not-found" });
    expect(await readPublicParticipantRouteComparison(db, raceId, publicResultId, secondPublicResultId, secondPublicResultId)).toEqual({ status: "not-found" });
    expect(await readPublicParticipantRoutePublicationStateAsAdmin(db, { ...auth, routeUploadId: route.response.uploadId }, now)).toMatchObject({ status: "ok", response: { routeUploadId: route.response.uploadId, latestPublicationRevision: 3, activePublication: { publicationId: released.response.publicationId, revision: 3 } } });
    const withdrawKey = `route-publication-withdraw:${randomUUID()}`;
    const withdrawRequest = { formatVersion: 1 as const, publicationId: released.response.publicationId, expectedPublicationRevision: 3 };
    const withdrawn = await withdrawPublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: withdrawKey, request: withdrawRequest }, now);
    expect(withdrawn).toMatchObject({ status: "withdrawn", response: { revision: 4, action: "WITHDRAW" } });
    expect(await withdrawPublicParticipantRouteAsAdmin(db, { ...auth, idempotencyKey: withdrawKey, request: withdrawRequest }, now)).toMatchObject({ status: "withdrawn", response: { replayed: true, revision: 4 } });
    expect(await readPublicParticipantRoutePublicationStateAsAdmin(db, { ...auth, routeUploadId: route.response.uploadId }, now)).toMatchObject({ status: "ok", response: { latestPublicationRevision: 4, activePublication: null } });
    expect(await readPublicParticipantRoute(db, raceId, publicResultId)).toEqual({ status: "not-found" });
    expect(await readPublicParticipantRouteComparison(db, raceId, publicResultId, secondPublicResultId)).toEqual({ status: "not-found" });
  }

  const privateCandidates = await listPrivateRoutePreviewCandidatesAsAdmin(db, auth, now);
  expect(privateCandidates).toMatchObject({ status: "ok", response: { raceId } });
  if (privateCandidates.status === "ok") expect(privateCandidates.response.routes.some((candidate) => candidate.routeUploadId === route.response.uploadId && candidate.displayName === "Ada Route" && candidate.pointCount === 2)).toBe(true);
  const query = { routeUploadId: route.response.uploadId, mapManifestId: map.response.uploadId, georeferenceId: georeference.response.georeferenceId };
  const preview = await readPrivateRoutePreviewAsAdmin(db, { ...auth, query }, now);
  expect(preview).toMatchObject({ status: "ok", response: { raceId, imageWidth: 1001, imageHeight: 501, mapSourceHash: pngHash, points: [{ segment: 0 }, { segment: 0 }] } });
  if (preview.status === "ok") {
    expect(preview.response.points[0]?.x).toBeCloseTo(100, 6);
    expect(preview.response.points[0]?.y).toBeCloseTo(333.333333, 6);
    expect(preview.response.points[1]?.x).toBeCloseTo(200, 6);
    expect(preview.response.points[1]?.y).toBeCloseTo(166.666667, 6);
    expect(JSON.stringify(preview.response)).not.toContain("18.071");
  }
  expect(await resolvePrivateRoutePreviewMapAsAdmin(db, { ...auth, query }, now)).toMatchObject({ status: "ok", response: { uploadId: map.response.uploadId, sha256: pngHash, versionId: "synthetic-v1" } });
  expect((await readPrivateRoutePreviewAsAdmin(db, { ...auth, query: { ...query, georeferenceId: randomUUID() } }, now)).status).toBe("not-found");
  expect((await readPrivateRoutePreviewAsAdmin(db, { ...auth, query }, new Date(now.getTime() + 7_200_000))).status).toBe("unauthorized");
});
