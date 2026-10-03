import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  contentHash,
  createEvent,
  importIofXml,
  ingestDeviceBatch,
  issuePairingAdminAccessCredential,
  loginPairingAdmin,
  publishMapAssetAsAdmin,
  reserveMapAssetAsAdmin,
  transferMapAssetAsAdmin
} from "@o-tid/application";
import { createDatabase, schema } from "@o-tid/database";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) {
  throw new Error("Explicit matching isolated database required");
}
const { db, pool } = createDatabase(database);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const sha256 = createHash("sha256").update(png).digest("hex");

test.afterAll(async () => pool.end());

async function createPublishedMap() {
  const eventId = randomUUID(), raceId = randomUUID();
  const now = new Date("2026-09-20T19:00:00.000Z");
  await db.insert(schema.events).values({ id: eventId, name: "Syntetiskt kartsläpp", startsOn: "2026-09-20", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Långdistans", raceDate: "2026-09-20" });
  const credential = await issuePairingAdminAccessCredential(db, {
    raceId, capability: "MANAGE_RACE", label: "TASK106 browser", expiresAt: new Date(now.getTime() + 3_600_000)
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, {
    expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now
  });
  if (login.status !== "authenticated") throw new Error("Synthetic map administrator login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const uploadId = randomUUID();
  const reservation = await reserveMapAssetAsAdmin(db, {
    ...auth, idempotencyKey: `map-upload:${uploadId}`,
    request: { formatVersion: 1, title: "Syntetisk långdistanskarta", mediaType: "image/png", byteLength: png.byteLength, sha256 }
  }, now);
  if (reservation.status !== "reserved") throw new Error("Synthetic map reservation failed");
  async function* body(): AsyncIterable<Uint8Array> { yield png; }
  const stored = await transferMapAssetAsAdmin(db, { ...auth, uploadId: reservation.response.uploadId, readBody: () => body() }, {
    async put(input) {
      return { formatVersion: 1, storeId: randomUUID(), key: `map/${input.raceId}/${input.attemptId}`,
        versionId: "synthetic-v1", mediaType: input.mediaType, sha256: input.sha256, byteLength: input.byteLength };
    }
  }, () => now);
  if (stored.status !== "stored") throw new Error("Synthetic map storage failed");
  const released = await publishMapAssetAsAdmin(db, {
    ...auth, idempotencyKey: `map-publish:${randomUUID()}`,
    request: { formatVersion: 1, uploadId: reservation.response.uploadId, expectedPublicationRevision: 0 }
  }, now);
  if (released.status !== "published") throw new Error("Synthetic map publication failed");
  return raceId;
}

async function createPublicResult() {
  const created = await createEvent(db, {
    name: `TASK131 ${Date.now()}-${Math.random()}`,
    raceName: "Individuellt", raceDate: "2026-09-22", timeZone: "Europe/Stockholm"
  });
  for (const fixture of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, created.race.id, await readFile(resolve("fixtures/iof", fixture), "utf8"));
  }
  const deviceId = randomUUID();
  const payload = {
    cardNumber: "12345", startPunchedAt: "2026-09-22T10:00:00.000Z", finishPunchedAt: "2026-09-22T10:45:00.000Z",
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: new Date(Date.parse("2026-09-22T10:00:00.000Z") + (index + 1) * 600_000).toISOString() }))
  };
  await ingestDeviceBatch(db, created.race.id, {
    deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-22T10:46:00.000Z", transport: "simulator", payload, contentHash: contentHash(payload) }]
  });
  const publicResultId = (await pool.query<{ public_result_id: string }>("SELECT public_result_id FROM entry WHERE race_id=$1 AND given_name='Ada'", [created.race.id])).rows[0]?.public_result_id;
  if (!publicResultId) throw new Error("Synthetic public result identity missing");
  return { raceId: created.race.id, publicResultId };
}

