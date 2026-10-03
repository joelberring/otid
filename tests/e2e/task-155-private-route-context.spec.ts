import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  bindPrivateRouteContextAsAdmin,
  contentHash,
  createCourseControlGeometryAsAdmin,
  createMapGeoreferenceAsAdmin,
  ingestDeviceBatch,
  issuePairingAdminAccessCredential,
  issueParticipantEntryClaimAsAdmin,
  issueRouteUploadGrantAsAdmin,
  loginPairingAdmin,
  loginUserAccount,
  redeemParticipantEntryClaimAsAccount,
  redeemRouteUploadBearerLink,
  reserveMapAssetAsAdmin,
  reserveRouteUploadAsParticipant,
  routeUploadBearerTokenPrefix,
  transferMapAssetAsAdmin,
  transferRouteUploadAsParticipant
} from "@o-tid/application";
import { createDatabase, schema } from "@o-tid/database";

type Account = { accountId: string; loginName: string; password: string };
type Fixture = { owner: Account; other: Account };
const origin = "http://127.0.0.1:3155";
const sourceUrl = process.env.OTID_TASK155_SOURCE_DATABASE_URL;
const targetUrl = process.env.OTID_TASK155_DATABASE_URL;
const privateDirectory = process.env.OTID_TASK155_PRIVATE_DIRECTORY;
if (!sourceUrl || sourceUrl !== process.env.TEST_DATABASE_URL || !targetUrl || !privateDirectory) {
  throw new Error("TASK155 synthetic browser database configuration rejected");
}
const source = new URL(sourceUrl), target = new URL(targetUrl);
const sourceName = source.pathname.slice(1), targetName = target.pathname.slice(1);
if (!( ["postgres:", "postgresql:"].includes(source.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
  && /^otid_task150_synthetic_[a-z0-9][a-z0-9_-]{0,40}$/.test(sourceName)
  && !/(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)
  && target.protocol === source.protocol && target.host === source.host && target.username === source.username
  && target.password === source.password && target.pathname === `/${targetName}`
  && /^otid_task155_browser_[a-f0-9]{32}$/.test(targetName) && targetName !== sourceName
  && dirname(privateDirectory) === realpathSync(tmpdir())
  && /^otid-task155-private-route-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory)))) {
  throw new Error("TASK155 accepts only its explicit loopback synthetic database");
}
const { db, pool } = createDatabase(targetUrl);
const now = new Date();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vZ8AAAAASUVORK5CYII=", "base64");
const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="synthetic"><trk><trkseg><trkpt lat="59.321" lon="18.071"><time>2026-09-23T10:00:00Z</time></trkpt><trkpt lat="59.322" lon="18.072"><time>2026-09-23T10:20:00Z</time></trkpt></trkseg></trk></gpx>');
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
async function* bytes(value: Buffer): AsyncIterable<Uint8Array> { yield value; }

test.afterAll(async () => {
  const runId = targetName.slice("otid_task155_browser_".length);
  try { await fetch(`${origin}/__task150/shutdown/${runId}`, { method: "POST", signal: AbortSignal.timeout(5_000) }); }
  catch { /* The fixture server may already have shut down. */ }
  await pool.end();
  const { pool: adminPool } = createDatabase(sourceUrl);
  try {
    let dropped = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const sessions = await adminPool.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1", [targetName]);
      if (sessions.rows[0]?.count === "0") {
        await adminPool.query(`DROP DATABASE IF EXISTS "${targetName}"`);
        dropped = true;
        break;
      }
      await delay(100);
    }
    if (!dropped) await adminPool.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);
  } finally { await adminPool.end(); }
  await rm(privateDirectory, { recursive: true, force: true });
});

async function fixture(): Promise<Fixture> {
  const path = process.env.OTID_TASK155_CREDENTIALS_FILE;
  if (!path || !path.startsWith(`${privateDirectory}/`)) throw new Error("TASK155 private account fixture missing");
  return JSON.parse(await readFile(path, "utf8")) as Fixture;
}

