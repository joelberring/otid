import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import { createDatabase } from "@o-tid/database";
import { createEvent, importIofXml, issuePairingAdminAccessCredential, contentHash, ingestDeviceBatch, revokePairingAdminAccessCredential } from "@o-tid/application";

const url = process.env.TEST_DATABASE_URL;
if (!url || url !== process.env.DATABASE_URL) throw new Error("Isolerad matchande testdatabas krävs");
const { db, pool } = createDatabase(url);
test.afterAll(async () => pool.end());

test("TASK008 inloggning är låst tills första sessionskontrollen avslutats", async ({ page }) => {
  const raceId = "10000000-0000-4000-8000-000000000001";
  let release: () => void = () => undefined, started: () => void = () => undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  await page.route(`**/api/admin/races/${raceId}/speaker-board-session`, async route => {
    started(); await hold; await route.fulfill({ status: 401, json: { formatVersion: 1, error: "UNAUTHORIZED" } });
  });
  await page.goto(`/admin/${raceId}/speaker`);
  await ready;
  await expect(page.getByLabel("Speakerns behörighet")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel("Speakerns behörighet")).toBeEnabled();
});

async function controlledBrowser(page: Page) {
  const raceId = "10000000-0000-4000-8000-000000000001";
  const now = new Date("2026-09-06T12:00:00.000Z");
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const path = `/api/admin/races/${raceId}/speaker-board`;
  let reads = 0;
  const data = { formatVersion: 1, raceId, eventName: "Kontrollerat browserprov", raceName: "Lång", raceSnapshotVersion: 3,
    timeZone: "Europe/Stockholm", generatedAt: now.toISOString(), selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION",
    rows: [{ slot: 1, givenName: "Privat", familyName: "Testperson", organisationName: null, className: "Öppen",
      selectedRevision: 1, registeredAt: now.toISOString(), state: "ACTIVE_RESULT", result: { revision: 1, status: "NT", reason: "WITHOUT_TIMING" } }] };
  await page.route(`**${path}-session`, async route => { await route.fulfill({ json: {
    formatVersion: 1, raceId, capability: "VIEW_SPEAKER_BOARD", expiresAt: new Date(now.getTime() + 60_000).toISOString()
  } }); });
  await page.route(`**${path}`, async route => { reads++; await route.fulfill({ json: data }); });
  await page.goto(`/admin/${raceId}/speaker`);
  await expect(page.getByRole("heading", { name: "Privat Testperson", exact: true })).toBeVisible();
  return { reads: () => reads, path, data };
}

test("TASK008 sessionsutgång döljer data exakt utan att vänta på nätet", async ({ page }) => {
  const control = await controlledBrowser(page);
  await page.clock.runFor(59_999);
  await expect(page.getByRole("heading", { name: "Privat Testperson", exact: true })).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByRole("heading", { name: "Privat Testperson", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Speakerns behörighet")).toBeVisible();
  const reads = control.reads();
  await page.clock.runFor(10_000);
  expect(control.reads()).toBe(reads);
});

test("TASK008 emulerad fliksynlighet och pagehide stoppar hämtning och återvisning", async ({ page }) => {
  const control = await controlledBrowser(page);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const before = control.reads();
  await page.clock.runFor(15_000);
  expect(control.reads()).toBe(before);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(control.reads).toBe(before + 1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(page.getByRole("heading", { name: "Privat Testperson", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  const hiddenReads = control.reads();
  await page.clock.runFor(10_000);
  expect(control.reads()).toBe(hiddenReads);
  await expect(page.getByLabel("Speakerns behörighet")).toBeVisible();
});

test("TASK008 dold flik avbryter ett pågående svar och tillåter inte överlappande poll", async ({ page }) => {
  const control = await controlledBrowser(page);
  let release: () => void = () => undefined, started: () => void = () => undefined, intercepted = 0;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const handler = async (route: Route) => {
    intercepted++; started(); await hold;
    await route.fulfill({ json: { ...control.data, rows: control.data.rows.map(row => ({ ...row, givenName: "Sent" })) } });
  };
  await page.route(`**${control.path}`, handler);
  await page.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  await ready;
  await page.clock.runFor(5_000);
  expect(intercepted).toBe(1);
  const failed = page.waitForEvent("requestfailed", { predicate: request => request.url().endsWith(control.path) });
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await failed;
  release(); await page.unroute(`**${control.path}`, handler);
  await page.clock.runFor(5_000);
  expect(intercepted).toBe(1);
  await expect(page.getByRole("heading", { name: "Sent Testperson", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Privat Testperson", exact: true })).toBeVisible();
  const before = control.reads();
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(control.reads).toBe(before + 1);
});

test("TASK008 speaker: riktig HTTP/PG, polling, offline, sent svar och privat mobilvy", async ({ page, context }) => {
  const { race } = await createEvent(db, { name: "Syntetiskt speakerbrowserprov", raceName: "Lång", raceDate: "2026-08-30", timeZone: "Europe/Stockholm" });
  for (const file of ["course-data.xml", "entry-list.xml"]) await importIofXml(db, race.id, await readFile(resolve("fixtures/iof", file), "utf8"));
  const credential = await issuePairingAdminAccessCredential(db, { raceId: race.id, capability: "VIEW_SPEAKER_BOARD", label: "Syntetisk browserspeaker", expiresAt: new Date(Date.now() + 3600_000) });
  const dataPath = `/api/admin/races/${race.id}/speaker-board`;
  await page.setViewportSize({ width: 390, height: 844 });
  const shell = await page.goto(`/admin/${race.id}/speaker`);
  expect(shell?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByLabel("Speakerns behörighet")).toBeEnabled();
  await expect(page.getByText("Ada Löpare", { exact: true })).toHaveCount(0);
  await page.getByLabel("Speakerns behörighet").fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByText("Inga publicerade resultatunderlag finns ännu.")).toBeVisible();
  const payload = { cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:00Z", finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z` })) };
  await ingestDeviceBatch(db, race.id, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 3, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  // No manual refresh: the five-second poll must discover this published revision.
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("Tid: 40:00", { exact: true })).toBeVisible();
  const privateData = await page.request.get(dataPath);
  expect(privateData.status()).toBe(200); expect(privateData.headers()["cache-control"]).toContain("no-store");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.getByRole("button", { name: "Logga ut", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: "test-results/task-008-speaker-mobile.png", fullPage: true });
  await context.setOffline(true);
  const warning = page.getByRole("alert").filter({ hasText: "Underlaget kan vara gammalt" });
  await expect(warning).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(warning).toHaveCount(0);
  expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, caches: await caches.keys() })))
    .toEqual({ local: 0, session: 0, caches: [] });

  let release: () => void = () => undefined;
  let received: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { received = resolve; });
  await page.route(`**${dataPath}`, async (route) => { const response = await route.fetch(); received(); await held; await route.fulfill({ response }); });
  await page.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toHaveCount(0);
  release(); await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByLabel("Speakerns behörighet")).toBeEnabled();
  expect((await page.request.get(dataPath)).status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toHaveCount(0);

  await page.getByLabel("Speakerns behörighet").fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
  await revokePairingAdminAccessCredential(db, { credentialId: credential.credentialId, capability: "VIEW_SPEAKER_BOARD" });
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toHaveCount(0, { timeout: 12_000 });
  await expect(page.getByLabel("Speakerns behörighet")).toBeVisible();
});