test("TASK106 public raster map is usable at 390px without storage identifiers", async ({ page, request }) => {
  const raceId = await createPublishedMap();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/map`, route => route.fulfill({
    // The browser needs a decodable image; publication/storage still uses the synthetic PNG above.
    status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#e6e7e4"/></svg>',
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  }));
  await page.goto(`/results/${raceId}/map`);
  await expect(page.getByRole("heading", { name: "Karta", exact: true })).toBeVisible();
  await expect(page.getByText("Syntetiskt kartsläpp · Långdistans", { exact: true })).toBeVisible();
  const image = page.getByRole("img", { name: "Syntetisk långdistanskarta", exact: true });
  await expect(image).toHaveAttribute("src", `/api/public/races/${raceId}/map`);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1000);
  const publicHtml = await (await request.get(`/results/${raceId}/map`)).text();
  expect(publicHtml).not.toMatch(/storeId|objectKey|versionId|map_upload|map_object/i);
  const metadata = await request.get(`/api/public/races/${raceId}/map/metadata`);
  expect(metadata.status()).toBe(200);
  expect(await metadata.text()).not.toMatch(/storeId|objectKey|versionId|uploadId|publicationId/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Zooma in", exact: true }).click();
  await expect(page.getByText("Förstoring: 150 %", { exact: true })).toBeVisible();
  const viewport = page.getByRole("region", { name: "Tävlingskarta" });
  expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const before = await viewport.evaluate(element => element.scrollLeft);
  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Visa hela kartan", exact: true }).click();
  await expect(page.getByText("Förstoring: 100 %", { exact: true })).toBeVisible();
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
});

test("TASK106 map administration shell remains private and compact at 390px", async ({ page }) => {
  const raceId = randomUUID();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/admin/races/${raceId}/map`, route => route.fulfill({ status: 200, json: {
    formatVersion: 1, raceId, latestPublicationRevision: 0, activePublication: null, storedCandidates: []
  } }));
  await page.goto(`/admin/${raceId}/map`);
  await expect(page.getByRole("heading", { name: "Kartsläpp", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ladda upp karta", exact: true })).toBeVisible();
  await expect(page.getByText("Ingen karta är publicerad just nu.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const html = await page.content();
  expect(html).not.toMatch(/storeId|objectKey|versionId|bucket|secretKey/i);
});

test("TASK114 private raster calibration is compact at 390px and has no public route path", async ({ page }) => {
  const raceId = randomUUID(), manifestId = randomUUID(), georeferenceId = randomUUID(), requestId = randomUUID();
  const publicRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/public/")) publicRequests.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "otid_race_administrator_csrf", value: "a".repeat(43), url: "http://127.0.0.1:3125" }]);
  await page.route(`**/api/admin/races/${raceId}/map`, route => route.fulfill({ status: 200, json: {
    formatVersion: 1, raceId, latestPublicationRevision: 0, activePublication: null,
    storedCandidates: [{ uploadId: manifestId, title: "Privat karta", mediaType: "image/png", sha256, byteLength: png.byteLength, storedAt: "2026-09-21T18:00:00.000Z" }]
  } }));
  await page.route(`**/api/admin/races/${raceId}/map/georeferences`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { formatVersion: 1, raceId, latestGeoreferenceRevision: 0, georeferences: [] } });
    const body = route.request().postDataJSON() as { manifestId: string; crs: string; tiePoints: unknown[]; imageWidth: number; imageHeight: number };
    expect(body).toMatchObject({ manifestId, crs: "EPSG:4326", imageWidth: 1001, imageHeight: 501 }); expect(body.tiePoints).toHaveLength(3);
    return route.fulfill({ status: 201, json: { formatVersion: 1, georeferenceId, requestId, raceId, revision: 1, manifestId, sourceHash: sha256, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326", tiePoints: [
      { pixelX: 0, pixelY: 0, longitude: 18.1, latitude: 59.2 }, { pixelX: 1000, pixelY: 0, longitude: 18.11, latitude: 59.2 }, { pixelX: 0, pixelY: 500, longitude: 18.1, latitude: 59.195 }
    ], transform: { a: 0.00001, b: 0, c: 18.1, d: 0, e: -0.00001, f: 59.2 }, maxResidualMeters: 0, decidedAt: "2026-09-21T18:00:00.000Z", replayed: false } });
  });
  await page.goto(`/admin/${raceId}/map`);
  await expect(page.getByRole("heading", { name: "Kartkalibrering", exact: true })).toBeVisible();
  const calibration = page.locator(".map-georeference-admin");
  await calibration.locator("summary").click();
  await calibration.getByLabel("Bredd", { exact: true }).fill("1001");
  await calibration.getByLabel("Höjd", { exact: true }).fill("501");
  const pointValues = [["0", "0", "18.1", "59.2"], ["1000", "0", "18.11", "59.2"], ["0", "500", "18.1", "59.195"]];
  for (const [index, values] of pointValues.entries()) {
    const point = calibration.locator(".map-georeference-point").nth(index);
    const inputs = point.locator("input");
    for (const [field, value] of values.entries()) await inputs.nth(field).fill(value);
  }
  await calibration.getByRole("button", { name: "Spara privat kalibrering", exact: true }).click();
  await expect(calibration.getByRole("status")).toContainText("Kalibreringen är privat sparad");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(publicRequests).toEqual([]);
});