async function loginAccount(page: Page, account: Account): Promise<void> {
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Mina resultat", exact: true })).toBeVisible();
  await page.getByLabel("Användarnamn", { exact: true }).fill(account.loginName);
  await page.getByLabel("Lösenord", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByText(/^Inloggad som /)).toBeVisible();
}

async function hasNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function seedContext(accounts: Fixture): Promise<string> {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID(), courseControlId = randomUUID();
  const timestamp = new Date("2026-09-23T10:00:00.000Z");
  await db.insert(schema.events).values({ id: eventId, name: "TASK155 synthetic", startsOn: "2026-09-23", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "TASK155 synthetic", raceDate: "2026-09-23" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic course" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ id: courseControlId, courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Synthetic class", startRule: "FIXED" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Test", familyName: "TASK155-löpare", fixedStartTime: timestamp });
  const cardNumber = `155${entryId.slice(0, 8)}`;
  await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber });

  const adminCredential = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK155 browser", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const adminLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: adminCredential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (adminLogin.status !== "authenticated") throw new Error("TASK155 synthetic administrator authentication failed");
  const adminProof = { raceId, sessionToken: adminLogin.sessionToken, csrfCookie: adminLogin.csrfToken, csrfHeader: adminLogin.csrfToken };

  const participantLogin = await loginUserAccount(db, { formatVersion: 1, loginName: accounts.other.loginName, password: accounts.other.password }, { now });
  if (participantLogin.status !== "authenticated") throw new Error("TASK155 synthetic participant authentication failed");
  const participant = { sessionToken: participantLogin.sessionToken, csrfCookie: participantLogin.csrfToken, csrfHeader: participantLogin.csrfToken };
  const claimSecret = randomBytes(16), claimRequestId = randomUUID();
  const claim = await issueParticipantEntryClaimAsAdmin(db, { ...adminProof, entryId, idempotencyKey: `participant-claim-issue:${claimRequestId}`,
    request: { formatVersion: 1, requestId: claimRequestId, raceId, entryId,
      secretHash: sha256(claimSecret), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attestation: "IDENTITY_CHECKED" } }, now);
  if (claim.status !== "issued") throw new Error("TASK155 synthetic participant claim failed");
  const redemptionId = randomUUID();
  const redeemed = await redeemParticipantEntryClaimAsAccount(db, { ...participant, idempotencyKey: `participant-claim-redeem:${redemptionId}`,
    request: { formatVersion: 1, requestId: redemptionId, code: claimSecret.toString("base64url") } }, now);
  if (redeemed.status !== "redeemed") throw new Error("TASK155 synthetic participant claim redemption failed");

  const map = await reserveMapAssetAsAdmin(db, { ...adminProof, idempotencyKey: `map-upload:${randomUUID()}`,
    request: { formatVersion: 1, title: "Synthetic private map", mediaType: "image/png", byteLength: png.byteLength, sha256: sha256(png) } }, now);
  if (map.status !== "reserved") throw new Error("TASK155 synthetic map reservation failed");
  const storedMap = await transferMapAssetAsAdmin(db, { ...adminProof, uploadId: map.response.uploadId, readBody: () => bytes(png) }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `map/${input.raceId}/${input.attemptId}`, versionId: "synthetic-map-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now);
  if (storedMap.status !== "stored") throw new Error("TASK155 synthetic map storage fixture failed");
  const georeference = await createMapGeoreferenceAsAdmin(db, { ...adminProof, idempotencyKey: `map-georeference:${randomUUID()}`,
    request: { formatVersion: 1, manifestId: map.response.uploadId, expectedGeoreferenceRevision: 0, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326", tiePoints: [
      { pixelX: 0, pixelY: 0, longitude: 18.07, latitude: 59.323 },
      { pixelX: 1000, pixelY: 0, longitude: 18.08, latitude: 59.323 },
      { pixelX: 0, pixelY: 500, longitude: 18.07, latitude: 59.32 }
    ] } }, now);
  if (georeference.status !== "created") throw new Error("TASK155 synthetic georeference fixture failed");
  const geometry = await createCourseControlGeometryAsAdmin(db, { ...adminProof, idempotencyKey: `course-control-geometry:${randomUUID()}`,
    request: { formatVersion: 1, courseVersionId, mapManifestId: map.response.uploadId,
      georeferenceId: georeference.response.georeferenceId, expectedGeometryRevision: 0,
      points: [{ courseControlId, pixelX: 100, pixelY: 200 }] } }, now);
  if (geometry.status !== "created") throw new Error("TASK155 synthetic course geometry fixture failed");

  const grantId = randomUUID(), grantSecret = randomBytes(32);
  const grant = await issueRouteUploadGrantAsAdmin(db, { ...adminProof, idempotencyKey: `route-upload-grant:${randomUUID()}`,
    request: { formatVersion: 1, grantId, entryId, secretHash: sha256(grantSecret), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
  if (grant.status !== "issued") throw new Error("TASK155 synthetic route grant failed");
  const uploadSession = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${grantId}.${grantSecret.toString("base64url")}`, now);
  if (uploadSession.status !== "redeemed") throw new Error("TASK155 synthetic route session failed");
  const routeParticipant = { sessionToken: uploadSession.sessionToken, csrfCookie: uploadSession.csrfToken, csrfHeader: uploadSession.csrfToken };
  const route = await reserveRouteUploadAsParticipant(db, { ...routeParticipant, idempotencyKey: `route-upload:${randomUUID()}`,
    request: { formatVersion: 1, fileName: "synthetic.gpx", mediaType: "application/gpx+xml", byteLength: gpx.byteLength, sha256: sha256(gpx) } }, now);
  if (route.status !== "reserved") throw new Error("TASK155 synthetic route reservation failed");
  const storedRoute = await transferRouteUploadAsParticipant(db, { ...routeParticipant, uploadId: route.response.uploadId, readBody: () => bytes(gpx) }, { async put(input) {
    return { formatVersion: 1, storeId: randomUUID(), key: `route/${input.raceId}/${input.attemptId}`, versionId: "synthetic-route-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
  } }, () => now);
  if (storedRoute.status !== "stored") throw new Error("TASK155 synthetic route storage fixture failed");

  const payload = { cardNumber, startPunchedAt: "2026-09-23T10:00:00Z", finishPunchedAt: "2026-09-23T10:20:00Z", punches: [{ code: 31, punchedAt: "2026-09-23T10:10:00Z" }] };
  const deviceId = randomUUID();
  const ingestion = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-23T10:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  if (ingestion.acknowledgements[0]?.status !== "stored") throw new Error("TASK155 synthetic published result fixture failed");

  const bound = await bindPrivateRouteContextAsAdmin(db, { ...adminProof, idempotencyKey: `private-route-context-bind:${randomUUID()}`,
    request: { formatVersion: 1, routeUploadId: route.response.uploadId, mapManifestId: map.response.uploadId,
      georeferenceId: georeference.response.georeferenceId, geometryRevisionId: geometry.response.geometryRevisionId,
      expectedContextRevision: 0 } }, now);
  if (bound.status !== "bound") throw new Error("TASK155 synthetic private route context bind failed");
  return route.response.uploadId;
}

test("TASK155: claimed participant sees a synthetic private pixel map; other and anonymous accounts are denied", async ({ browser }) => {
  const accounts = await fixture();
  const routeUploadId = await seedContext(accounts);
  const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  await loginAccount(ownerPage, accounts.other);
  let syntheticMapRequests = 0;
  const mapPath = `/api/participant/me/routes/${routeUploadId}/map?contextRevision=1`;
  // Simulate only map bytes; overlay JSON, its account checks and denial responses use the real Next/PostgreSQL path.
  await ownerPage.route(url => url.pathname === `/api/participant/me/routes/${routeUploadId}/map` && url.search === "?contextRevision=1", async route => {
    syntheticMapRequests += 1;
    await route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "private, no-store" }, body: png });
  });
  await ownerPage.goto(`/me/routes/${routeUploadId}`);
  await expect(ownerPage.getByRole("heading", { name: "Privat GPX-version", exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("heading", { name: "Delning av den här versionen", exact: true })).toBeVisible();
  await expect(ownerPage.getByText("Nej, den här versionen är privat", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText("Inte tillgänglig just nu", { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("link", { name: "Visa offentlig rutt" })).toHaveCount(0);
  const map = ownerPage.getByRole("img", { name: "Privat karta och GPS-spår", exact: true });
  await expect(map).toBeVisible();
  await expect(map.locator("image")).toHaveAttribute("href", mapPath);
  await expect(ownerPage.locator(".participant-private-route-map svg path")).toHaveAttribute("d", /^M/);
  await expect(ownerPage.locator(".participant-private-route-map svg g circle")).toHaveCount(1);
  const resultSplits = ownerPage.locator(".participant-private-route-result-splits");
  await expect(resultSplits.locator("summary")).toHaveText("Resultatets publicerade sträcktider");
  await resultSplits.locator("summary").click();
  await expect(resultSplits.getByText("Publicerade resultat kan vara preliminära och kan ändras.", { exact: true })).toBeVisible();
  await expect(resultSplits.getByText("Tiderna kommer från resultatet. GPS-markören visar inte verifierade kontrollpassager.", { exact: true })).toBeVisible();
  await expect(resultSplits.getByText("Resultatrevision 1", { exact: true })).toBeVisible();
  await expect(resultSplits.locator("li")).toHaveCount(1);
  await expect(resultSplits.locator("li")).toContainText("Kontroll 31");
  await expect(resultSplits.locator("li")).toContainText("Sträcktid 10:00");
  const playbackMarker = ownerPage.locator(".participant-private-route-playback-marker");
  await expect(playbackMarker).toHaveCount(1);
  await expect(ownerPage.getByRole("region", { name: "Uppspelning" })).toBeVisible();
  const startX = Number(await playbackMarker.getAttribute("cx"));
  const alignment = ownerPage.getByTestId("private-route-start-alignment");
  await expect(alignment).toContainText("Jämför med resultatets start");
  await expect(alignment).toContainText("GPX-klocka");
  await expect(alignment).toContainText("Resultatets starttid");
  await expect(alignment).toContainText("Det här är en visuell tidsjämförelse, inte en GPS-verifierad start eller kontrollpassage.");
  const controlTimeSelect = ownerPage.getByTestId("private-route-control-time-select");
  const controlTimeJump = ownerPage.getByTestId("private-route-control-time-jump");
  await expect(controlTimeSelect).toBeVisible();
  await expect(controlTimeJump).toBeDisabled();
  await expect(ownerPage.getByText("Visar motsvarande tidpunkt enligt resultatets ackumulerade kontrolltid. GPS-markören visar inte en verifierad kontrollpassage.", { exact: true })).toBeVisible();
  await controlTimeSelect.selectOption("31:1");
  await expect(controlTimeSelect).toHaveValue("31:1");
  const offset = ownerPage.getByTestId("private-route-start-offset");
  await expect(offset).toHaveValue("0");
  await offset.fill("-60");
  await ownerPage.getByTestId("private-route-start-jump").click();
  await expect.poll(async () => Number(await playbackMarker.getAttribute("cx"))).toBeGreaterThan(startX);
  await offset.fill("60");
  await expect(ownerPage.getByTestId("private-route-start-alignment-status")).toHaveText(
    "Resultatstarten ligger utanför GPX-spårets tidsserie med den valda förskjutningen.");
  await expect(ownerPage.getByTestId("private-route-start-jump")).toBeDisabled();
  await expect(controlTimeJump).toBeEnabled();
  await controlTimeJump.click();
  await expect(ownerPage.getByLabel("Tid i GPX-spåret", { exact: true })).toHaveValue("540000");
  await offset.fill("-900");
  await expect(ownerPage.getByTestId("private-route-control-time-status")).toHaveText(
    "Den valda kontrolltiden ligger utanför GPX-spårets tidsserie med den valda förskjutningen.");
  await expect(controlTimeJump).toBeDisabled();
  await ownerPage.getByTestId("private-route-start-reset").click();
  await expect(offset).toHaveValue("0");
  await expect(controlTimeJump).toBeEnabled();
  await controlTimeJump.click();
  await expect(ownerPage.getByLabel("Tid i GPX-spåret", { exact: true })).toHaveValue("600000");
  await ownerPage.getByRole("button", { name: "Börja om", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Spela upp", exact: true }).click();
  await expect(ownerPage.getByRole("button", { name: "Pausa", exact: true })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Pausa", exact: true }).click();
  await ownerPage.getByLabel("Tid i GPX-spåret", { exact: true }).press("End");
  await expect.poll(async () => Number(await playbackMarker.getAttribute("cx"))).toBeGreaterThan(startX);
  await expect(ownerPage.getByText("Arrangörsvald versionskoppling. Kartprecisionen är inte fältverifierad.", { exact: true })).toBeVisible();
  expect(syntheticMapRequests).toBe(1);
  const ownerOverlay = await ownerPage.evaluate(async routeId => {
    const response = await fetch(`/api/participant/me/routes/${routeId}/overlay`, { cache: "no-store" });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.text() };
  }, routeUploadId);
  expect(ownerOverlay.status).toBe(200);
  expect(ownerOverlay.cache).toContain("no-store");
  expect(ownerOverlay.body).not.toMatch(/latitude|longitude|courseVersionId|geometryRevisionId|sourceResultRevisionId/i);
  const realOverlay = JSON.parse(ownerOverlay.body) as {
    formatVersion: number;
    points: Array<{ x: number; y: number; segment: number }>;
    metadata: Record<string, unknown>;
    playback: { status: string; pointElapsedMilliseconds?: number[] };
    resultSplits: { status: string; resultRevision?: number; splits?: Array<{ controlCode: number; occurrence: number; legMs: number; elapsedMs: number }> };
    resultStart: { status: string; resultRevision?: number; startedAt?: string };
  };
  expect(realOverlay.formatVersion).toBe(4);
  expect(realOverlay.playback).toEqual({ status: "AVAILABLE", pointElapsedMilliseconds: [0, 1_200_000] });
  expect(realOverlay.resultStart).toEqual({ status: "AVAILABLE", resultRevision: 1, startedAt: "2026-09-23T10:00:00.000Z" });
  expect(realOverlay.resultSplits).toEqual({ status: "AVAILABLE", resultRevision: 1,
    splits: [{ controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 }] });
  const overlayPath = `**/api/participant/me/routes/${routeUploadId}/overlay`;
  await ownerPage.route(overlayPath, async route => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ ...realOverlay,
      metadata: { ...realOverlay.metadata, timing: { status: "UNAVAILABLE" } },
      playback: { status: "UNAVAILABLE" } }) }));
  await ownerPage.reload();
  await expect(ownerPage.getByText("Uppspelning saknas eftersom GPX-tiderna inte är kompletta och sammanhängande.", { exact: true })).toBeVisible();
  await expect(ownerPage.getByTestId("private-route-start-alignment-status")).toHaveText(
    "GPX-klockan saknas. Tidsjämförelsen är inte tillgänglig.");
  await expect(ownerPage.getByTestId("private-route-start-offset")).toBeDisabled();
  await expect(ownerPage.getByTestId("private-route-control-time-select")).toBeDisabled();
  await expect(ownerPage.getByTestId("private-route-control-time-status")).toHaveText(
    "Kontrolltiden kan inte visas eftersom GPX-tid eller uppspelning saknas.");
  await expect(ownerPage.getByRole("region", { name: "Uppspelning" })).toHaveCount(0);
  await expect(ownerPage.getByRole("img", { name: "Privat karta och GPS-spår", exact: true })).toBeVisible();
  await ownerPage.unroute(overlayPath);
  // UI-only segment-gap case: the elapsed result time remains valid, but no GPS position may be interpolated across segments.
  await ownerPage.route(overlayPath, async route => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ ...realOverlay,
      points: [{ ...realOverlay.points[0], segment: 0 }, { ...realOverlay.points[1], segment: 1 }],
      metadata: { ...realOverlay.metadata, segmentCount: 2 } }) }));
  await ownerPage.reload();
  const gapSelect = ownerPage.getByTestId("private-route-control-time-select");
  await gapSelect.selectOption("31:1");
  await expect(ownerPage.getByTestId("private-route-control-time-status")).toHaveText(
    "Ingen GPX-position kan visas vid den här tidpunkten. Spåravbrott interpoleras inte.");
  await expect(ownerPage.getByTestId("private-route-control-time-jump")).toBeEnabled();
  await ownerPage.getByTestId("private-route-control-time-jump").click();
  await expect(ownerPage.getByLabel("Tid i GPX-spåret", { exact: true })).toHaveValue("600000");
  await expect(ownerPage.locator(".participant-private-route-playback-marker")).toHaveCount(0);
  await ownerPage.unroute(overlayPath);
  const privateDetailResponse = await ownerPage.request.get(`/api/participant/me/routes/${routeUploadId}`);
  expect(privateDetailResponse.status()).toBe(200);
  const privateDetail = await privateDetailResponse.json() as Record<string, unknown>;
  const syntheticPublicResultId = randomUUID();
  // UI-only conditional-link check: the real public eligibility transition is exercised in PostgreSQL.
  await ownerPage.route(url => url.pathname === `/api/participant/me/routes/${routeUploadId}`, async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...privateDetail,
      sharing: { consent: "GRANTED", adminRelease: "ACTIVE",
        publicRoute: { status: "AVAILABLE", publicResultId: syntheticPublicResultId } } }) });
  });
  await ownerPage.reload();
  await expect(ownerPage.getByText("Ja, för den här GPX-versionen", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText("Aktivt för den här versionen och kartan", { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("link", { name: "Visa offentlig rutt" })).toHaveAttribute("href",
    `/results/${(privateDetail as { raceId: string }).raceId}/participants/${syntheticPublicResultId}/route`);
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const otherContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const otherPage = await otherContext.newPage();
  await loginAccount(otherPage, accounts.owner);
  const otherResponses = await otherPage.evaluate(async ({ routeId, mapUrl }) => {
    const paths = [`/api/participant/me/routes/${routeId}/overlay`, mapUrl];
    const results = await Promise.all(paths.map(async path => {
      const response = await fetch(path, { cache: "no-store" });
      return { status: response.status, body: await response.text() };
    }));
    return results;
  }, { routeId: routeUploadId, mapUrl: mapPath });
  for (const response of otherResponses) {
    expect([401, 404]).toContain(response.status);
    expect(response.body).not.toContain("TASK155-löpare");
  }

  const anonymousContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto("/me");
  const anonymousResponses = await anonymousPage.evaluate(async ({ routeId, mapUrl }) => {
    const paths = [`/api/participant/me/routes/${routeId}/overlay`, mapUrl];
    return Promise.all(paths.map(async path => {
      const response = await fetch(path, { cache: "no-store" });
      return { status: response.status, body: await response.text() };
    }));
  }, { routeId: routeUploadId, mapUrl: mapPath });
  for (const response of anonymousResponses) {
    expect([401, 404]).toContain(response.status);
    expect(response.body).not.toContain("TASK155-löpare");
  }
  await hasNoHorizontalOverflow(otherPage);
  await hasNoHorizontalOverflow(anonymousPage);
  await anonymousContext.close();
  await otherContext.close();
  await ownerContext.close();
});