test("TASK115 private route preview is compact at 390px and requests no public route path", async ({ page }) => {
  const raceId = randomUUID(), routeUploadId = randomUUID(), mapManifestId = randomUUID(), georeferenceId = randomUUID();
  const publicRequests: string[] = [];
  const privateRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/public/")) publicRequests.push(request.url()); });
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.startsWith(`/api/admin/races/${raceId}/`)) privateRequests.push(`${url.pathname}${url.search}`); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/admin/races/${raceId}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/route-preview/candidates")) return route.fulfill({ status: 200, json: {
      formatVersion: 1, raceId, routes: [{ routeUploadId, displayName: "Ada Route", storedAt: "2026-09-21T19:00:00.000Z", pointCount: 2, segmentCount: 1 }]
    } });
    if (url.pathname.endsWith("/map/georeferences")) return route.fulfill({ status: 200, json: {
      formatVersion: 1, raceId, latestGeoreferenceRevision: 1, georeferences: [{ formatVersion: 1, georeferenceId, raceId, revision: 1, manifestId: mapManifestId, sourceHash: sha256, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326", tiePoints: [
        { pixelX: 0, pixelY: 0, longitude: 18.1, latitude: 59.2 }, { pixelX: 1000, pixelY: 0, longitude: 18.11, latitude: 59.2 }, { pixelX: 0, pixelY: 500, longitude: 18.1, latitude: 59.195 }
      ], transform: { a: 0.00001, b: 0, c: 18.1, d: 0, e: -0.00001, f: 59.2 }, maxResidualMeters: 0, decidedAt: "2026-09-21T18:00:00.000Z" }]
    } });
    if (url.pathname.endsWith("/route-preview/map")) return route.fulfill({ status: 200, contentType: "image/png", body: png });
    if (url.pathname.endsWith("/route-preview")) return route.fulfill({ status: 200, json: {
      formatVersion: 1, raceId, imageWidth: 1001, imageHeight: 501, mapSourceHash: sha256,
      points: [{ x: 100, y: 333, segment: 0 }, { x: 200, y: 166, segment: 0 }]
    } });
    if (url.pathname.endsWith("/map")) return route.fulfill({ status: 200, json: {
      formatVersion: 1, raceId, latestPublicationRevision: 0, activePublication: null,
      storedCandidates: [{ uploadId: mapManifestId, title: "Privat karta", mediaType: "image/png", sha256, byteLength: png.byteLength, storedAt: "2026-09-21T18:00:00.000Z" }]
    } });
    return route.abort();
  });
  await page.goto(`/admin/${raceId}/route-preview`);
  await expect(page.getByRole("heading", { name: "Privat ruttförhandsgranskning", exact: true })).toBeVisible();
  await expect.poll(() => new Set(privateRequests).size).toBe(3);
  expect([...new Set(privateRequests)].sort()).toEqual([
    `/api/admin/races/${raceId}/map`,
    `/api/admin/races/${raceId}/map/georeferences`,
    `/api/admin/races/${raceId}/route-preview/candidates`
  ]);
  await expect(page.getByRole("combobox", { name: "Rutt", exact: true }).locator("option")).toHaveCount(1);
  await page.getByRole("button", { name: "Visa privat förhandsgranskning", exact: true }).click();
  await expect(page.getByRole("img", { name: "Privat rutt på karta", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(publicRequests).toEqual([]);
  const html = await page.content();
  expect(html).not.toMatch(/18\.071|objectKey|storeId|versionId|bucket|secretKey/i);
});

test("TASK118/TASK120/TASK131/TASK149 public participant route is pixel-only, playable and shareable at 390px", async ({ page }) => {
  const { raceId, publicResultId } = await createPublicResult();
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; }, readText: async () => copied }
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/participants/${publicResultId}/route`, route => route.fulfill({ status: 200, json: {
    formatVersion: 2, imageWidth: 1000, imageHeight: 500, notice: "ROUTE_NOT_GPS_VERIFIED",
    points: [{ x: 100, y: 300, segment: 0 }, { x: 200, y: 200, segment: 0 }],
    controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }],
    metadata: { distanceMeters: 1234.5, pointCount: 2, segmentCount: 1, timing: { status: "AVAILABLE", startedAt: "2026-09-21T10:00:00.000Z", finishedAt: "2026-09-21T10:01:00.000Z", durationMilliseconds: 60_000 } },
    playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] }
  } }));
  await page.route(`**/api/public/races/${raceId}/participants/${publicResultId}/route/map`, route => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.goto(`/results/${raceId}/participants/${publicResultId}/route`);
  await expect(page.getByRole("heading", { name: "Deltagarens rutt", exact: true })).toBeVisible();
  await expect(page.getByText("1,23 km", { exact: true })).toBeVisible();
  await expect(page.getByText("10:00:00–10:01:00 (1 min 0 s)", { exact: true })).toBeVisible();
  await expect(page.getByText("Rutten är inte GPS-verifierad.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spela upp GPX-rutt", exact: true })).toBeVisible();
  await expect(page.getByText("Tidsaxeln följer GPX-filens relativa inspelningstid, inte tävlingstid eller kontrollpassager.", { exact: true })).toBeVisible();
  const timeline = page.getByRole("slider", { name: "Position i GPX-rutten", exact: true });
  await timeline.fill("60000");
  await expect(page.locator(".public-route-playback-marker")).toHaveAttribute("cx", "200");
  await page.getByRole("button", { name: "Börja om", exact: true }).click();
  await expect(page.locator(".public-route-playback-marker")).toHaveAttribute("cx", "100");
  await expect(page.getByRole("img", { name: "Karta med deltagarens rutt", exact: true })).toHaveCount(1);
  await expect(page.locator(".public-participant-route-control")).toHaveCount(1);
  await expect(page.locator(".public-participant-route-control")).toHaveAttribute("aria-label", "Kontroll 1, kod 31");
  await page.getByRole("button", { name: "Kopiera länk", exact: true }).click();
  await expect(page.locator('.public-link-share [role="status"]')).toContainText("Länken är kopierad.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    `http://127.0.0.1:3125/results/${raceId}/participants/${publicResultId}/route`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.content()).not.toMatch(/entryId|grantId|storeId|objectKey|versionId|sourceHash|courseVersionId|courseControlId|geometryRevisionId|latitude|longitude/i);
  await page.unroute(`**/api/public/races/${raceId}/participants/${publicResultId}/route`);
  await page.route(`**/api/public/races/${raceId}/participants/${publicResultId}/route`, route => route.fulfill({ status: 404, json: { formatVersion: 1, error: "NOT_FOUND" } }));
  await page.reload();
  await expect(page.getByText("Rutten är inte tillgänglig.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kopiera länk", exact: true })).toHaveCount(0);
});

test("TASK121/TASK122/TASK123/TASK124/TASK132/TASK149 two-route comparison preserves its shared public link at 390px", async ({ page }) => {
  const raceId = randomUUID(), first = randomUUID(), second = randomUUID();
  await page.addInitScript(() => {
    let shareCalls = 0;
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: { url: string }) => {
      (window as typeof window & { task149SharedUrl?: string }).task149SharedUrl = data.url;
      shareCalls += 1;
      if (shareCalls > 1) throw new DOMException("cancelled", "AbortError");
    } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
      (window as typeof window & { task149CopiedUrl?: string }).task149CopiedUrl = value;
      throw new DOMException("blocked", "NotAllowedError");
    } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/route-comparison?first=${first}&second=${second}`, route => route.fulfill({ status: 200, json: {
    formatVersion: 2, imageWidth: 1000, imageHeight: 500, notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED",
    routes: [
      { participant: { givenName: "Ada", familyName: "Röd" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 60_000, elapsedMs: 60_000 }] }, points: [{ x: 100, y: 300, segment: 0 }, { x: 200, y: 250, segment: 1 }, { x: 220, y: 200, segment: 1 }], metadata: { distanceMeters: 1234, pointCount: 3, segmentCount: 2, timing: { status: "AVAILABLE", startedAt: "2026-09-22T10:00:00.000Z", finishedAt: "2026-09-22T10:01:00.000Z", durationMilliseconds: 60_000 } }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 20_000, 60_000] } },
      { participant: { givenName: "Bea", familyName: "Blå" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 65_000, elapsedMs: 65_000 }] }, points: [{ x: 100, y: 280, segment: 0 }, { x: 250, y: 180, segment: 0 }], metadata: { distanceMeters: 1250, pointCount: 2, segmentCount: 1, timing: { status: "AVAILABLE", startedAt: "2026-09-22T10:02:00.000Z", finishedAt: "2026-09-22T10:03:30.000Z", durationMilliseconds: 90_000 } }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 90_000] } }
    ], controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }]
  } }));
  await page.route(`**/api/public/races/${raceId}/route-comparison/map?first=${first}&second=${second}`, route => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.goto(`/results/${raceId}/route-comparison?first=${first}&second=${second}`);
  await expect(page.getByRole("heading", { name: "Jämför deltagarrutter", exact: true })).toBeVisible();
  await expect(page.getByText("Rutterna är inte GPS-verifierade.", { exact: true })).toBeVisible();
  await expect(page.getByText("Röd rutt: Ada Röd", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Blå rutt: Bea Blå", { exact: true })).toHaveCount(2);
  await expect(page.getByText("1,23 km · 3 punkter · 2 segment · 10:00:00–10:01:00 (1 min 0 s)", { exact: true })).toBeVisible();
  await expect(page.getByText("1,25 km · 2 punkter · 1 segment · 10:02:00–10:03:30 (1 min 30 s)", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spela upp båda GPX-rutterna", exact: true })).toBeVisible();
  await expect(page.getByText("Båda GPX-inspelningarna börjar vid sin egen relativa nollpunkt. Det är inte tävlingstid, synkad start eller kontrollpassager.", { exact: true })).toBeVisible();
  const comparisonTimeline = page.getByRole("slider", { name: "Relativ tid i båda GPX-rutterna", exact: true });
  await expect(page.locator(".public-route-comparison-playback-marker")).toHaveCount(2);
  await comparisonTimeline.fill("10000");
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-first")).toHaveCount(0);
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-second")).toHaveCount(1);
  await comparisonTimeline.fill("60000");
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-first")).toHaveAttribute("cx", "220");
  await comparisonTimeline.fill("90000");
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-first")).toHaveCount(0);
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-second")).toHaveAttribute("cx", "250");
  await page.getByRole("button", { name: "Börja om", exact: true }).click();
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-first")).toHaveAttribute("cx", "100");
  await page.getByRole("button", { name: "Spela", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pausa", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resultatets sträcktider", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 min 0 s", exact: true })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "1 min 5 s", exact: true })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Karta med två deltagarrutter", exact: true })).toHaveCount(1);
  await expect(page.locator("path.public-route-comparison-first")).toHaveCount(1);
  await expect(page.locator("path.public-route-comparison-second")).toHaveCount(1);
  await expect(page.locator(".public-participant-route-control")).toHaveCount(1);
  await expect(page.locator(".public-participant-route-control")).toHaveAttribute("aria-label", "Kontroll 1, kod 31");
  const expectedShareUrl = `http://127.0.0.1:3125/results/${raceId}/route-comparison?first=${first}&second=${second}`;
  const share = page.getByRole("button", { name: "Dela länk", exact: true });
  await expect(share).toBeVisible();
  await share.click();
  await expect(page.locator('.public-link-share [role="status"]')).toContainText("Länken har öppnats för delning.");
  expect(await page.evaluate(() => (window as typeof window & { task149SharedUrl?: string }).task149SharedUrl)).toBe(expectedShareUrl);
  await share.click();
  await expect(page.locator('.public-link-share [role="status"]')).toContainText("Delningen avbröts. Du kan kopiera länken i stället.");
  await page.getByRole("button", { name: "Kopiera länk", exact: true }).click();
  await expect(page.locator('.public-link-share [role="status"]')).toContainText("Länken kunde inte kopieras. Kopiera adressen från webbläsaren.");
  expect(await page.evaluate(() => (window as typeof window & { task149CopiedUrl?: string }).task149CopiedUrl)).toBe(expectedShareUrl);
  await expect(page).toHaveURL(expectedShareUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator("main").innerHTML()).not.toMatch(/entryId|grantId|storeId|objectKey|versionId|sourceHash|courseVersionId|courseControlId|geometryRevisionId|latitude|longitude|organisationName|timeBehind|position|startTime/i);
});

test("TASK146 public route comparison plays three compatible GPX routes without horizontal scroll at 390px", async ({ page }) => {
  const raceId = randomUUID(), first = randomUUID(), second = randomUUID(), third = randomUUID();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/route-comparison?first=${first}&second=${second}&third=${third}`, route => route.fulfill({ status: 200, json: {
    formatVersion: 3, imageWidth: 1000, imageHeight: 500, notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED",
    routes: [
      { participant: { givenName: "Ada", familyName: "Röd" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 60_000, elapsedMs: 60_000 }] }, points: [{ x: 100, y: 300, segment: 0 }, { x: 200, y: 200, segment: 0 }], metadata: { distanceMeters: 1234, pointCount: 2, segmentCount: 1, timing: { status: "AVAILABLE", startedAt: "2026-09-22T10:00:00.000Z", finishedAt: "2026-09-22T10:01:00.000Z", durationMilliseconds: 60_000 } }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] } },
      { participant: { givenName: "Bea", familyName: "Blå" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 90_000, elapsedMs: 90_000 }] }, points: [{ x: 100, y: 280, segment: 0 }, { x: 250, y: 180, segment: 0 }], metadata: { distanceMeters: 1250, pointCount: 2, segmentCount: 1, timing: { status: "AVAILABLE", startedAt: "2026-09-22T10:02:00.000Z", finishedAt: "2026-09-22T10:03:30.000Z", durationMilliseconds: 90_000 } }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 90_000] } },
      { participant: { givenName: "Cy", familyName: "Grön" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 120_000, elapsedMs: 120_000 }] }, points: [{ x: 100, y: 260, segment: 0 }, { x: 300, y: 160, segment: 0 }], metadata: { distanceMeters: 1275, pointCount: 2, segmentCount: 1, timing: { status: "AVAILABLE", startedAt: "2026-09-22T10:04:00.000Z", finishedAt: "2026-09-22T10:06:00.000Z", durationMilliseconds: 120_000 } }, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 120_000] } }
    ], controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }]
  } }));
  await page.route(`**/api/public/races/${raceId}/route-comparison/map?first=${first}&second=${second}&third=${third}`, route => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.goto(`/results/${raceId}/route-comparison?first=${first}&second=${second}&third=${third}`);
  await expect(page.getByText("Röd rutt: Ada Röd", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Blå rutt: Bea Blå", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Grön rutt: Cy Grön", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Spela upp tre GPX-rutter", exact: true })).toBeVisible();
  const timeline = page.getByRole("slider", { name: "Relativ tid i tre GPX-rutter", exact: true });
  await timeline.fill("90000");
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-first")).toHaveCount(0);
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-second")).toHaveAttribute("cx", "250");
  await expect(page.locator(".public-route-comparison-playback-marker.public-route-comparison-third")).toHaveAttribute("cx", "250");
  await expect(page.locator(".public-route-comparison-triple-splits > li")).toHaveCount(1);
  await expect(page.getByText("Kontroll 31", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Karta med tre deltagarrutter", exact: true })).toHaveCount(1);
  await expect(page.locator("path.public-route-comparison-third")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator("main").innerHTML()).not.toMatch(/entryId|grantId|storeId|objectKey|versionId|sourceHash|courseVersionId|courseControlId|geometryRevisionId|latitude|longitude|organisationName|timeBehind|position|startTime/i);
});

test("TASK145 explains a non-comparable public route pair without revealing why at 390px", async ({ page }) => {
  const raceId = randomUUID(), first = randomUUID(), second = randomUUID();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/route-comparison?first=${first}&second=${second}`, route => route.fulfill({ status: 404 }));
  await page.goto(`/results/${raceId}/route-comparison?first=${first}&second=${second}`);
  await expect(page.getByText("De valda deltagarna har inte jämförbara, publicerade rutter. Varje rutt behöver vara släppt för samma historiska karta och bana.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.content()).not.toMatch(/entryId|grantId|storeId|objectKey|versionId|sourceHash|courseVersionId|courseControlId|geometryRevisionId|latitude|longitude/i);
});

test("TASK145 keeps a temporary comparison failure distinct from a non-comparable pair", async ({ page }) => {
  const raceId = randomUUID(), first = randomUUID(), second = randomUUID();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/route-comparison?first=${first}&second=${second}`, route => route.fulfill({ status: 503 }));
  await page.goto(`/results/${raceId}/route-comparison?first=${first}&second=${second}`);
  await expect(page.getByText("Ruttjämförelsen är tillfälligt inte tillgänglig.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK149 copies the exact public three-route comparison link at 390px", async ({ page }) => {
  const raceId = randomUUID(), first = randomUUID(), second = randomUUID(), third = randomUUID();
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; }, readText: async () => copied }
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/route-comparison?first=${first}&second=${second}&third=${third}`, route => route.fulfill({ status: 200, json: {
    formatVersion: 3, imageWidth: 1000, imageHeight: 500, notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED",
    routes: [
      { participant: { givenName: "Ada", familyName: "Röd" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 60_000, elapsedMs: 60_000 }] }, points: [{ x: 100, y: 300, segment: 0 }, { x: 200, y: 200, segment: 0 }], metadata: { distanceMeters: 1234, pointCount: 2, segmentCount: 1, timing: { status: "UNAVAILABLE" } }, playback: { status: "UNAVAILABLE" } },
      { participant: { givenName: "Bea", familyName: "Blå" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 90_000, elapsedMs: 90_000 }] }, points: [{ x: 100, y: 280, segment: 0 }, { x: 250, y: 180, segment: 0 }], metadata: { distanceMeters: 1250, pointCount: 2, segmentCount: 1, timing: { status: "UNAVAILABLE" } }, playback: { status: "UNAVAILABLE" } },
      { participant: { givenName: "Cy", familyName: "Grön" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 120_000, elapsedMs: 120_000 }] }, points: [{ x: 100, y: 260, segment: 0 }, { x: 300, y: 160, segment: 0 }], metadata: { distanceMeters: 1275, pointCount: 2, segmentCount: 1, timing: { status: "UNAVAILABLE" } }, playback: { status: "UNAVAILABLE" } }
    ], controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }]
  } }));
  await page.route(`**/api/public/races/${raceId}/route-comparison/map?first=${first}&second=${second}&third=${third}`, route => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.goto(`/results/${raceId}/route-comparison?first=${first}&second=${second}&third=${third}`);
  await expect(page.getByRole("button", { name: "Kopiera länk", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kopiera länk", exact: true }).click();
  await expect(page.locator('.public-link-share [role="status"]')).toContainText("Länken är kopierad.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`http://127.0.0.1:3125/results/${raceId}/route-comparison?first=${first}&second=${second}&third=${third}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK117 withdrawn participant route fails closed without internal detail", async ({ page }) => {
  const raceId = randomUUID(), publicResultId = randomUUID();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/public/races/${raceId}/participants/${publicResultId}/route`, route => route.fulfill({ status: 404, json: { formatVersion: 1, error: "NOT_FOUND" } }));
  await page.goto(`/results/${raceId}/participants/${publicResultId}/route`);
  await expect(page.getByText("Rutten är inte tillgänglig.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.content()).not.toMatch(/entryId|grantId|storeId|objectKey|versionId|sourceHash|latitude|longitude/i);
});
