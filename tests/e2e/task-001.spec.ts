import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { publicResultListResponseSchema, signedStationPackageEnvelopeSchema } from "@o-tid/contracts";
import {
  createEvent,
  contentHash,
  importIofXml,
  ingestDeviceBatch,
  issueEventCreationAccessCredential,
  issuePairingAdminAccessCredential,
  revokePairingAdminAccessCredential,
  issueStationCredential,
  issueStationPairingGrant,
  recalculateEntry,
  verifySignedStationPackage
} from "@o-tid/application";
import { createDatabase, schema } from "@o-tid/database";
import { and, asc, count, eq } from "drizzle-orm";

const e2eConnectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!e2eConnectionString) throw new Error("E2E kräver TEST_DATABASE_URL eller DATABASE_URL");
const e2eDatabase = createDatabase(e2eConnectionString);
test.afterAll(async () => e2eDatabase.pool.end());

test("TASK 006U granskar och sparar en hel FIXED-klass med same-id-retry", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  await importIofXml(e2eDatabase.db, raceId, await readFile(resolve("fixtures/iof/start-list.xml"), "utf8"));
  const [raceBefore] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  if (!raceBefore) throw new Error("Lopp saknas");
  const before = await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
  const credential = await issuePairingAdminAccessCredential(e2eDatabase.db, { raceId, capability: "DRAW_CLASS_START_TIMES", label: "E2E lottning", expiresAt: new Date(Date.now() + 3600_000) });
  const url = `/api/admin/races/${raceId}/class-start-draw`;
  expect((await request.get(url)).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${raceId}/class-start-draw`);
  await page.getByLabel("Startlottningsbehörighet").fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("combobox", { name: "Klass", exact: true }).selectOption({ label: "H21 (2)" });
  await page.getByLabel("Första start (datum, sekunder och UTC-offset)").fill("2026-08-31T11:00:00+02:00");
  await page.getByLabel("Startintervall i hela sekunder").fill("60");
  await page.getByLabel("Slumpfrö", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Granska lottning", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Bekräfta och spara klassens tider", exact: true });
  await expect(confirm).toBeVisible();
  expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id))).toEqual(before);
  await page.screenshot({ path: test.info().outputPath("class-start-draw-preview.png"), fullPage: true });
  const keys: string[] = []; let drop = true;
  await page.route(`**${url}`, async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    keys.push(route.request().headers()["idempotency-key"]!);
    const response = await route.fetch(); expect(response.status()).toBe(200);
    if (drop) { drop = false; await route.abort("failed"); } else await route.fulfill({ response });
  });
  await confirm.click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.locator(".class-start-draw-admin").getByRole("status")).toHaveText("Klassens starttider är sparade. Resultat och publicerade listor är oförändrade.");
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  const after = await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
  expect(after.map(entry => entry.fixedStartTime?.toISOString()).sort()).toEqual(["2026-08-31T09:00:00.000Z", "2026-08-31T09:01:00.000Z"]);
  for (const entry of after) expect(entry.version).toBe(before.find(old => old.id === entry.id)!.version + 1);
  const [raceAfter] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  expect(raceAfter?.snapshotVersion).toBe(raceBefore.snapshotVersion + 1);
  expect(await e2eDatabase.db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId))).toHaveLength(0);
  expect(await e2eDatabase.db.select().from(schema.startListPublications).where(eq(schema.startListPublications.raceId, raceId))).toHaveLength(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Startlottningsbehörighet")).toBeVisible();
});

test("TASK 006S / TASK 006T publicerar fryst startlista och XML med same-id-retry och avpublicerar även ogiltigt nytt underlag", async ({ page, request, browser }) => {
  const raceId = await createImportedRace(request);
  await importIofXml(e2eDatabase.db, raceId, await readFile(resolve("fixtures/iof/start-list.xml"), "utf8"));
  const [race] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Lopp saknas");
  const issued = await issuePairingAdminAccessCredential(e2eDatabase.db, { raceId, capability: "PUBLISH_START_LIST",
    label: "Playwright publicering", expiresAt: new Date(Date.now() + 3600_000) });
  const publicUrl = `/api/races/${raceId}/start-list`;
  const xmlUrl = `${publicUrl}/iof`;
  expect((await request.get(xmlUrl)).status()).toBe(404);
  expect((await request.get(publicUrl)).status()).toBe(404);
  const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await publicPage.goto(`http://127.0.0.1:3000/starts/${raceId}`);
    await expect(publicPage.getByRole("status")).toContainText("Ingen startlista kan visas");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/${raceId}/start-list-publication`);
    await page.getByLabel("Startlistepubliceringsbehörighet").fill(issued.accessCredential);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await page.getByRole("button", { name: "Granska publicering", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Bekräfta och publicera", exact: true });
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    expect((await request.get(publicUrl)).status()).toBe(404);
    const keys: string[] = []; let drop = true;
    await page.route(`**/api/admin/races/${raceId}/start-list-publication`, async (route) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      keys.push(route.request().headers()["idempotency-key"]!);
      const result = await route.fetch(); expect(result.status()).toBe(200);
      if (drop) { drop = false; await route.abort("failed"); } else await route.fulfill({ response: result });
    });
    await confirm.click();
    await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
    await expect(page.locator(".start-list-publication-admin").getByRole("status").filter({ hasText: "Publiceringsbeslutet är sparat." })).toHaveText("Publiceringsbeslutet är sparat.");
    expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
    const published = await request.get(publicUrl);
    const original = await published.text();
    expect(published.headers()["cache-control"]).toContain("no-store");
    expect(published.headers()["set-cookie"]).toBeUndefined();
    expect(original).toContain("Ada Löpare"); expect(original).not.toContain("12345");
    expect(original).not.toContain("actorCredentialId"); expect(original).not.toContain("entryId");
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
    const downloadLink = publicPage.getByRole("link", { name: "Ladda ner startlista (IOF XML 3.0)" });
    await expect(downloadLink).toBeVisible();
    expect((await downloadLink.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    const downloadEvent = publicPage.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("startlista-1.xml");
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error("Nedladdning saknas");
    const originalXml = await readFile(downloadedPath, "utf8");
    expect(originalXml).toContain("<Given>Ada</Given>");
    expect(originalXml).toContain("<Family>Löpare</Family>");
    expect(originalXml).not.toMatch(/ControlCard|EntryId|raceNumber|<Id>|<Result/);
    expect(await (await request.get(xmlUrl)).text()).toBe(originalXml);
    await publicPage.screenshot({ path: test.info().outputPath("published-start-list.png"), fullPage: true });
    await e2eDatabase.db.update(schema.entries).set({ givenName: "Ändrat namn", fixedStartTime: new Date("2026-08-31T08:30:00Z") })
      .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.givenName, "Ada")));
    await e2eDatabase.db.update(schema.races).set({ snapshotVersion: race.snapshotVersion + 1 }).where(eq(schema.races.id, raceId));
    expect(await (await request.get(publicUrl)).text()).toBe(original);
    expect(await (await request.get(xmlUrl)).text()).toBe(originalXml);
    await page.getByRole("button", { name: "Läs aktuellt underlag", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ändrat namn Löpare", exact: true })).toBeVisible();
    await e2eDatabase.db.update(schema.events).set({ timeZone: "Invalid/Test" }).where(eq(schema.events.id, race.eventId));
    await page.getByRole("button", { name: "Läs aktuellt underlag", exact: true }).click();
    await expect(page.getByText("Det aktuella underlaget kan inte publiceras. En redan publicerad lista kan fortfarande avpubliceras.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Granska avpublicering", exact: true }).click();
    await page.getByRole("button", { name: "Bekräfta och avpublicera", exact: true }).click();
    await expect(page.locator(".start-list-publication-admin").getByRole("status").filter({ hasText: "Publiceringsbeslutet är sparat." })).toHaveText("Publiceringsbeslutet är sparat.");
    expect((await request.get(publicUrl)).status()).toBe(404);
    expect((await request.get(xmlUrl)).status()).toBe(404);
    await expect(publicPage.getByRole("heading", { name: "Ada Löpare", exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(downloadLink).toHaveCount(0);
    expect(await publicPage.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    expect(await e2eDatabase.db.select().from(schema.startListPublications).where(eq(schema.startListPublications.raceId, raceId))).toHaveLength(2);
    expect(await e2eDatabase.db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId))).toHaveLength(0);
    await page.getByRole("button", { name: "Logga ut", exact: true }).click();
    await expect(page.getByLabel("Startlistepubliceringsbehörighet")).toBeVisible();
  } finally { await publicPage.close(); }
});

test.describe("TASK 006R privat startlista", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("visar tävlingstid, klassfilter och gammal nätlista utan writes eller kvarvarande PII efter logout/revoke", async ({ page, request }) => {
    const raceId = await createImportedRace(request);
    await importIofXml(e2eDatabase.db, raceId, await readFile(resolve("fixtures/iof/start-list.xml"), "utf8"));
    await e2eDatabase.db.update(schema.entries).set({ fixedStartTime: null }).where(and(
      eq(schema.entries.raceId, raceId), eq(schema.entries.givenName, "Bo")));
    const issued = await issuePairingAdminAccessCredential(e2eDatabase.db, { raceId, capability: "VIEW_START_LIST",
      label: "Playwright startlista", expiresAt: new Date(Date.now() + 3600_000) });
    const beforeEntries = await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const [beforeRace] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const shell = await request.get(`/admin/${raceId}/start-list`);
    expect(await shell.text()).not.toContain("Ada");
    expect((await request.get(`/api/admin/races/${raceId}/start-list`)).status()).toBe(401);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/${raceId}/start-list`);
    async function login() {
      await page.getByLabel("Startlistebehörighet").fill(issued.accessCredential);
      await page.getByRole("button", { name: "Logga in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
    }
    await login();
    const api = await page.request.get(`/api/admin/races/${raceId}/start-list`);
    expect(api.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByText("2026-08-31 10:00:00 GMT+02:00", { exact: true })).toBeVisible();
    await expect(page.getByText("Starttid saknas – behöver granskas", { exact: true })).toBeVisible();
    const select = page.getByRole("combobox", { name: "Klass", exact: true });
    await select.selectOption({ label: "D21" });
    await expect(page.getByText("Inga deltagare i urvalet.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toHaveCount(0);
    await select.selectOption({ label: "H21" });
    await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
    for (const control of await page.locator(".start-list-admin button, .start-list-admin select").all()) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    }
    await page.screenshot({ path: test.info().outputPath("start-list-mobile.png"), fullPage: true });
    const endpoint = `**/api/admin/races/${raceId}/start-list`;
    await page.route(endpoint, (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    await expect(page.locator(".start-list-admin").getByRole("alert")).toContainText("kan vara gamla");
    await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
    await page.unroute(endpoint);
    await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    await expect(page.locator(".start-list-admin").getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    await page.getByRole("button", { name: "Logga ut", exact: true }).click();
    await expect(page.getByLabel("Startlistebehörighet")).toBeVisible();
    await expect(page.locator(".start-list-entry")).toHaveCount(0);
    await login();
    await revokePairingAdminAccessCredential(e2eDatabase.db, { credentialId: issued.credentialId, capability: "VIEW_START_LIST" });
    await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    await expect(page.getByLabel("Startlistebehörighet")).toBeVisible();
    await expect(page.locator(".start-list-entry")).toHaveCount(0);
    expect(await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id))).toEqual(beforeEntries);
    expect(await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId))).toEqual([beforeRace]);
    expect(await e2eDatabase.db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId))).toHaveLength(0);
  });
});

test("TASK 006O starttid bekräftas och tappat commitsvar återhämtas med samma request", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  await importIofXml(e2eDatabase.db, raceId, await readFile(resolve("fixtures/iof/start-list.xml"), "utf8"));
  const issued = await issuePairingAdminAccessCredential(e2eDatabase.db, { raceId, capability: "CHANGE_ENTRY_START_TIME",
    label: "Playwright starttid", expiresAt: new Date(Date.now() + 60 * 60_000) });
  const url = `/admin/${raceId}/start-times`;
  const shell = await request.get(url);
  // Next's development server overrides page cache headers; the private API
  // always sends no-store, and next.config supplies production page policy.
  expect(shell.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  expect(await shell.text()).not.toContain("Ada");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByLabel("Starttidsbehörighet").fill(issued.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  const selector = page.getByRole("combobox", { name: "Deltagare", exact: true });
  await expect(selector).toBeVisible();
  const option = selector.locator("option").filter({ hasText: "Ada" });
  const entryId = await option.getAttribute("value");
  if (!entryId) throw new Error("Ada saknas");
  await selector.selectOption(entryId);
  await page.getByLabel("Ny starttid", { exact: true }).fill("2026-08-31T10:05:00+02:00");
  await page.getByRole("button", { name: "Granska ändring", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Bekräfta och spara starttid", exact: true });
  await expect(confirm).toBeVisible();
  expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  for (const control of await page.locator(".entry-start-time-admin input, .entry-start-time-admin select").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  }
  await page.screenshot({ path: test.info().outputPath("start-time-confirmation.png"), fullPage: true });
  expect(await e2eDatabase.db.select().from(schema.entryStartTimeChangeRequests)
    .where(eq(schema.entryStartTimeChangeRequests.raceId, raceId))).toHaveLength(0);
  const keys: string[] = [];
  let drop = true;
  await page.route(`**/api/races/${raceId}/entries/${entryId}/start-time`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (drop) { drop = false; await route.abort("failed"); } else { await route.fulfill({ response }); }
  });
  await confirm.click();
  const retry = page.getByRole("button", { name: "Försök igen med samma begäran", exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole("link", { name: "Gå till explicit omräkning", exact: true })).toHaveAttribute("href", `/admin/${raceId}/recalculation`);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const journal = await e2eDatabase.db.select().from(schema.entryStartTimeChangeRequests)
    .where(eq(schema.entryStartTimeChangeRequests.raceId, raceId));
  expect(journal).toHaveLength(1);
  expect(journal[0]!.fixedStartTime.toISOString()).toBe("2026-08-31T08:05:00.000Z");
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Starttidsbehörighet")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Deltagare", exact: true })).toHaveCount(0);
});

test("TASK 006P brickbyte bekräftas och återhämtas efter tappat svar utan dubbla kopplingar", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const credential = await issuePairingAdminAccessCredential(e2eDatabase.db, { raceId, capability: "CHANGE_ENTRY_CARD",
    label: "Playwright brickbyte", expiresAt: new Date(Date.now() + 3600_000) });
  const shell = await request.get(`/admin/${raceId}/cards`);
  expect(await shell.text()).not.toContain("Ada");
  expect((await request.get(`/api/admin/races/${raceId}/entry-cards`)).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${raceId}/cards`);
  await page.getByLabel("Brickbytesbehörighet", { exact: true }).fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  const selector = page.getByRole("combobox", { name: "Deltagare", exact: true });
  await expect(selector).toBeVisible();
  const entryId = await selector.locator("option").filter({ hasText: "Ada" }).getAttribute("value");
  if (!entryId) throw new Error("Ada saknas");
  await selector.selectOption(entryId);
  await page.getByLabel("Ny bricka", { exact: true }).fill("54321");
  await page.getByRole("button", { name: "Granska brickbyte", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Bekräfta och byt bricka", exact: true });
  await expect(confirm).toBeVisible();
  for (const control of await page.locator(".entry-card-admin button, .entry-card-admin input, .entry-card-admin select").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  }
  expect(await e2eDatabase.db.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.raceId, raceId))).toHaveLength(0);
  const keys: string[] = [];
  await page.route(`**/api/races/${raceId}/entries/${entryId}/card`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (keys.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await confirm.click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("link", { name: "Gå till explicit omräkning", exact: true })).toHaveAttribute("href", `/admin/${raceId}/recalculation`);
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  expect(await e2eDatabase.db.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.raceId, raceId))).toHaveLength(1);
  const assignments = await e2eDatabase.db.select().from(schema.cardAssignments).where(eq(schema.cardAssignments.entryId, entryId));
  expect(assignments.filter((row) => row.active).map((row) => row.cardNumber)).toEqual(["54321"]);
  expect(assignments.find((row) => row.cardNumber === "12345")?.active).toBe(false);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Brickbytesbehörighet", { exact: true })).toBeVisible();
});

test("TASK 006Q direktanmälan bekräftas och återhämtas efter tappat svar utan dubblett eller resultatrevision", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const credential = await issueEntryRegistrationAdminAccess(raceId);
  const [raceBefore] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  const [entriesBefore] = await e2eDatabase.db.select({ value: count() }).from(schema.entries)
    .where(eq(schema.entries.raceId, raceId));
  const [revisionsBefore] = await e2eDatabase.db.select({ value: count() }).from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.raceId, raceId));
  if (!raceBefore) throw new Error("E2E-fixturen saknar lopp");

  const url = `/admin/${raceId}/registration`;
  const shell = await request.get(url);
  expect(await shell.text()).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);
  expect((await request.get(`/api/admin/races/${raceId}/entry-registration-classes`)).status()).toBe(401);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByLabel("Registreringsbehörighet", { exact: true }).fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  const raceClass = page.getByRole("combobox", { name: "Klass", exact: true });
  await expect(raceClass).toBeVisible();
  await raceClass.selectOption({ label: "H21" });
  await page.getByRole("textbox", { name: "Förnamn", exact: true }).fill("Cleo");
  await page.getByRole("textbox", { name: "Efternamn", exact: true }).fill("Direkt");
  await page.getByRole("textbox", { name: "Klubb (valfri)", exact: true }).fill("OK Test");
  await page.getByRole("textbox", { name: "Bricknummer (valfritt)", exact: true }).fill("54321");
  await page.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  const confirmation = page.locator("section[role='alert']");
  await expect(confirmation).toContainText("Cleo Direkt");
  await expect(confirmation).toContainText("H21");
  await expect(confirmation).toContainText("54321");
  const confirm = page.getByRole("button", { name: "Bekräfta och registrera", exact: true });
  await expect(confirm).toBeVisible();
  for (const control of await page.locator(".entry-registration-admin button, .entry-registration-admin input, .entry-registration-admin select").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  }

  expect(await e2eDatabase.db.select().from(schema.entryRegistrationRequests)
    .where(eq(schema.entryRegistrationRequests.raceId, raceId))).toHaveLength(0);
  expect(await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, "ENTRY_REGISTERED_BY_ADMIN")
  ))).toHaveLength(0);
  const [entriesAtReview] = await e2eDatabase.db.select({ value: count() }).from(schema.entries)
    .where(eq(schema.entries.raceId, raceId));
  expect(entriesAtReview?.value).toBe(entriesBefore?.value);

  const keys: string[] = [];
  await page.route(`**/api/races/${raceId}/entries`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (keys.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await confirm.click();
  await expect(confirmation).toContainText("Svaret är okänt");
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Deltagaren är registrerad. Inget resultat skapades av anmälan.");
  await expect(page.getByRole("link", { name: "Gå till explicit omräkning", exact: true }))
    .toHaveAttribute("href", `/admin/${raceId}/recalculation`);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[0]).toMatch(/^entry-registration:[0-9a-f-]{36}$/);

  const [raceAfter] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  const newEntries = await e2eDatabase.db.select().from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId), eq(schema.entries.givenName, "Cleo"), eq(schema.entries.familyName, "Direkt")
  ));
  const journal = await e2eDatabase.db.select().from(schema.entryRegistrationRequests)
    .where(eq(schema.entryRegistrationRequests.raceId, raceId));
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, "ENTRY_REGISTERED_BY_ADMIN")
  ));
  const [revisionsAfter] = await e2eDatabase.db.select({ value: count() }).from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.raceId, raceId));
  expect(raceAfter?.snapshotVersion).toBe(raceBefore.snapshotVersion + 1);
  expect(newEntries).toHaveLength(1);
  expect(newEntries[0]).toMatchObject({ organisationName: "OK Test", version: 1, fixedStartTime: null });
  expect(journal).toHaveLength(1);
  expect(journal[0]).toMatchObject({ requestId: keys[0]?.slice("entry-registration:".length), entryId: newEntries[0]?.id });
  expect(audits).toHaveLength(1);
  expect(revisionsAfter?.value).toBe(revisionsBefore?.value);
  const assignments = await e2eDatabase.db.select().from(schema.cardAssignments)
    .where(eq(schema.cardAssignments.entryId, newEntries[0]!.id));
  expect(assignments).toHaveLength(1);
  expect(assignments[0]).toMatchObject({ cardNumber: "54321", active: true });
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });

  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Registreringsbehörighet", { exact: true })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name.includes("entry_registration_admin") || cookie.name.includes("entry-registration-admin"))).toBe(false);
});

async function createImportedRace(request: APIRequestContext): Promise<string> {
  const suffix = `${Date.now()}-${Math.random()}`;
  void request;
  const created = await createEvent(e2eDatabase.db, {
    name: `E2E ${suffix}`,
    raceName: "Individuellt",
    raceDate: "2026-08-30",
    timeZone: "Europe/Stockholm"
  });
  const raceId = created.race.id;
  for (const fixture of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(e2eDatabase.db, raceId, await readFile(resolve("fixtures/iof", fixture), "utf8"));
  }
  return raceId;
}

async function createEmptyRace(request: APIRequestContext): Promise<string> {
  const suffix = `${Date.now()}-${Math.random()}`;
  void request;
  const created = await createEvent(e2eDatabase.db, {
    name: `E2E import ${suffix}`,
    raceName: "Individuellt",
    raceDate: "2026-08-30",
    timeZone: "Europe/Stockholm"
  });
  return created.race.id;
}

async function issueCredentialJson(raceId: string, deviceId: string): Promise<string> {
  const credential = await issueStationCredential(e2eDatabase.db, {
    deviceId,
    raceId,
    scope: "READOUT",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
  return JSON.stringify(credential);
}

async function issuePairingAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "PAIR_STATION",
    label: "Playwright pairingadmin",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueImportAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "IMPORT_IOF",
    label: "Playwright IOF-import",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueEntryClassAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "CHANGE_ENTRY_CLASS",
    label: "Playwright klassändring",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueEntryRegistrationAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "REGISTER_ENTRY",
    label: "Playwright direktanmälan",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueResultRecalculationAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "RECALCULATE_RESULT",
    label: "Playwright resultatomräkning",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueRaceOverviewAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "VIEW_RACE_OVERVIEW",
    label: "Playwright tävlingsöversikt",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueReadoutResultHistoryAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "VIEW_READOUT_RESULT_HISTORY",
    label: "Playwright avläsningshistorik",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueIofResultListExportAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "EXPORT_IOF_RESULT_LIST",
    label: "Playwright IOF ResultList-export",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueResultFinalizationAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "FINALIZE_RESULTS",
    label: "Playwright resultatfinalisering",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueDidNotStartAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "DECIDE_DID_NOT_START",
    label: "Playwright ej-startbeslut",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueDidNotStartWithdrawalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "WITHDRAW_DID_NOT_START",
    label: "Playwright återtagande av ej-startbeslut",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueResultDisqualificationAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "DISQUALIFY_RESULT",
    label: "Playwright diskvalifikation",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueResultDisqualificationWithdrawalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "WITHDRAW_DISQUALIFICATION",
    label: "Playwright återtagande av diskvalifikation",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueResultApprovalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "APPROVE_RESULT",
    label: "Playwright manuellt resultatgodkännande",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueDidNotFinishAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "DECIDE_DID_NOT_FINISH",
    label: "Playwright ej-fullföljt-beslut",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueOutOfCompetitionAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "DECIDE_OUT_OF_COMPETITION",
    label: "Playwright utom-tävlan-beslut",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueWithoutTimingAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "DECIDE_WITHOUT_TIMING",
    label: "Playwright utan-tidtagning-beslut",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueWithoutTimingWithdrawalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "WITHDRAW_WITHOUT_TIMING",
    label: "Playwright återtagande av utan tidtagning",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueOutOfCompetitionWithdrawalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "WITHDRAW_OUT_OF_COMPETITION",
    label: "Playwright återtagande av utom tävlan",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueDidNotFinishWithdrawalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "WITHDRAW_DID_NOT_FINISH",
    label: "Playwright återtagande av ej-fullföljt-beslut",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueResultApprovalWithdrawalAdminAccess(raceId: string) {
  return issuePairingAdminAccessCredential(e2eDatabase.db, {
    raceId,
    capability: "WITHDRAW_RESULT_APPROVAL",
    label: "Playwright återtagande av resultatgodkännande",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function issueEventCreationAdminAccess() {
  return issueEventCreationAccessCredential(e2eDatabase.db, {
    label: "Playwright tävlingsskapande",
    expiresAt: new Date(Date.now() + 60 * 60_000)
  });
}

async function installSimulatorCredential(page: import("@playwright/test").Page, raceId: string): Promise<string> {
  await expect(page.locator("small").filter({ hasText: "Enhet:" }))
    .toContainText(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  const deviceId = await page.evaluate((id) => localStorage.getItem(`otid:${id}:device-id`), raceId);
  if (!deviceId) throw new Error("Simulatorn saknar device-id");
  const credentialJson = await issueCredentialJson(raceId, deviceId);
  await page.getByLabel("Stationscredential").fill(JSON.parse(credentialJson).token as string);
  return credentialJson;
}

test("tävlingsskapande återhämtar okänd commit utan dubblett eller capabilityblandning", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const eventName = `E2E skapa ${suffix}`;
  const access = await issueEventCreationAdminAccess();
  const [eventsBefore] = await e2eDatabase.db.select({ value: count() }).from(schema.events);
  const [racesBefore] = await e2eDatabase.db.select({ value: count() }).from(schema.races);

  const openCreate = await request.post("/api/events", { data: {
    formatVersion: 1,
    eventName,
    raceName: "Individuellt",
    raceDate: "2026-09-01",
    timeZone: "Europe/Stockholm"
  } });
  expect(openCreate.status()).toBe(403);
  expect(await openCreate.json()).toEqual({ formatVersion: 1, error: "FORBIDDEN" });

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Skapa tävling" })).toBeVisible();
  await expect(page.getByLabel("Tävlingsnamn")).toHaveCount(0);

  const pageResponse = await page.goto("/admin/events/new");
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);

  await page.getByLabel("Personlig nyckel för att skapa tävling").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Tävlingsuppgifter" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name === "otid_event_creation_session" && cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "otid_event_creation_csrf" && !cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => /pairing_admin|import_admin|entry_class_admin|recalculation_admin|race_overview/.test(cookie.name))).toBe(false);

  let firstMutation = true;
  let retainedBody: string | null = null;
  let retainedKey: string | undefined;
  await page.route("**/api/events", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (firstMutation) {
      firstMutation = false;
      retainedBody = route.request().postData();
      retainedKey = route.request().headers()["idempotency-key"];
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort("failed");
      return;
    }
    expect(route.request().postData()).toBe(retainedBody);
    expect(route.request().headers()["idempotency-key"]).toBe(retainedKey);
    await route.continue();
  });

  await page.getByLabel("Tävlingsnamn").fill(eventName);
  await page.getByLabel("Första loppets namn").fill("Individuellt");
  await page.getByLabel("Datum").fill("2026-09-01");
  await page.getByRole("button", { name: "Skapa tävling och första lopp" }).click();
  await expect(page.getByRole("heading", { name: /Skapandets status är inte bekräftad/ })).toBeVisible();
  const retainedRequestId = await page.locator(".event-creation-attempt dd").first().textContent();
  expect(retainedRequestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Försök igen med samma skapande" }).click();
  await expect(page.getByRole("heading", { name: /Det tidigare skapandet bekräftades/ })).toBeVisible();

  const [eventsAfter] = await e2eDatabase.db.select({ value: count() }).from(schema.events);
  const [racesAfter] = await e2eDatabase.db.select({ value: count() }).from(schema.races);
  expect(eventsAfter?.value).toBe((eventsBefore?.value ?? 0) + 1);
  expect(racesAfter?.value).toBe((racesBefore?.value ?? 0) + 1);
  const [journal] = await e2eDatabase.db.select().from(schema.eventCreationRequests)
    .where(eq(schema.eventCreationRequests.requestId, retainedRequestId ?? ""));
  expect(journal).toMatchObject({ eventName, raceName: "Individuellt", raceDate: "2026-09-01" });
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, journal?.raceId ?? ""),
    eq(schema.auditEvents.action, "EVENT_CREATED_BY_ADMIN")
  ));
  expect(audits).toHaveLength(1);
  expect(await e2eDatabase.db.select().from(schema.pairingAdminAccessCredentials)
    .where(eq(schema.pairingAdminAccessCredentials.raceId, journal?.raceId ?? ""))).toHaveLength(0);

  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain(retainedRequestId ?? "REQUEST-ID-MISSING");
  expect(storage).not.toContain(eventName);

  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  await expect(page.getByText(journal?.raceId ?? "RACE-ID-MISSING")).toHaveCount(0);
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_event_creation_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_event_creation_csrf")).toBe(false);
});

test("arrangören importerar, simulerar och publicerar resultat", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const simulatorResponse = await page.goto(`/admin/${raceId}/simulator`);
  expect(simulatorResponse?.status()).toBe(200);
  expect(simulatorResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  expect(simulatorResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(simulatorResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(simulatorResponse?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.getByText("Utvecklingsyta.")).toBeVisible();

  const mismatchedAuthority = await request.get(`/admin/${raceId}/simulator`, {
    headers: {
      host: "localhost:3000",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http"
    }
  });
  expect(mismatchedAuthority.status()).toBe(404);
  expect(await mismatchedAuthority.text()).not.toMatch(/Stationssimulator|Utvecklingsyta|Lopp-id/);
  await installSimulatorCredential(page, raceId);
  await page.getByLabel("Bricknummer").fill("12345");
  await page.getByLabel("Kontrollkoder, kommaseparerade").fill("31,32,33");
  await page.getByRole("button", { name: "Simulera och skicka" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Serverkvittens" })).toContainText("stored");
  await page.goto(`/results/${raceId}`);
  const resultRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(resultRow).toContainText("H21");
  await expect(resultRow).toContainText("1");
  await expect(resultRow).toContainText("+0:00");
  await expect(resultRow).toContainText("Godkänt resultat");
  await expect(resultRow).toContainText(/31:\s+\d+:\d{2}/);
  const publicApiResponse = await request.get(`/api/public/races/${raceId}/results`);
  expect(publicApiResponse.status()).toBe(200);
  const publicBody = publicResultListResponseSchema.parse(await publicApiResponse.json());
  expect(publicBody.results[0]).toMatchObject({
    className: "H21",
    position: 1,
    timeBehindMs: 0,
    rankingState: "RANKED"
  });
  expect(JSON.stringify(publicBody)).not.toMatch(/entryId|courseVersionId|evaluation|resultRevisionId/);
});

test("simulatorn återupptar en beständig offlinekö efter omladdning", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const ingestPattern = `**/api/races/${raceId}/device-batches`;
  await page.route(ingestPattern, async (route) => route.abort("failed"));
  await page.goto(`/admin/${raceId}/simulator`);
  const credentialJson = await installSimulatorCredential(page, raceId);

  await page.getByLabel("Bricknummer").fill("12345");
  await page.getByLabel("Kontrollkoder, kommaseparerade").fill("31,32,33");
  await page.getByRole("button", { name: "Simulera och skicka" }).click();
  const queueStatus = page.locator(".status").filter({ hasText: "Lokal kö" });
  await expect(queueStatus).toContainText("1");
  await expect(page.getByRole("status")).toContainText("ligger kvar lokalt");

  const beforeReload = await page.evaluate((id) => localStorage.getItem(`otid:${id}:queue`), raceId);
  expect(beforeReload).not.toBeNull();
  await page.reload();
  await page.getByLabel("Stationscredential").fill(JSON.parse(credentialJson).token as string);
  await expect(queueStatus).toContainText("1");
  await expect(page.getByRole("button", { name: "Skicka samma batch igen" })).toBeEnabled();
  const afterReload = await page.evaluate((id) => localStorage.getItem(`otid:${id}:queue`), raceId);
  expect(afterReload).toBe(beforeReload);

  const persisted = JSON.parse(afterReload ?? "[]") as Array<{
    queueId: string;
    deviceId: string;
    sessionId: string;
    packageVersion: number;
    event: { localSequence: number; contentHash: string };
  }>;
  expect(persisted).toHaveLength(1);
  expect(persisted[0]?.queueId).toMatch(/^[0-9a-f-]{36}$/);
  expect(persisted[0]?.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(persisted[0]?.sessionId).toBe(persisted[0]?.deviceId);
  expect(persisted[0]?.packageVersion).toBeGreaterThan(0);
  expect(persisted[0]?.event.localSequence).toBe(1);
  expect(persisted[0]?.event.contentHash).toMatch(/^[a-f0-9]{64}$/);

  await page.unroute(ingestPattern);
  await page.getByRole("button", { name: "Skicka väntande poster (1)" }).click();
  await expect(page.getByRole("status")).toContainText("stored");
  await expect(queueStatus).toContainText("0");

  await page.getByRole("button", { name: "Skicka samma batch igen" }).click();
  await expect(page.getByRole("status")).toContainText("duplicate");
  await expect(queueStatus).toContainText("0");
});

test("simulatorn stoppar ordnad flush vid okänd HTTP-commitstatus", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const ingestPattern = `**/api/races/${raceId}/device-batches`;
  const sentSequences: number[] = [];
  await page.route(ingestPattern, async (route) => {
    const body = route.request().postDataJSON() as { events?: Array<{ localSequence?: number }> };
    const sequence = body.events?.[0]?.localSequence;
    if (typeof sequence === "number") sentSequences.push(sequence);
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Tillfälligt serverfel" })
    });
  });
  await page.goto(`/admin/${raceId}/simulator`);
  await installSimulatorCredential(page, raceId);
  const queueStatus = page.locator(".status").filter({ hasText: "Lokal kö" });

  await page.getByLabel("Bricknummer").fill("12345");
  await page.getByRole("button", { name: "Simulera och skicka" }).click();
  await expect(page.getByRole("status")).toContainText("Tillfälligt serverfel");
  await expect(queueStatus).toContainText("1");

  await page.getByLabel("Bricknummer").fill("12345");
  await page.getByRole("button", { name: "Simulera och skicka" }).click();
  await expect(queueStatus).toContainText("2");
  expect(sentSequences).toEqual([1, 1]);
});

test("signerat stationspaket lämnas endast till auktoriserad station", async ({ request }) => {
  const raceId = await createImportedRace(request);
  const credential = JSON.parse(await issueCredentialJson(raceId, crypto.randomUUID())) as { token: string };
  const unauthenticated = await request.get(`/api/races/${raceId}/station-package`);
  expect(unauthenticated.status()).toBe(401);
  expect(await unauthenticated.text()).not.toContain("Ada");

  const wrongToken = await request.get(`/api/races/${raceId}/station-package`, {
    headers: { authorization: "Bearer felaktig-station-token" }
  });
  expect(wrongToken.status()).toBe(401);
  expect(await wrongToken.text()).not.toContain("Ada");

  const response = await request.get(`/api/races/${raceId}/station-package`, {
    headers: { authorization: `Bearer ${credential.token}` }
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const envelope = signedStationPackageEnvelopeSchema.parse(await response.json());
  const publicKey = process.env.O_TID_TEST_PACKAGE_PUBLIC_KEY_SPKI_BASE64;
  if (!publicKey) throw new Error("Playwright saknar paketets publika testnyckel");
  const payload = verifySignedStationPackage(envelope, publicKey);
  expect(payload).toMatchObject({
    raceId,
    packageVersion: payload.raceSnapshot.race.snapshotVersion,
    stationFunction: "READOUT",
    event: { timeZone: "Europe/Stockholm" }
  });
  expect(payload.raceSnapshot.entries.some((entry) => entry.givenName === "Ada")).toBe(true);
});

test("device-batch-gränsen avvisar före ingest och bevarar exact retry", async ({ request }) => {
  const raceId = await createImportedRace(request);
  const otherRaceId = await createImportedRace(request);
  const deviceId = crypto.randomUUID();
  const otherDeviceId = crypto.randomUUID();
  const credential = JSON.parse(await issueCredentialJson(raceId, deviceId)) as { token: string };
  const event = {
    localSequence: 1,
    stationReceivedAt: new Date().toISOString(),
    transport: "simulator",
    payload: {
      cardNumber: "12345",
      startPunchedAt: new Date(Date.now() - 60_000).toISOString(),
      finishPunchedAt: new Date().toISOString(),
      punches: []
    }
  };
  const { createHash } = await import("node:crypto");
  const contentHash = createHash("sha256").update(JSON.stringify(event.payload)).digest("hex");
  const body = (id: string) => ({
    deviceId: id,
    sessionId: id,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{ ...event, contentHash }]
  });

  const unauthenticated = await request.post(`/api/races/${raceId}/device-batches`, { data: body(deviceId) });
  expect(unauthenticated.status()).toBe(401);
  expect(await unauthenticated.text()).not.toContain(deviceId);

  const wrongDevice = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: {
      authorization: `Bearer ${credential.token}`,
      "idempotency-key": `${otherDeviceId}:1:1`
    },
    data: body(otherDeviceId)
  });
  expect(wrongDevice.status()).toBe(403);
  expect(await wrongDevice.text()).not.toContain(otherDeviceId);

  const wrongRace = await request.post(`/api/races/${otherRaceId}/device-batches`, {
    headers: {
      authorization: `Bearer ${credential.token}`,
      "idempotency-key": `${deviceId}:1:1`
    },
    data: body(deviceId)
  });
  expect(wrongRace.status()).toBe(403);

  const authorizedHeaders = {
    authorization: `Bearer ${credential.token}`,
    "idempotency-key": `${deviceId}:1:1`
  };
  const wrongMedia = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: { ...authorizedHeaders, "content-type": "text/plain" },
    data: JSON.stringify(body(deviceId))
  });
  expect(wrongMedia.status()).toBe(415);
  expect(await wrongMedia.json()).toEqual({ error: "Ogiltig stationsbatch" });

  const brokenJson = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: { ...authorizedHeaders, "content-type": "application/json" },
    data: "{"
  });
  expect(brokenJson.status()).toBe(400);

  const unknownField = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: authorizedHeaders,
    data: { ...body(deviceId), canary: "FÅR_INTE_LAGRAS" }
  });
  expect(unknownField.status()).toBe(400);
  expect(await unknownField.text()).not.toContain("FÅR_INTE_LAGRAS");

  const oversized = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: { ...authorizedHeaders, "content-type": "application/json" },
    data: `"${"x".repeat(4 * 1024 * 1024)}"`
  });
  expect(oversized.status()).toBe(413);

  const [deviceRawCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
  const [otherDeviceRawCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, otherDeviceId));
  expect({ device: deviceRawCount?.value, otherDevice: otherDeviceRawCount?.value })
    .toEqual({ device: 0, otherDevice: 0 });

  const [readoutBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
  const [outcomeBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.deviceIngestOutcomes)
    .innerJoin(schema.rawDeviceMessages, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
    .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
  const [revisionBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
  expect({ readouts: readoutBefore?.value, outcomes: outcomeBefore?.value, revisions: revisionBefore?.value })
    .toEqual({ readouts: 0, outcomes: 0, revisions: 0 });

  const stored = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: authorizedHeaders,
    data: body(deviceId)
  });
  expect(stored.status()).toBe(200);
  expect((await stored.json() as { acknowledgements: Array<{ status: string }> })
    .acknowledgements[0]?.status).toBe("stored");
  const duplicate = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: authorizedHeaders,
    data: body(deviceId)
  });
  expect(duplicate.status()).toBe(200);
  expect((await duplicate.json() as { acknowledgements: Array<{ status: string }> })
    .acknowledgements[0]?.status).toBe("duplicate");

  const [rawAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
  const [readoutAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
  const [outcomeAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.deviceIngestOutcomes)
    .innerJoin(schema.rawDeviceMessages, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
    .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
  const [revisionAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
  expect({ raw: rawAfter?.value, readouts: readoutAfter?.value,
    outcomes: outcomeAfter?.value, revisions: revisionAfter?.value })
    .toEqual({ raw: 1, readouts: 1, outcomes: 1, revisions: 1 });
});

test("engångsparning provisionerar en credential som autentiserar paket och idempotent ingest", async ({ request }) => {
  const raceId = await createImportedRace(request);
  const deviceId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const credentialSecret = Buffer.alloc(32, 83);
  const credentialSecretHash = createHash("sha256").update(credentialSecret).digest("hex");
  const grant = await issueStationPairingGrant(e2eDatabase.db, {
    raceId,
    scope: "READOUT",
    expiresAt: new Date(Date.now() + 10 * 60_000),
    credentialExpiresAt: new Date(Date.now() + 60 * 60_000)
  });
  const pairingBody = { formatVersion: 1, attemptId, deviceId, credentialSecretHash };
  const pairingHeaders = {
    authorization: `Bearer ${grant.token}`,
    "idempotency-key": `pairing:${attemptId}`
  };

  const paired = await request.post("/api/station-pairing/redeem", {
    headers: pairingHeaders,
    data: pairingBody
  });
  expect(paired.status()).toBe(200);
  expect(paired.headers()["cache-control"]).toContain("no-store");
  const pairedResponse = await paired.json() as {
    formatVersion: number;
    attemptId: string;
    credential: {
      credentialId: string;
      deviceId: string;
      raceId: string;
      scope: string;
      generation: number;
    };
  };
  expect(pairedResponse).toMatchObject({
    formatVersion: 1,
    attemptId,
    credential: { deviceId, raceId, scope: "READOUT", generation: 1 }
  });

  const replay = await request.post("/api/station-pairing/redeem", {
    headers: pairingHeaders,
    data: pairingBody
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(pairedResponse);

  const credentialToken = `otid_stn_v1.${pairedResponse.credential.credentialId}.` +
    credentialSecret.toString("base64url");
  const packageResponse = await request.get(`/api/races/${raceId}/station-package`, {
    headers: { authorization: `Bearer ${credentialToken}` }
  });
  expect(packageResponse.status()).toBe(200);

  const payload = {
    cardNumber: "12345",
    startPunchedAt: new Date(Date.now() - 60_000).toISOString(),
    finishPunchedAt: new Date().toISOString(),
    punches: []
  };
  const contentHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const batch = {
    deviceId,
    sessionId: deviceId,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{
      localSequence: 1,
      stationReceivedAt: new Date().toISOString(),
      transport: "simulator",
      payload,
      contentHash
    }]
  };
  const ingestHeaders = {
    authorization: `Bearer ${credentialToken}`,
    "idempotency-key": `${deviceId}:1:1`
  };
  const stored = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: ingestHeaders,
    data: batch
  });
  expect(stored.status()).toBe(200);
  expect((await stored.json() as { acknowledgements: Array<{ status: string }> })
    .acknowledgements[0]?.status).toBe("stored");
  const duplicate = await request.post(`/api/races/${raceId}/device-batches`, {
    headers: ingestHeaders,
    data: batch
  });
  expect(duplicate.status()).toBe(200);
  expect((await duplicate.json() as { acknowledgements: Array<{ status: string }> })
    .acknowledgements[0]?.status).toBe("duplicate");

  const [rawCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
  const [credentialCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.stationCredentials)
    .where(eq(schema.stationCredentials.id, pairedResponse.credential.credentialId));
  const [redemptionCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.stationPairingRedemptions)
    .where(eq(schema.stationPairingRedemptions.grantId, grant.grantId));
  expect({ raw: rawCount?.value, credentials: credentialCount?.value, redemptions: redemptionCount?.value })
    .toEqual({ raw: 1, credentials: 1, redemptions: 1 });
});

test("pairing-routen avvisar före body och rate-limit skriver högst fem fel", async ({ request }) => {
  const raceId = await createImportedRace(request);
  const deviceId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const grant = await issueStationPairingGrant(e2eDatabase.db, {
    raceId,
    scope: "READOUT",
    expiresAt: new Date(Date.now() + 10 * 60_000),
    credentialExpiresAt: new Date(Date.now() + 60 * 60_000)
  });

  const unauthenticated = await request.post("/api/station-pairing/redeem", {
    headers: { "content-type": "application/json" },
    data: "inte-json"
  });
  expect(unauthenticated.status()).toBe(401);
  expect(await unauthenticated.json()).toEqual({ error: "Parningen kunde inte genomföras" });

  const wrongToken = `otid_pair_v1.${grant.grantId}.${Buffer.alloc(32, 99).toString("base64url")}`;
  const body = {
    formatVersion: 1,
    attemptId,
    deviceId,
    credentialSecretHash: createHash("sha256").update(Buffer.alloc(32, 84)).digest("hex")
  };
  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await request.post("/api/station-pairing/redeem", {
      headers: {
        authorization: `Bearer ${wrongToken}`,
        "idempotency-key": `pairing:${attemptId}`
      },
      data: body
    });
    statuses.push(response.status());
    expect(await response.json()).toEqual({ error: "Parningen kunde inte genomföras" });
  }
  expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
  const attempts = await e2eDatabase.db.select().from(schema.stationPairingAttempts)
    .where(eq(schema.stationPairingAttempts.grantId, grant.grantId));
  expect(attempts).toHaveLength(5);
  expect(attempts.every((attempt) =>
    attempt.outcome === "AUTH_FAILED" && attempt.attemptId === null && attempt.deviceId === null)).toBe(true);
  expect(await e2eDatabase.db.select().from(schema.stationCredentials)
    .where(eq(schema.stationCredentials.raceId, raceId))).toHaveLength(0);
});

test("tävlingsöversikten lämnar inget före auth och rensar minnesdata före bekräftad logout", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const access = await issueRaceOverviewAdminAccess(raceId);

  const protectedBeforeLogin = await page.request.get(`/api/admin/races/${raceId}/overview`);
  expect(protectedBeforeLogin.status()).toBe(401);
  const unauthorizedBody = await protectedBeforeLogin.text();
  expect(unauthorizedBody).toBe('{"formatVersion":1,"error":"UNAUTHORIZED"}');
  expect(unauthorizedBody).not.toMatch(/Ada|12345|CourseData|EntryList/);

  const pageResponse = await page.goto(`/admin/${raceId}`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await pageResponse?.text();
  expect(shell).toContain("Skyddad tävlingsöversikt");
  expect(shell).not.toMatch(/Ada|12345|Stationssimulator|CourseData|EntryList/);

  await page.getByLabel("Accesscredential för tävlingsöversikt").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: /E2E .* – Individuellt/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aggregerade antal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Para station" })).toBeVisible();
  await expect(page.getByText("Ada Löpare")).toHaveCount(0);
  await expect(page.getByText("12345")).toHaveCount(0);

  const dtoResponse = await page.request.get(`/api/admin/races/${raceId}/overview`);
  expect(dtoResponse.status()).toBe(200);
  const dtoText = await dtoResponse.text();
  expect(dtoText).not.toMatch(/Ada|12345|originalXml|rawPayload|evaluation|contentHash/);
  const dto = JSON.parse(dtoText) as { formatVersion: number; race: { id: string }; counts: { entries: number } };
  expect(dto).toMatchObject({ formatVersion: 1, race: { id: raceId }, counts: { entries: 2 } });

  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name === "otid_race_overview_session" && cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "otid_race_overview_csrf" && !cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => /pairing_admin|import_admin|entry_class_admin|recalculation_admin/.test(cookie.name))).toBe(false);
  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain("E2E");

  let abortLogout = true;
  const logoutPattern = `**/api/admin/races/${raceId}/overview-session`;
  await page.route(logoutPattern, async (route) => {
    if (route.request().method() === "DELETE" && abortLogout) {
      abortLogout = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Logga ut från översikten" }).click();
  await expect(page.getByRole("heading", { name: "Utloggningen är inte bekräftad" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /E2E .* – Individuellt/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Försök logga ut igen" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_race_overview_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_race_overview_csrf")).toBe(false);
});

test("avläsningshistoriken visar normaliserad data, förklaringskod och hela revisionskedjan", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const knownPayload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [31, 32, 33].map((code, index) => ({
      code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z`
    }))
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId, sessionId: deviceId, packageVersion: 3, firstSequence: 1, lastSequence: 2,
    events: [knownPayload, { ...knownPayload, cardNumber: "999999" }].map((payload, index) => ({
      localSequence: index + 1,
      stationReceivedAt: `2026-08-30T10:4${index + 1}:00Z`,
      transport: "simulator" as const,
      payload,
      contentHash: contentHash(payload)
    }))
  });
  const [ada] = await e2eDatabase.db.select({ id: schema.entries.id }).from(schema.entries)
    .innerJoin(schema.cardAssignments, eq(schema.entries.id, schema.cardAssignments.entryId))
    .where(and(eq(schema.entries.raceId, raceId), eq(schema.cardAssignments.cardNumber, "12345")));
  if (!ada) throw new Error("E2E-fixturen saknar Ada");
  await recalculateEntry(e2eDatabase.db, raceId, ada.id);
  const access = await issueReadoutResultHistoryAdminAccess(raceId);

  const protectedBeforeLogin = await page.request.get(`/api/admin/races/${raceId}/readouts`);
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).toBe('{"formatVersion":1,"error":"UNAUTHORIZED"}');

  const pageResponse = await page.goto(`/admin/${raceId}/history`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  const shell = await pageResponse?.text();
  expect(shell).toContain("Skyddade avläsningar och resultathistorik");
  expect(shell).not.toMatch(/Ada Löpare|12345|999999|MISSING_CONTROL|CARD_READOUT/);

  await page.getByLabel("Accesscredential för avläsningshistorik").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Normaliserade avläsningar" })).toBeVisible();
  const knownCard = page.locator("article").filter({ hasText: "Bricka: 12345" });
  const unknownCard = page.locator("article").filter({ hasText: "Bricka: 999999" });
  await expect(knownCard).toContainText("Ada Löpare");
  await expect(knownCard).toContainText("OK · COMPLETE – Godkänt resultat");
  await expect(unknownCard).toContainText("UNKNOWN_CARD · UNKNOWN_CARD");

  await knownCard.getByRole("button", { name: "Visa avläsning och historik" }).click();
  const detail = page.getByLabel("Vald avläsning och revisionskedja");
  await expect(detail).toContainText("Normaliserade stämplingar");
  await expect(detail).toContainText("31");
  await expect(detail).toContainText("CARD_READOUT");
  await expect(detail).toContainText("CLASS_CHANGE_RECALCULATION");
  await expect(detail.locator(".readout-history-revision")).toHaveCount(2);

  await unknownCard.getByRole("button", { name: "Visa avläsning och historik" }).click();
  await expect(detail).toContainText("Ingen resultatrevision finns för denna avläsning.");
  await expect(detail.locator(".readout-history-revision")).toHaveCount(0);

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_readout_result_history_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_readout_result_history_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain("Ada Löpare");

  await page.getByRole("button", { name: "Logga ut från historiken" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  await expect(page.getByText("Ada Löpare")).toHaveCount(0);
});

test("resultatexporten skyddar, verifierar och laddar ner ett deterministiskt IOF Snapshot", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [31, 32, 33].map((code, index) => ({
      code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z`
    }))
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId,
    sessionId: deviceId,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{
      localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z",
      transport: "simulator",
      payload,
      contentHash: contentHash(payload)
    }]
  });
  const access = await issueIofResultListExportAdminAccess(raceId);
  const downloadUrl = `/api/admin/races/${raceId}/exports/result-list.xml`;

  const protectedBeforeLogin = await page.request.get(downloadUrl);
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).toBe('{"formatVersion":1,"error":"UNAUTHORIZED"}');

  const pageResponse = await page.goto(`/admin/${raceId}/exports`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await pageResponse?.text();
  expect(shell).toContain("Skyddad IOF ResultList-export");
  expect(shell).not.toMatch(/Ada Löpare|12345|entry-ada|class-h21|<ResultList/);

  await page.getByLabel("Accesscredential för IOF ResultList-export").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "IOF XML 3.0 ResultList" })).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_result_list_export_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_result_list_export_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.some((cookie) => /pairing_admin|import_admin|race_overview/.test(cookie.name))).toBe(false);

  const directExport = await page.request.get(downloadUrl);
  expect(directExport.status()).toBe(200);
  expect(directExport.headers()["content-type"]).toBe("application/xml; charset=utf-8");
  expect(directExport.headers()["content-disposition"])
    .toBe(`attachment; filename="otid-result-list-${raceId}.xml"`);
  expect(directExport.headers()["cache-control"]).toContain("no-store");
  expect(directExport.headers()["x-content-type-options"]).toBe("nosniff");
  expect(directExport.headers()["etag"]).toMatch(/^"sha256-[a-f0-9]{64}"$/);
  expect(directExport.headers()["x-otid-result-count"]).toBe("1");
  expect(directExport.headers()["x-otid-omitted-entry-count"]).toBe("1");
  const directBytes = await directExport.body();
  expect(Number(directExport.headers()["content-length"])).toBe(directBytes.byteLength);
  expect(directExport.headers()["x-otid-content-sha256"])
    .toBe(createHash("sha256").update(directBytes).digest("hex"));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ladda ner ResultList.xml" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`otid-result-list-${raceId}.xml`);
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error("Playwright gav ingen sökväg till ResultList-exporten");
  const xml = await readFile(downloadedPath, "utf8");
  expect(xml).toContain('<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="O-Tid" status="Snapshot">');
  expect(xml).toContain("<Id>class-h21</Id>");
  expect(xml).toContain("<EntryId>entry-ada</EntryId>");
  expect(xml).toContain("<Family>Löpare</Family>");
  expect(xml).toContain("<Given>Ada</Given>");
  expect(xml).toContain("<TimeBehind>0</TimeBehind>");
  expect(xml).toContain("<Position>1</Position>");
  expect(xml).toContain("<Status>OK</Status>");
  expect(xml).toContain("<ControlCode>31</ControlCode>");
  expect(xml).not.toContain(raceId);
  expect(xml).not.toContain("12345");
  expect(xml.indexOf("<Time>2400</Time>")).toBeLessThan(xml.indexOf("<TimeBehind>0</TimeBehind>"));
  expect(xml.indexOf("<TimeBehind>0</TimeBehind>")).toBeLessThan(xml.indexOf("<Position>1</Position>"));
  expect(xml.indexOf("<Position>1</Position>")).toBeLessThan(xml.indexOf("<Status>OK</Status>"));
  expect(xml).not.toMatch(/createTime=|<Status>DidNotStart<\/Status>/);

  const metadata = page.getByLabel("IOF XML 3.0 ResultList");
  await expect(metadata).toContainText("Publicerade resultat");
  await expect(metadata).toContainText("Entries utan publicerat resultat");
  await expect(metadata.locator("dd").nth(2)).toHaveText("1");
  await expect(metadata.locator("dd").nth(4)).toHaveText("1");
  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain("Ada Löpare");
  expect(storage).not.toContain("<ResultList");

  await page.getByRole("button", { name: "Logga ut från exporten" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_result_list_export_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_result_list_export_csrf")).toBe(false);
});

test("pairingadmin utfärdar, spärrar och visar en engångstoken utan beständig hemlighet", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const access = await issuePairingAdminAccess(raceId);
  const pageResponse = await page.goto(`/admin/${raceId}/pairing`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);

  await page.getByLabel("Accesscredential").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Utfärda engångsgrant" })).toBeVisible();
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "otid_pairing_admin_session");
  const csrfCookie = cookies.find((cookie) => cookie.name === "otid_pairing_admin_csrf");
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(csrfCookie).toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  await page.getByRole("button", { name: "Utfärda engångsgrant" }).click();
  const tokenOutput = page.getByLabel("Fullständig pairingtoken");
  await expect(tokenOutput).toBeVisible();
  const firstToken = (await tokenOutput.textContent()) ?? "";
  expect(firstToken).toMatch(/^otid_pair_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  const firstGrantId = firstToken.split(".")[1] ?? "";
  expect(page.url()).not.toContain(firstToken);
  const browserStorage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(browserStorage).not.toContain(firstToken);
  expect(browserStorage).not.toContain(access.accessCredential);

  await page.reload();
  await expect(page.getByLabel("Fullständig pairingtoken")).toHaveCount(0);
  const firstGrant = page.locator("article").filter({ hasText: firstGrantId });
  await expect(firstGrant).toContainText("Giltigt");
  page.once("dialog", (dialog) => void dialog.accept());
  await firstGrant.getByRole("button", { name: "Spärra grant" }).click();
  await expect(firstGrant).toContainText("Spärrat");

  await page.getByRole("button", { name: "Utfärda engångsgrant" }).click();
  await expect(tokenOutput).toBeVisible();
  const secondToken = (await tokenOutput.textContent()) ?? "";
  const [, secondGrantId, secondGrantSecret] = secondToken.split(".");
  if (!secondGrantId || !secondGrantSecret) throw new Error("Pairingtokenen är ofullständig");
  const credentialSecret = Buffer.alloc(32, 131);
  const attemptId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const redemption = await request.post("/api/station-pairing/redeem", {
    headers: {
      authorization: `Bearer ${secondToken}`,
      "idempotency-key": `pairing:${attemptId}`
    },
    data: {
      formatVersion: 1,
      attemptId,
      deviceId,
      credentialSecretHash: createHash("sha256").update(credentialSecret).digest("hex")
    }
  });
  expect(redemption.status()).toBe(200);
  const redemptionBody = await redemption.json() as { credential: { credentialId: string } };
  await page.getByRole("button", { name: "Uppdatera lista" }).click();
  const secondGrant = page.locator("article").filter({ hasText: secondGrantId });
  await expect(secondGrant).toContainText("Inlöst");
  await expect(secondGrant.getByRole("button", { name: "Spärra grant" })).toHaveCount(0);

  const stationToken = `otid_stn_v1.${redemptionBody.credential.credentialId}.${credentialSecret.toString("base64url")}`;
  const stationPackage = await request.get(`/api/races/${raceId}/station-package`, {
    headers: { authorization: `Bearer ${stationToken}` }
  });
  expect(stationPackage.status()).toBe(200);

  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_pairing_admin_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_pairing_admin_csrf")).toBe(false);
});

test("pairingadmin avvisar CSRF, fel Origin och fel lopp före grantmutation", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const otherRaceId = await createImportedRace(request);
  const access = await issuePairingAdminAccess(raceId);
  await page.goto(`/admin/${raceId}/pairing`);
  await page.getByLabel("Accesscredential").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Utfärda engångsgrant" })).toBeVisible();

  const [beforeGrantCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.stationPairingGrants).where(eq(schema.stationPairingGrants.raceId, raceId));
  const [beforeAuditCount] = await e2eDatabase.db.select({ value: count() }).from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.action, "STATION_PAIRING_GRANT_ISSUED_BY_ADMIN")
  ));

  const missingCsrfStatus = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "inte-json"
    });
    return response.status;
  }, `/api/admin/races/${raceId}/pairing-grants`);
  expect(missingCsrfStatus).toBe(403);

  const wrongRace = await page.request.get(`/api/admin/races/${otherRaceId}/pairing-grants`);
  expect(wrongRace.status()).toBe(403);

  const currentCookies = await page.context().cookies();
  const cookieHeader = currentCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const csrf = currentCookies.find((cookie) => cookie.name === "otid_pairing_admin_csrf")?.value;
  if (!csrf) throw new Error("CSRF-cookie saknas");
  const wrongOriginGrantId = crypto.randomUUID();
  const wrongOrigin = await request.post(`/api/admin/races/${raceId}/pairing-grants`, {
    headers: {
      cookie: cookieHeader,
      origin: "https://angripare.example",
      "x-otid-csrf": csrf,
      "idempotency-key": `pairing-grant:${wrongOriginGrantId}`
    },
    data: {
      formatVersion: 1,
      grantId: wrongOriginGrantId,
      grantSecretHash: "f".repeat(64),
      credentialLifetimeHours: 24
    }
  });
  expect(wrongOrigin.status()).toBe(403);

  const [afterGrantCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.stationPairingGrants).where(eq(schema.stationPairingGrants.raceId, raceId));
  const [afterAuditCount] = await e2eDatabase.db.select({ value: count() }).from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.action, "STATION_PAIRING_GRANT_ISSUED_BY_ADMIN")
  ));
  expect(afterGrantCount?.value).toBe(beforeGrantCount?.value);
  expect(afterAuditCount?.value).toBe(beforeAuditCount?.value);
});

test("importadmin återupptar okänd commit med samma request och håller hemligheter i minnet", async ({ page, request }) => {
  const raceId = await createEmptyRace(request);
  const access = await issueImportAdminAccess(raceId);
  const pageResponse = await page.goto(`/admin/${raceId}/imports`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);

  await page.getByLabel("Accesscredential för import").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Välj IOF XML-fil" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_import_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_import_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.some((cookie) => cookie.name.includes("pairing_admin"))).toBe(false);

  const importPattern = `**/api/races/${raceId}/imports`;
  let intercepted = false;
  await page.route(importPattern, async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByLabel("IOF XML 3.0").setInputFiles(resolve("fixtures/iof/course-data.xml"));
  await page.getByRole("button", { name: "Importera atomärt" }).click();
  await expect(page.locator(".pairing-message"))
    .toContainText("Samma fil, hash och request-id finns kvar endast i denna flik");
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Importstatusen är inte bekräftad");
  const retainedRequestId = (await retained.locator("dd").nth(1).textContent())?.trim();
  expect(retainedRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.unroute(importPattern);
  await page.getByRole("button", { name: "Försök igen med samma import" }).click();
  await expect(page.getByRole("heading", { name: /Importen är bekräftad/ })).toBeVisible();
  await expect(page.locator(".import-result")).toContainText("2 banor och 2 klasser");
  await expect(retained).toHaveCount(0);

  await page.getByLabel("IOF XML 3.0").setInputFiles(resolve("fixtures/iof/entry-list.xml"));
  await page.getByRole("button", { name: "Importera atomärt" }).click();
  await expect(page.locator(".import-result")).toContainText("2 deltagare");

  await page.getByLabel("IOF XML 3.0").setInputFiles(resolve("fixtures/iof/start-list.xml"));
  await page.getByRole("button", { name: "Importera atomärt" }).click();
  await expect(page.locator(".import-result")).toContainText("1 startklasser och 2 starttider");
  await expect(page.locator(".import-result")).toContainText("1 klasser och 2 deltagare ändrades");
  await expect(page.locator(".import-result")).toContainText("Inga resultat räknades om automatiskt");

  const [h21] = await e2eDatabase.db.select().from(schema.classes).where(and(
    eq(schema.classes.raceId, raceId),
    eq(schema.classes.externalId, "class-h21")
  ));
  const importedEntries = await e2eDatabase.db.select().from(schema.entries)
    .where(eq(schema.entries.raceId, raceId));
  const [revisionCount] = await e2eDatabase.db.select({ value: count() })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
  expect(h21?.startRule).toBe("FIXED");
  expect(importedEntries.map((entry) => entry.fixedStartTime?.toISOString()).sort()).toEqual([
    "2026-08-31T08:00:00.000Z",
    "2026-08-31T08:03:00.000Z"
  ]);
  expect(revisionCount?.value).toBe(0);

  const importRequests = await e2eDatabase.db.select().from(schema.iofImportRequests)
    .where(eq(schema.iofImportRequests.raceId, raceId));
  const imports = await e2eDatabase.db.select().from(schema.importFiles)
    .where(eq(schema.importFiles.raceId, raceId));
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
  ));
  expect(importRequests).toHaveLength(3);
  expect(imports).toHaveLength(3);
  expect(audits).toHaveLength(3);
  expect(importRequests.some((item) => item.requestId === retainedRequestId)).toBe(true);

  expect(page.url()).not.toContain(access.accessCredential);
  const browserStorage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(browserStorage).not.toContain(access.accessCredential);
  expect(browserStorage).not.toContain("CourseData");
  expect(browserStorage).not.toContain("EntryList");
  expect(browserStorage).not.toContain("StartList");

  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_import_admin_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_import_admin_csrf")).toBe(false);
});

test("klassadmin återupptar okänd commit utan dubbel ändring eller resultatomräkning", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const access = await issueEntryClassAdminAccess(raceId);
  const [adaBefore] = await e2eDatabase.db.select().from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId),
    eq(schema.entries.givenName, "Ada")
  ));
  const [targetClass] = await e2eDatabase.db.select().from(schema.classes).where(and(
    eq(schema.classes.raceId, raceId),
    eq(schema.classes.name, "D21")
  ));
  const [raceBefore] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  const [revisionsBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
  if (!adaBefore || !targetClass || !raceBefore) throw new Error("E2E-fixturen saknar klassdata");

  const protectedBeforeLogin = await page.request.get(`/api/admin/races/${raceId}/entry-classes`);
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).not.toContain("Ada");

  const pageResponse = await page.goto(`/admin/${raceId}/classes`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  await page.getByLabel("Accesscredential för klassändring").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Deltagare och klasser" })).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_entry_class_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_entry_class_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.some((cookie) => cookie.name.includes("pairing_admin") || cookie.name.includes("import_admin"))).toBe(false);

  await page.evaluate(({ race, entry }) => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalFetch = originalFetch;
    let dropped = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await originalFetch(input, init);
      if (!dropped && url.includes(`/api/races/${race}/entries/${entry}/class`)) {
        dropped = true;
        throw new TypeError("Simulerat tappat svar efter commit");
      }
      return response;
    };
  }, { race: raceId, entry: adaBefore.id });
  const adaCard = page.locator("article.entry-class-entry").filter({ hasText: "Ada Löpare" });
  await adaCard.getByLabel("Ny klass").selectOption({ label: "D21" });
  await adaCard.getByRole("button", { name: "Ändra klass" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Klassändringens status är inte bekräftad");
  const retainedRequestId = (await retained.locator("dd").nth(1).textContent())?.trim();
  expect(retainedRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    if (testWindow.__otidOriginalFetch) window.fetch = testWindow.__otidOriginalFetch;
    delete testWindow.__otidOriginalFetch;
  });
  await page.getByRole("button", { name: "Försök igen med samma klassändring" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Det tidigare klassbytet bekräftades med samma request-id");
  await expect(retained).toHaveCount(0);
  await expect(adaCard).toContainText("Nuvarande klass: D21");

  const [adaAfter] = await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.id, adaBefore.id));
  const [raceAfter] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  const requests = await e2eDatabase.db.select().from(schema.entryClassChangeRequests).where(and(
    eq(schema.entryClassChangeRequests.raceId, raceId),
    eq(schema.entryClassChangeRequests.entryId, adaBefore.id)
  ));
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
  ));
  const [revisionsAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
  expect(adaAfter).toMatchObject({ classId: targetClass.id, version: adaBefore.version + 1 });
  expect(raceAfter?.snapshotVersion).toBe(raceBefore.snapshotVersion + 1);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.requestId).toBe(retainedRequestId);
  expect(audits).toHaveLength(1);
  expect(revisionsAfter?.value).toBe(revisionsBefore?.value);

  expect(page.url()).not.toContain(access.accessCredential);
  const browserStorage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(browserStorage).not.toContain(access.accessCredential);
  expect(browserStorage).not.toContain(retainedRequestId);

  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_entry_class_admin_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_entry_class_admin_csrf")).toBe(false);
});

test("omräkningsadmin återupptar okänd commit utan dubbel revision eller ändrade indata", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  await page.goto(`/admin/${raceId}/simulator`);
  await installSimulatorCredential(page, raceId);
  await page.getByLabel("Bricknummer").fill("12345");
  await page.getByLabel("Kontrollkoder, kommaseparerade").fill("31,32,33");
  await page.getByRole("button", { name: "Simulera och skicka" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Serverkvittens" })).toContainText("stored");

  const access = await issueResultRecalculationAdminAccess(raceId);
  const [adaBefore] = await e2eDatabase.db.select().from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId),
    eq(schema.entries.givenName, "Ada")
  ));
  const [raceBefore] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  if (!adaBefore || !raceBefore) throw new Error("E2E-fixturen saknar deltagare eller lopp");
  const [revisionCountBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, adaBefore.id));
  const [rawCountBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId));
  const [readoutCountBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));

  const protectedBeforeLogin = await page.request.get(`/api/admin/races/${raceId}/recalculation-candidates`);
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).not.toContain("Ada");

  const pageResponse = await page.goto(`/admin/${raceId}/recalculation`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  await page.getByLabel("Omräkningsnyckel").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Deltagare för omräkning" })).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_recalculation_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_recalculation_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.some((cookie) => cookie.name.includes("pairing_admin") ||
    cookie.name.includes("import_admin") || cookie.name.includes("entry_class_admin"))).toBe(false);

  await page.evaluate(({ race, entry }) => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalFetch = originalFetch;
    let dropped = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await originalFetch(input, init);
      if (!dropped && url.includes(`/api/races/${race}/entries/${entry}/recalculate`)) {
        dropped = true;
        throw new TypeError("Simulerat tappat svar efter omräkningscommit");
      }
      return response;
    };
  }, { race: raceId, entry: adaBefore.id });
  const adaCard = page.locator("article.result-recalculation-entry").filter({ hasText: "Ada Löpare" });
  await adaCard.getByRole("button", { name: "Räkna om och publicera ny revision" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Omräkningens status är inte bekräftad");
  const retainedRequestId = (await retained.locator("dd").nth(1).textContent())?.trim();
  expect(retainedRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    if (testWindow.__otidOriginalFetch) window.fetch = testWindow.__otidOriginalFetch;
    delete testWindow.__otidOriginalFetch;
  });
  await page.getByRole("button", { name: "Försök igen med samma omräkning" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Den tidigare omräkningen bekräftades med samma request-id");
  await expect(retained).toHaveCount(0);

  const [adaAfter] = await e2eDatabase.db.select().from(schema.entries).where(eq(schema.entries.id, adaBefore.id));
  const [raceAfter] = await e2eDatabase.db.select().from(schema.races).where(eq(schema.races.id, raceId));
  const recalculationRequests = await e2eDatabase.db.select().from(schema.resultRecalculationRequests).where(and(
    eq(schema.resultRecalculationRequests.raceId, raceId),
    eq(schema.resultRecalculationRequests.entryId, adaBefore.id)
  ));
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.action, "RESULT_RECALCULATED_BY_ADMIN")
  ));
  const revisions = await e2eDatabase.db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.entryId, adaBefore.id));
  const [rawCountAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId));
  const [readoutCountAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
  expect(adaAfter).toMatchObject({ classId: adaBefore.classId, version: adaBefore.version });
  expect(raceAfter?.snapshotVersion).toBe(raceBefore.snapshotVersion);
  expect(recalculationRequests).toHaveLength(1);
  expect(recalculationRequests[0]?.requestId).toBe(retainedRequestId);
  expect(audits).toHaveLength(1);
  expect(revisions).toHaveLength((revisionCountBefore?.value ?? 0) + 1);
  expect(revisions.filter((revision) => revision.cause === "EXPLICIT_RECALCULATION")).toHaveLength(1);
  expect(rawCountAfter?.value).toBe(rawCountBefore?.value);
  expect(readoutCountAfter?.value).toBe(readoutCountBefore?.value);

  expect(page.url()).not.toContain(access.accessCredential);
  const browserStorage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(browserStorage).not.toContain(access.accessCredential);
  expect(browserStorage).not.toContain(retainedRequestId);

  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByRole("button", { name: "Logga in säkert" })).toBeVisible();
  const cookiesAfterLogout = await page.context().cookies();
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_recalculation_admin_session")).toBe(false);
  expect(cookiesAfterLogout.some((cookie) => cookie.name === "otid_recalculation_admin_csrf")).toBe(false);
});

test("resultatfinalisering fryser full täckning och exporterar oföränderliga IOF Complete-bytes", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  for (const [index, cardNumber] of ["12345", "67890"].entries()) {
    const payload = {
      cardNumber,
      startPunchedAt: `2026-08-30T1${index}:00:00Z`,
      finishPunchedAt: `2026-08-30T1${index}:40:00Z`,
      punches: [31, 32, 33].map((code, punchIndex) => ({
        code,
        punchedAt: `2026-08-30T1${index}:${10 + punchIndex * 10}:00Z`
      }))
    };
    const deviceId = crypto.randomUUID();
    await ingestDeviceBatch(e2eDatabase.db, raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 1,
      events: [{
        localSequence: 1,
        stationReceivedAt: `2026-08-30T1${index}:41:00Z`,
        transport: "simulator",
        payload,
        contentHash: contentHash(payload)
      }]
    });
  }

  const access = await issueResultFinalizationAdminAccess(raceId);
  const protectedBeforeLogin = await page.request.get(
    `/api/admin/races/${raceId}/result-finalizations/candidates`
  );
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const pageResponse = await page.goto(`/admin/${raceId}/finalization`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await pageResponse?.text();
  expect(shell).toContain("Finalisera individuella resultat");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Finaliseringsnyckel").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Aktuellt finaliseringsunderlag" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_finalization_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_finalization_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  const classScope = page.locator("article.result-finalization-scope").filter({ hasText: "H21" });
  await expect(classScope).toContainText("Klassen kan frysas");
  await classScope.getByRole("button", { name: "Frys klassen" }).click();
  await expect(page.getByRole("status")).toContainText("Finaliseringen skapades");
  const raceButton = page.getByRole("button", { name: "Frys loppet som IOF Complete" });
  await expect(raceButton).toBeEnabled();
  await raceButton.click();
  await expect(page.getByRole("status")).toContainText("Finaliseringen skapades");

  const saved = await e2eDatabase.db.select().from(schema.resultFinalizations)
    .where(eq(schema.resultFinalizations.raceId, raceId));
  expect(saved).toHaveLength(2);
  const raceFinalization = saved.find((row) => row.scope === "RACE");
  expect(raceFinalization).toMatchObject({ scopeRevision: 1, completeXmlHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  if (!raceFinalization) throw new Error("E2E saknar loppsfinalisering");
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.entityType, "result_finalization")
  ));
  expect(audits).toHaveLength(2);

  await page.getByRole("button", { name: "Logga ut från finalisering" }).click();
  const exportAccess = await issueIofResultListExportAdminAccess(raceId);
  await page.goto(`/admin/${raceId}/exports`);
  await expect(page.getByRole("status"))
    .toContainText("Inloggning med ResultList-exportbehörighet krävs");
  await page.getByLabel("Accesscredential för IOF ResultList-export").fill(exportAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByText("Loppsfinalisering 1")).toBeVisible();

  const live = await page.request.get(`/api/admin/races/${raceId}/exports/result-list.xml`);
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain('status="Snapshot"');
  const frozenUrl = `/api/admin/races/${raceId}/exports/final-result-lists/${raceFinalization.id}`;
  const frozen = await page.request.get(frozenUrl);
  expect(frozen.status()).toBe(200);
  const frozenBytes = await frozen.body();
  const completeXml = frozenBytes.toString("utf8");
  expect(completeXml).toContain('status="Complete"');
  expect(completeXml.match(/<PersonResult>/g)).toHaveLength(2);
  expect(completeXml).toContain("<Status>OK</Status>");
  expect(completeXml).not.toContain(raceFinalization.id);
  expect(frozen.headers()["x-otid-content-sha256"])
    .toBe(createHash("sha256").update(frozenBytes).digest("hex"));

  const [ada] = await e2eDatabase.db.select().from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId),
    eq(schema.entries.givenName, "Ada")
  ));
  if (!ada) throw new Error("E2E-fixturen saknar Ada");
  await e2eDatabase.db.update(schema.entries).set({ givenName: "Ändrad" }).where(eq(schema.entries.id, ada.id));
  const frozenAgain = await page.request.get(frozenUrl);
  expect(await frozenAgain.body()).toEqual(frozenBytes);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ladda ner fryst Complete XML" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`otid-complete-result-list-${raceId}-r1.xml`);
  expect(page.url()).not.toContain(exportAccess.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain(exportAccess.accessCredential);
  expect(storage).not.toContain("<ResultList");
});

test("explicit ej-startbeslut återhämtar okänd commit och publicerar DNS utan hårdvarudata", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const access = await issueDidNotStartAdminAccess(raceId);
  const [rawBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId));
  const [readoutsBefore] = await e2eDatabase.db.select({ value: count() })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));

  const protectedBeforeLogin = await page.request.get(
    `/api/admin/races/${raceId}/did-not-start-candidates`
  );
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const pageResponse = await page.goto(`/admin/${raceId}/did-not-start`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await pageResponse?.text();
  expect(shell).toContain("Markera ej start");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Accesscredential för ej-startbeslut").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Deltagare utan tidigare resultat" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_did_not_start_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_did_not_start_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalFetch = originalFetch;
    let dropped = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await originalFetch(input, init);
      if (!dropped && url.includes(`/api/admin/races/${race}/entries/`) && url.endsWith("/did-not-start")) {
        dropped = true;
        throw new TypeError("Simulerat tappat svar efter ej-startcommit");
      }
      return response;
    };
  }, { race: raceId });
  const boCard = page.locator("article.did-not-start-entry").filter({ hasText: "Bo Skog" });
  await boCard.getByRole("button", { name: "Markera som ej startad" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Okänd commit-status");
  const retainedRequestId = (await retained.locator("dd").nth(1).textContent())?.trim();
  expect(retainedRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    if (testWindow.__otidOriginalFetch) window.fetch = testWindow.__otidOriginalFetch;
    delete testWindow.__otidOriginalFetch;
  });
  await page.getByRole("button", { name: "Försök igen med samma request-id" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Det tidigare ej-startbeslutet bekräftades med samma request-id");
  await expect(retained).toHaveCount(0);

  const decisions = await e2eDatabase.db.select().from(schema.didNotStartDecisions)
    .where(eq(schema.didNotStartDecisions.raceId, raceId));
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({ requestId: retainedRequestId, status: "DNS", reason: "DID_NOT_START" });
  const revisions = await e2eDatabase.db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.entryId, decisions[0]!.entryId));
  expect(revisions).toHaveLength(1);
  expect(revisions[0]).toMatchObject({
    revision: 1,
    cause: "MANUAL_DID_NOT_START",
    status: "DNS",
    reason: "DID_NOT_START",
    readoutId: null,
    didNotStartDecisionId: decisions[0]!.id
  });
  const audits = await e2eDatabase.db.select().from(schema.auditEvents).where(and(
    eq(schema.auditEvents.raceId, raceId),
    eq(schema.auditEvents.action, "DID_NOT_START_DECIDED")
  ));
  expect(audits).toHaveLength(1);
  const [rawAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId));
  const [readoutsAfter] = await e2eDatabase.db.select({ value: count() })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
  expect(rawAfter?.value).toBe(rawBefore?.value);
  expect(readoutsAfter?.value).toBe(readoutsBefore?.value);

  await page.goto(`/results/${raceId}`);
  const publicRow = page.getByRole("row").filter({ hasText: "Bo Skog" });
  await expect(publicRow).toContainText("Ej start");
  await expect(publicRow).toContainText("Markerad som ej startad av arrangör");
  const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
  const dns = publicBody.results.find((result) => result.status === "DNS");
  expect(dns).toMatchObject({ givenName: "Bo", familyName: "Skog", revision: 1, splits: [] });
  expect(dns).not.toHaveProperty("position");
  expect(dns).not.toHaveProperty("elapsedMs");

  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain(retainedRequestId);
});

test("explicit individuellt ej-fullföljt och separat återtagande bevarar tekniskt MP vid okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [
      { code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }
    ]
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId, sessionId: deviceId, packageVersion: 3, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }]
  });
  const access = await issueDidNotFinishAdminAccess(raceId);
  const protectedCandidates = await page.request.get(`/api/admin/races/${raceId}/did-not-finish-candidates`);
  expect(protectedCandidates.status()).toBe(401);
  expect(await protectedCandidates.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const adminPage = await page.goto(`/admin/${raceId}/did-not-finish`);
  expect(adminPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(adminPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await adminPage?.text();
  expect(shell).toContain("Markera ej fullföljt");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Nyckel för ej fullföljt").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Deltagare för ej fullföljt" })).toBeVisible();
  const candidate = page.locator("article.did-not-finish-entry").filter({ hasText: "Ada Löpare" });
  await expect(candidate).toContainText("Redo för DNF-beslut");
  await expect(candidate).toContainText("1 · MP");
  await expect(candidate).toContainText("Obligatorisk kontroll saknas");
  await candidate.getByRole("button", { name: "Granska DNF-beslut" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta ej fullföljt" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.didNotFinishDecisions)
    .where(eq(schema.didNotFinishDecisions.raceId, raceId))).toHaveLength(0);
  await page.getByRole("button", { name: "Ja, markera som ej fullföljt" }).click();
  await expect(page.getByRole("status")).toContainText("DNF-beslutet och den publicerade status-only revisionen skapades");

  const decisions = await e2eDatabase.db.select().from(schema.didNotFinishDecisions)
    .where(eq(schema.didNotFinishDecisions.raceId, raceId));
  expect(decisions).toHaveLength(1);
  const [revision] = await e2eDatabase.db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.id, decisions[0]!.createdResultRevisionId));
  expect(revision).toMatchObject({ cause: "MANUAL_DID_NOT_FINISH", status: "DNF", reason: "DID_NOT_FINISH", readoutId: null });

  await page.reload();
  await expect(page.locator("article.did-not-finish-entry").filter({ hasText: "Ada Löpare" }))
    .toContainText("ej-fullföljt-beslut är redan aktivt");
  await page.goto(`/results/${raceId}`);
  const publicRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(publicRow).toContainText("Ej fullföljt");
  await expect(publicRow).toContainText("Markerad som ej fullföljd av arrangör");
  await expect(publicRow).toContainText("–");
  const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
  const dnf = publicBody.results.find((result) => result.status === "DNF");
  expect(dnf).toMatchObject({ givenName: "Ada", familyName: "Löpare", status: "DNF", reason: "DID_NOT_FINISH", splits: [] });
  expect(dnf).not.toHaveProperty("position");
  expect(dnf).not.toHaveProperty("elapsedMs");

  const withdrawalAccess = await issueDidNotFinishWithdrawalAdminAccess(raceId);
  const [rawBeforeWithdrawal, readoutsBeforeWithdrawal] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))
  ]);
  const protectedWithdrawals = await page.request.get(
    `/api/admin/races/${raceId}/did-not-finish-withdrawals`
  );
  expect(protectedWithdrawals.status()).toBe(401);
  expect(await protectedWithdrawals.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const withdrawalPage = await page.goto(`/admin/${raceId}/did-not-finish-withdrawals`);
  expect(withdrawalPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(withdrawalPage?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(withdrawalPage?.headers()["x-frame-options"]).toBe("DENY");
  expect(withdrawalPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const withdrawalShell = await withdrawalPage?.text();
  expect(withdrawalShell).toContain("Återta ej fullföljt");
  expect(withdrawalShell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Behörighetskod för återtagande").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Behörighetskoden godkändes inte för detta lopp");
  await expect(page.getByRole("heading", { name: "Aktiva ej-fullföljt-beslut" })).toHaveCount(0);

  await page.getByLabel("Behörighetskod för återtagande").fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Aktiva ej-fullföljt-beslut" })).toBeVisible();
  const withdrawalCookies = await page.context().cookies();
  expect(withdrawalCookies.find((cookie) => cookie.name === "otid_did_not_finish_withdrawal_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(withdrawalCookies.find((cookie) => cookie.name === "otid_did_not_finish_withdrawal_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  const withdrawalCandidate = page.locator("article.did-not-finish-withdrawal-entry")
    .filter({ hasText: "Ada Löpare" });
  await expect(withdrawalCandidate).toContainText("Kan återtas");
  await expect(withdrawalCandidate).toContainText("DNF-revision: 2");
  await expect(withdrawalCandidate.locator(".did-not-finish-withdrawal-source")).toContainText("1 · MP");
  await expect(withdrawalCandidate.locator(".did-not-finish-withdrawal-source"))
    .toContainText("Obligatorisk kontroll saknas");
  await withdrawalCandidate.getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta återtagandet" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.didNotFinishWithdrawals)
    .where(eq(schema.didNotFinishWithdrawals.raceId, raceId))).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const withdrawalWindow = window as typeof window & {
      __otidOriginalDnfWithdrawalFetch?: typeof window.fetch;
      __otidDnfWithdrawalBody?: string | null;
      __otidDnfWithdrawalKey?: string | null;
      __otidDnfWithdrawalCount?: number;
    };
    const originalFetch = window.fetch.bind(window);
    withdrawalWindow.__otidOriginalDnfWithdrawalFetch = originalFetch;
    withdrawalWindow.__otidDnfWithdrawalCount = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/admin/races/${race}/entries/`) && url.endsWith("/did-not-finish-withdrawal") &&
          (init?.method ?? "GET").toUpperCase() === "POST") {
        const body = typeof init?.body === "string" ? init.body : null;
        const key = new Headers(init?.headers).get("idempotency-key");
        withdrawalWindow.__otidDnfWithdrawalCount = (withdrawalWindow.__otidDnfWithdrawalCount ?? 0) + 1;
        if (withdrawalWindow.__otidDnfWithdrawalCount === 1) {
          withdrawalWindow.__otidDnfWithdrawalBody = body;
          withdrawalWindow.__otidDnfWithdrawalKey = key;
          const response = await originalFetch(input, init);
          if (!response.ok) return response;
          throw new TypeError("Simulerat tappat svar efter DNF-återtagandecommit");
        }
        if (body !== withdrawalWindow.__otidDnfWithdrawalBody ||
            key !== withdrawalWindow.__otidDnfWithdrawalKey) {
          throw new TypeError("Uttrycklig retry ändrade DNF-återtagningsintent eller idempotency-key");
        }
      }
      return originalFetch(input, init);
    };
  }, { race: raceId });

  await page.getByRole("button", { name: "Ja, återta ej fullföljt" }).click();
  const retainedWithdrawal = page.locator("section[role='alert']");
  await expect(retainedWithdrawal).toContainText("Osäkert om återtagandet sparades");
  await expect(retainedWithdrawal).toContainText("Knappen nedan försöker igen");
  const withdrawalRequestId = (await retainedWithdrawal.locator("dd").nth(1).textContent())?.trim();
  expect(withdrawalRequestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Samma återtagande bekräftades genom idempotent återspelning");

  const [withdrawals, withdrawalAudits, rawAfterWithdrawal, readoutsAfterWithdrawal, revisionsAfterWithdrawal] =
    await Promise.all([
      e2eDatabase.db.select().from(schema.didNotFinishWithdrawals)
        .where(eq(schema.didNotFinishWithdrawals.raceId, raceId)),
      e2eDatabase.db.select().from(schema.auditEvents).where(and(
        eq(schema.auditEvents.raceId, raceId),
        eq(schema.auditEvents.action, "DID_NOT_FINISH_WITHDRAWN")
      )),
      e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
        .where(eq(schema.rawDeviceMessages.raceId, raceId)),
      e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
        .where(eq(schema.cardReadouts.raceId, raceId)),
      e2eDatabase.db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, decisions[0]!.entryId))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
  expect(withdrawals).toHaveLength(1);
  expect(withdrawals[0]).toMatchObject({
    requestId: withdrawalRequestId,
    didNotFinishDecisionId: decisions[0]!.id,
    withdrawnResultRevision: 2,
    expectedLatestResultRevision: 2,
    restoredFromResultRevision: 1,
    reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
    createdResultRevision: 3
  });
  expect(withdrawalAudits).toHaveLength(1);
  expect(revisionsAfterWithdrawal.map((item) => item.cause)).toEqual([
    "CARD_READOUT",
    "MANUAL_DID_NOT_FINISH",
    "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
  ]);
  expect(revisionsAfterWithdrawal[2]).toMatchObject({
    revision: 3,
    status: "MP",
    reason: "MISSING_CONTROL",
    readoutId: null,
    didNotFinishDecisionId: null,
    didNotFinishWithdrawalId: withdrawals[0]!.id
  });
  expect(revisionsAfterWithdrawal[2]?.evaluation).toEqual(revisionsAfterWithdrawal[0]?.evaluation);
  expect(rawAfterWithdrawal[0]?.value).toBe(rawBeforeWithdrawal[0]?.value);
  expect(readoutsAfterWithdrawal[0]?.value).toBe(readoutsBeforeWithdrawal[0]?.value);

  await page.reload();
  await expect(page.locator("article.did-not-finish-withdrawal-entry").filter({ hasText: "Ada Löpare" }))
    .toContainText("Redan återtaget");
  const restoredPublicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const restoredPublic = publicResultListResponseSchema.parse(await restoredPublicResponse.json());
  const restoredAda = restoredPublic.results.find((result) => result.givenName === "Ada");
  expect(restoredAda).toMatchObject({
    familyName: "Löpare",
    revision: 3,
    status: "MP",
    reason: "MISSING_CONTROL",
    rankingState: "NOT_RANKABLE_STATUS",
    missingControls: [32],
    extraPunches: []
  });
  await page.goto(`/results/${raceId}`);
  const restoredPublicRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(restoredPublicRow).toContainText("Felstämplad");
  await expect(restoredPublicRow).toContainText("Saknas: 32");

  expect(page.url()).not.toContain(access.accessCredential);
  expect(page.url()).not.toContain(withdrawalAccess.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain(withdrawalAccess.accessCredential);
  expect(storage).not.toContain(withdrawalRequestId);
}, 60_000);

test("explicit individuellt utan tidtagning är status-only och återhämtar okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [
      { code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 32, punchedAt: "2026-08-30T10:20:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }
    ]
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId,
    sessionId: deviceId,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{
      localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z",
      transport: "simulator",
      payload,
      contentHash: contentHash(payload)
    }]
  });
  const access = await issueWithoutTimingAdminAccess(raceId);
  const protectedCandidates = await page.request.get(`/api/admin/races/${raceId}/without-timing-candidates`);
  expect(protectedCandidates.status()).toBe(401);
  expect(await protectedCandidates.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const adminPage = await page.goto(`/admin/${raceId}/without-timing`);
  expect(adminPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(adminPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await adminPage?.text();
  expect(shell).toContain("Markera utan tidtagning");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Nyckel för utan tidtagning").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Deltagare för utan tidtagning" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_without_timing_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_without_timing_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  const candidate = page.locator("article.without-timing-entry").filter({ hasText: "Ada Löpare" });
  await expect(candidate).toContainText("Kan markeras utan tidtagning");
  await expect(candidate).toContainText("1 · OK");
  await expect(candidate).toContainText("Godkänt resultat");
  await candidate.getByRole("button", { name: "Granska beslut utan tidtagning" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta utan tidtagning" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.withoutTimingDecisions)
    .where(eq(schema.withoutTimingDecisions.raceId, raceId))).toHaveLength(0);

  const [rawBefore, readoutsBefore] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))
  ]);
  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & {
      __otidNtBody?: string | null;
      __otidNtKey?: string | null;
      __otidNtCount?: number;
    };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidNtCount = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/admin/races/${race}/entries/`) && url.endsWith("/without-timing") &&
          (init?.method ?? "GET").toUpperCase() === "POST") {
        const body = typeof init?.body === "string" ? init.body : null;
        const key = new Headers(init?.headers).get("idempotency-key");
        testWindow.__otidNtCount = (testWindow.__otidNtCount ?? 0) + 1;
        if (testWindow.__otidNtCount === 1) {
          testWindow.__otidNtBody = body;
          testWindow.__otidNtKey = key;
          const response = await originalFetch(input, init);
          if (!response.ok) return response;
          throw new TypeError("Simulerat tappat svar efter NT-commit");
        }
        if (body !== testWindow.__otidNtBody || key !== testWindow.__otidNtKey) {
          throw new TypeError("Uttrycklig retry ändrade NT-intent eller idempotency-key");
        }
      }
      return originalFetch(input, init);
    };
  }, { race: raceId });

  await page.getByRole("button", { name: "Ja, markera utan tidtagning" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Okänd commit-status");
  await expect(retained).toContainText("Ingen automatisk retry görs");
  const requestId = (await retained.locator("dd.pairing-grant-id").textContent())?.trim();
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Det tidigare beslutet bekräftades med samma request-id");

  const [decisions, audits, rawAfter, readoutsAfter] = await Promise.all([
    e2eDatabase.db.select().from(schema.withoutTimingDecisions)
      .where(eq(schema.withoutTimingDecisions.raceId, raceId)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "WITHOUT_TIMING_DECIDED")
    )),
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))
  ]);
  expect(decisions).toHaveLength(1);
  expect(audits).toHaveLength(1);
  expect(rawAfter[0]?.value).toBe(rawBefore[0]?.value);
  expect(readoutsAfter[0]?.value).toBe(readoutsBefore[0]?.value);
  const [revision] = await e2eDatabase.db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.id, decisions[0]!.createdResultRevisionId));
  expect(revision).toMatchObject({
    revision: 2,
    cause: "MANUAL_WITHOUT_TIMING",
    status: "NT",
    reason: "WITHOUT_TIMING",
    readoutId: null,
    withoutTimingDecisionId: decisions[0]!.id
  });
  expect(revision?.evaluation).toMatchObject({ status: "NT", reason: "WITHOUT_TIMING" });
  expect(revision?.evaluation).not.toHaveProperty("elapsedMs");
  expect(revision?.evaluation).not.toHaveProperty("splits");

  await page.reload();
  await expect(page.locator("article.without-timing-entry").filter({ hasText: "Ada Löpare" }))
    .toContainText("Kan inte markeras utan tidtagning");
  await page.goto(`/results/${raceId}`);
  const publicRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(publicRow).toContainText("Utan tidtagning");
  await expect(publicRow).toContainText("Markerad utan tidtagning av arrangör");
  expect(await publicRow.locator("td").nth(1).textContent()).toBe("–");
  expect(await publicRow.locator("td").nth(4).textContent()).toBe("–");
  expect(await publicRow.locator("td").nth(5).textContent()).toBe("–");
  expect(await publicRow.locator("td").nth(6).textContent()).toBe("–");
  const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
  expect(publicBody.formatVersion).toBe(7);
  const withoutTiming = publicBody.results.find((result) => result.status === "NT");
  expect(withoutTiming).toMatchObject({
    givenName: "Ada",
    familyName: "Löpare",
    revision: 2,
    status: "NT",
    reason: "WITHOUT_TIMING",
    rankingState: "NOT_RANKABLE_STATUS"
  });
  for (const forbidden of ["position", "timeBehindMs", "elapsedMs", "missingControls", "extraPunches", "splits"]) {
    expect(withoutTiming).not.toHaveProperty(forbidden);
  }
  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain(requestId);
}, 60_000);

test("explicit NT-återtagande bevarar historik och återhämtar okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [
      { code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 32, punchedAt: "2026-08-30T10:20:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }
    ]
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId,
    sessionId: deviceId,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{
      localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z",
      transport: "simulator",
      payload,
      contentHash: contentHash(payload)
    }]
  });

  const decisionAccess = await issueWithoutTimingAdminAccess(raceId);
  await page.goto(`/admin/${raceId}/without-timing`);
  await page.getByLabel("Nyckel för utan tidtagning").fill(decisionAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  const decisionCandidate = page.locator("article.without-timing-entry").filter({ hasText: "Ada Löpare" });
  await decisionCandidate.getByRole("button", { name: "Granska beslut utan tidtagning" }).click();
  await page.getByRole("button", { name: "Ja, markera utan tidtagning" }).click();
  await expect(page.getByRole("status")).toContainText("NT-revisionen skapades");
  const [decision] = await e2eDatabase.db.select().from(schema.withoutTimingDecisions)
    .where(eq(schema.withoutTimingDecisions.raceId, raceId));
  if (!decision) throw new Error("E2E-NT-beslutet saknas");

  const [rawBefore, readoutsBefore, revisionsBefore] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, decision.entryId))
  ]);
  const protectedCandidates = await page.request.get(
    `/api/admin/races/${raceId}/without-timing-withdrawals`
  );
  expect(protectedCandidates.status()).toBe(401);
  expect(await protectedCandidates.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const withdrawalAccess = await issueWithoutTimingWithdrawalAdminAccess(raceId);
  const adminPage = await page.goto(`/admin/${raceId}/without-timing-withdrawals`);
  expect(adminPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(adminPage?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(adminPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await adminPage?.text();
  expect(shell).toContain("Återta utan tidtagning");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);
  await page.getByLabel("Återtagningsnyckel för utan tidtagning").fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Beslut om utan tidtagning" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_without_timing_withdrawal_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_without_timing_withdrawal_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  const candidate = page.locator("article.without-timing-withdrawal-entry")
    .filter({ hasText: "Ada Löpare" });
  await expect(candidate).toContainText("Kan återtas");
  await expect(candidate).toContainText("1 · OK");
  await expect(candidate).toContainText("Godkänt resultat");
  await candidate.getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta återtagandet" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.withoutTimingWithdrawals)
    .where(eq(schema.withoutTimingWithdrawals.raceId, raceId))).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & {
      __otidNtWithdrawalBody?: string | null;
      __otidNtWithdrawalKey?: string | null;
      __otidNtWithdrawalCount?: number;
    };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidNtWithdrawalCount = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/admin/races/${race}/entries/`) &&
          url.endsWith("/without-timing-withdrawal") &&
          (init?.method ?? "GET").toUpperCase() === "POST") {
        const body = typeof init?.body === "string" ? init.body : null;
        const key = new Headers(init?.headers).get("idempotency-key");
        testWindow.__otidNtWithdrawalCount = (testWindow.__otidNtWithdrawalCount ?? 0) + 1;
        if (testWindow.__otidNtWithdrawalCount === 1) {
          testWindow.__otidNtWithdrawalBody = body;
          testWindow.__otidNtWithdrawalKey = key;
          const response = await originalFetch(input, init);
          if (!response.ok) return response;
          throw new TypeError("Simulerat tappat svar efter NT-återtagande-commit");
        }
        if (body !== testWindow.__otidNtWithdrawalBody || key !== testWindow.__otidNtWithdrawalKey) {
          throw new TypeError("Uttrycklig retry ändrade NT-återtagandets intent eller idempotency-key");
        }
      }
      return originalFetch(input, init);
    };
  }, { race: raceId });
  await page.getByRole("button", { name: "Ja, återta utan tidtagning" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Okänd commit-status");
  await expect(retained).toContainText("Ingen automatisk retry görs");
  const requestId = (await retained.locator("dd.pairing-grant-id").last().textContent())?.trim();
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect(page.getByRole("status")).toContainText("Samma återtagande bekräftades");

  const [withdrawals, revisions, audits, rawAfter, readoutsAfter] = await Promise.all([
    e2eDatabase.db.select().from(schema.withoutTimingWithdrawals)
      .where(eq(schema.withoutTimingWithdrawals.raceId, raceId)),
    e2eDatabase.db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, decision.entryId))
      .orderBy(asc(schema.resultRevisions.revision)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "WITHOUT_TIMING_WITHDRAWN")
    )),
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))
  ]);
  expect(withdrawals).toHaveLength(1);
  expect(audits).toHaveLength(1);
  expect(revisions).toHaveLength((revisionsBefore[0]?.value ?? 0) + 1);
  expect(revisions.map((revision) => revision.cause)).toEqual([
    "CARD_READOUT",
    "MANUAL_WITHOUT_TIMING",
    "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
  ]);
  expect(revisions[2]).toMatchObject({
    readoutId: null,
    withoutTimingDecisionId: null,
    withoutTimingWithdrawalId: withdrawals[0]!.id,
    status: "OK",
    reason: "COMPLETE",
    evaluation: revisions[0]!.evaluation
  });
  expect(rawAfter[0]?.value).toBe(rawBefore[0]?.value);
  expect(readoutsAfter[0]?.value).toBe(readoutsBefore[0]?.value);

  await page.reload();
  await expect(page.locator("article.without-timing-withdrawal-entry")
    .filter({ hasText: "Ada Löpare" })).toContainText("Redan återtaget");
  const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
  expect(publicBody.formatVersion).toBe(7);
  expect(publicBody.results.find((result) => result.givenName === "Ada")).toMatchObject({
    revision: 3,
    status: "OK",
    reason: "COMPLETE",
    rankingState: "RANKED"
  });
  expect(page.url()).not.toContain(withdrawalAccess.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(decisionAccess.accessCredential);
  expect(storage).not.toContain(withdrawalAccess.accessCredential);
  expect(storage).not.toContain(requestId);
}, 60_000);

test("explicit individuellt utom tävlan kräver två steg och återhämtar okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [
      { code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }
    ]
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId, sessionId: deviceId, packageVersion: 3, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }]
  });
  const access = await issueOutOfCompetitionAdminAccess(raceId);
  const protectedCandidates = await page.request.get(`/api/admin/races/${raceId}/out-of-competition-candidates`);
  expect(protectedCandidates.status()).toBe(401);
  expect(await protectedCandidates.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const adminPage = await page.goto(`/admin/${raceId}/out-of-competition`);
  expect(adminPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(adminPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await adminPage?.text();
  expect(shell).toContain("Utom tävlan");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Åtkomstkod för utom tävlan").fill(access.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Deltagare för utom tävlan" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_out_of_competition_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_out_of_competition_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  const candidate = page.locator("article.out-of-competition-entry").filter({ hasText: "Ada Löpare" });
  await expect(candidate).toContainText("Kan markeras utom tävlan");
  await expect(candidate).toContainText("Obligatorisk kontroll saknas");
  await candidate.getByRole("button", { name: "Granska utom-tävlan-beslut" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta utom tävlan" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.notCompetingDecisions)
    .where(eq(schema.notCompetingDecisions.raceId, raceId))).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & {
      __otidOriginalOocFetch?: typeof window.fetch;
      __otidOocBody?: string | null;
      __otidOocKey?: string | null;
      __otidOocCount?: number;
    };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalOocFetch = originalFetch;
    testWindow.__otidOocCount = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/admin/races/${race}/entries/`) && url.endsWith("/out-of-competition") &&
          (init?.method ?? "GET").toUpperCase() === "POST") {
        const body = typeof init?.body === "string" ? init.body : null;
        const key = new Headers(init?.headers).get("idempotency-key");
        testWindow.__otidOocCount = (testWindow.__otidOocCount ?? 0) + 1;
        if (testWindow.__otidOocCount === 1) {
          testWindow.__otidOocBody = body;
          testWindow.__otidOocKey = key;
          const response = await originalFetch(input, init);
          if (!response.ok) return response;
          throw new TypeError("Simulerat tappat svar efter OOC-commit");
        }
        if (body !== testWindow.__otidOocBody || key !== testWindow.__otidOocKey) {
          throw new TypeError("Uttrycklig retry ändrade OOC-intent eller idempotency-key");
        }
      }
      return originalFetch(input, init);
    };
  }, { race: raceId });

  await page.getByRole("button", { name: "Ja, markera som utom tävlan" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Okänd commit-status");
  await expect(retained).toContainText("Ingen automatisk retry görs");
  const requestId = (await retained.locator("dd.pairing-grant-id").textContent())?.trim();
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect(page.getByRole("status")).toContainText("Det tidigare utom-tävlan-beslutet bekräftades med samma request-id");

  const decisions = await e2eDatabase.db.select().from(schema.notCompetingDecisions)
    .where(eq(schema.notCompetingDecisions.raceId, raceId));
  expect(decisions).toHaveLength(1);
  const [revision] = await e2eDatabase.db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.id, decisions[0]!.createdResultRevisionId));
  expect(revision).toMatchObject({ cause: "MANUAL_OUT_OF_COMPETITION", status: "OOC", reason: "OUT_OF_COMPETITION", readoutId: null });
  await page.reload();
  await expect(page.locator("article.out-of-competition-entry").filter({ hasText: "Ada Löpare" }))
    .toContainText("utom-tävlan-beslut är redan aktivt");
  await page.goto(`/results/${raceId}`);
  const publicRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(publicRow).toContainText("Utom tävlan");
  await expect(publicRow).toContainText("Markerad som utom tävlan av arrangör");
  const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
  const ooc = publicBody.results.find((result) => result.status === "OOC");
  expect(ooc).toMatchObject({ givenName: "Ada", familyName: "Löpare", status: "OOC", reason: "OUT_OF_COMPETITION", missingControls: [32], extraPunches: [] });
  expect(ooc).not.toHaveProperty("position");
  expect(page.url()).not.toContain(access.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
  expect(storage).not.toContain(access.accessCredential);
  expect(storage).not.toContain(requestId);
}, 60_000);

test("explicit individuellt OOC-återtagande bevarar history och återhämtar okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = { cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:00Z", finishPunchedAt: "2026-08-30T10:40:00Z", punches: [{ code: 31, punchedAt: "2026-08-30T10:10:00Z" }, { code: 33, punchedAt: "2026-08-30T10:30:00Z" }] };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, { deviceId, sessionId: deviceId, packageVersion: 3, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const decideAccess = await issueOutOfCompetitionAdminAccess(raceId);
  await page.goto(`/admin/${raceId}/out-of-competition`);
  await page.getByLabel("Åtkomstkod för utom tävlan").fill(decideAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await page.locator("article.out-of-competition-entry").filter({ hasText: "Ada Löpare" }).getByRole("button", { name: "Granska utom-tävlan-beslut" }).click();
  await page.getByRole("button", { name: "Ja, markera som utom tävlan" }).click();
  await expect(page.getByRole("status")).toContainText("OOC-revisionen skapades");
  const [decision] = await e2eDatabase.db.select().from(schema.notCompetingDecisions).where(eq(schema.notCompetingDecisions.raceId, raceId));
  if (!decision) throw new Error("OOC-beslutet saknas");
  const [rawBefore, readoutBefore, revisionsBefore] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, decision.entryId))
  ]);
  const withdrawalAccess = await issueOutOfCompetitionWithdrawalAdminAccess(raceId);
  const unauthorized = await page.request.get(`/api/admin/races/${raceId}/out-of-competition-withdrawals`);
  expect(unauthorized.status()).toBe(401); expect(await unauthorized.text()).not.toMatch(/Ada|12345/);
  await page.goto(`/admin/${raceId}/out-of-competition-withdrawals`);
  await expect(page.getByRole("heading", { name: "Återta utom tävlan" })).toBeVisible();
  await page.getByLabel("Återtagningsnyckel för utom tävlan").fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  const candidate = page.locator("article.out-of-competition-withdrawal-entry").filter({ hasText: "Ada Löpare" });
  await expect(candidate).toContainText("Kan återtas");
  await candidate.getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta återtagandet" })).toBeVisible();
  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & { __otidOriginalOocWithdrawalFetch?: typeof window.fetch; __otidOocWithdrawalBody?: string | null; __otidOocWithdrawalKey?: string | null; __otidOocWithdrawalCount?: number };
    const originalFetch = window.fetch.bind(window); testWindow.__otidOriginalOocWithdrawalFetch = originalFetch; testWindow.__otidOocWithdrawalCount = 0;
    window.fetch = async (input, init) => { const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; if (url.includes(`/api/admin/races/${race}/entries/`) && url.endsWith("/out-of-competition-withdrawal") && (init?.method ?? "GET").toUpperCase() === "POST") { const body = typeof init?.body === "string" ? init.body : null; const key = new Headers(init?.headers).get("idempotency-key"); testWindow.__otidOocWithdrawalCount = (testWindow.__otidOocWithdrawalCount ?? 0) + 1; if (testWindow.__otidOocWithdrawalCount === 1) { testWindow.__otidOocWithdrawalBody = body; testWindow.__otidOocWithdrawalKey = key; const response = await originalFetch(input, init); if (!response.ok) return response; throw new TypeError("Simulerat tappat svar efter OOC-återtagande-commit"); } if (body !== testWindow.__otidOocWithdrawalBody || key !== testWindow.__otidOocWithdrawalKey) throw new TypeError("Uttrycklig retry ändrade OOC-återtagandets intent eller idempotency-key"); } return originalFetch(input, init); };
  }, { race: raceId });
  await page.getByRole("button", { name: "Ja, återta utom tävlan" }).click();
  await expect(page.locator("section[role='alert']")).toContainText("Okänd commit-status");
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect(page.getByRole("status")).toContainText("Samma återtagande bekräftades");
  const [withdrawals] = await e2eDatabase.db.select().from(schema.notCompetingWithdrawals).where(eq(schema.notCompetingWithdrawals.raceId, raceId));
  const revisionsAfter = await e2eDatabase.db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, decision.entryId)).orderBy(asc(schema.resultRevisions.revision));
  expect(withdrawals).toBeTruthy(); expect(revisionsAfter).toHaveLength((revisionsBefore[0]?.value ?? 0) + 1); expect(revisionsAfter.at(-1)).toMatchObject({ cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", notCompetingWithdrawalId: withdrawals?.id });
  const [rawAfter, readoutAfter] = await Promise.all([e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)), e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId))]);
  expect(rawAfter[0]?.value).toBe(rawBefore[0]?.value); expect(readoutAfter[0]?.value).toBe(readoutBefore[0]?.value);
  await page.reload(); await expect(page.locator("article.out-of-competition-withdrawal-entry").filter({ hasText: "Ada Löpare" })).toContainText("Redan återtaget");
}, 60_000);

test("explicit DNS-återtagande kräver två steg och återhämtar okänd commit utan ny resultatrevision", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const dnsAccess = await issueDidNotStartAdminAccess(raceId);
  await page.goto(`/admin/${raceId}/did-not-start`);
  await page.getByLabel("Accesscredential för ej-startbeslut").fill(dnsAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  const dnsCard = page.locator("article.did-not-start-entry").filter({ hasText: "Bo Skog" });
  await dnsCard.getByRole("button", { name: "Markera som ej startad" }).click();
  await expect(page.getByRole("status")).toContainText("Ej-startbeslutet skapades");

  const [decision] = await e2eDatabase.db.select().from(schema.didNotStartDecisions)
    .where(eq(schema.didNotStartDecisions.raceId, raceId));
  if (!decision) throw new Error("E2E-DNS-beslutet saknas");
  const [rawBefore, readoutsBefore, revisionsBefore] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, decision.entryId))
  ]);

  const protectedBeforeLogin = await page.request.get(
    `/api/admin/races/${raceId}/did-not-start-withdrawals`
  );
  expect(protectedBeforeLogin.status()).toBe(401);
  expect(await protectedBeforeLogin.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const withdrawalAccess = await issueDidNotStartWithdrawalAdminAccess(raceId);
  const pageResponse = await page.goto(`/admin/${raceId}/did-not-start-withdrawals`);
  expect(pageResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageResponse?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(pageResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const shell = await pageResponse?.text();
  expect(shell).toContain("Återta ej-startbeslut");
  expect(shell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Accesscredential för återtagande").fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Manuella ej-startbeslut" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "otid_dns_withdrawal_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(cookies.find((cookie) => cookie.name === "otid_dns_withdrawal_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  const withdrawalCard = page.locator("article.did-not-start-withdrawal-entry").filter({ hasText: "Bo Skog" });
  await expect(withdrawalCard).toContainText("Kan återtas");
  await withdrawalCard.getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta återtagandet" })).toBeVisible();
  const beforeConfirmation = await e2eDatabase.db.select().from(schema.didNotStartWithdrawals)
    .where(eq(schema.didNotStartWithdrawals.raceId, raceId));
  expect(beforeConfirmation).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalFetch = originalFetch;
    let dropped = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await originalFetch(input, init);
      if (!dropped && url.includes(`/api/admin/races/${race}/entries/`) &&
          url.endsWith("/did-not-start-withdrawal")) {
        dropped = true;
        throw new TypeError("Simulerat tappat svar efter DNS-återtagningscommit");
      }
      return response;
    };
  }, { race: raceId });
  await page.getByRole("button", { name: "Ja, återta ej-startbeslutet" }).click();
  const retained = page.locator("section[role='alert']");
  await expect(retained).toContainText("Okänd commit-status");
  const retainedRequestId = (await retained.locator("dd").nth(1).textContent())?.trim();
  expect(retainedRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    if (testWindow.__otidOriginalFetch) window.fetch = testWindow.__otidOriginalFetch;
    delete testWindow.__otidOriginalFetch;
  });
  await page.getByRole("button", { name: "Försök igen med samma request-id" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Samma återtagande bekräftades via idempotent återspelning");
  await expect(retained).toHaveCount(0);

  const [withdrawals, audits, rawAfter, readoutsAfter, revisionsAfter] = await Promise.all([
    e2eDatabase.db.select().from(schema.didNotStartWithdrawals)
      .where(eq(schema.didNotStartWithdrawals.raceId, raceId)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "DID_NOT_START_WITHDRAWN")
    )),
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, decision.entryId))
  ]);
  expect(withdrawals).toHaveLength(1);
  expect(withdrawals[0]).toMatchObject({
    requestId: retainedRequestId,
    didNotStartDecisionId: decision.id,
    reason: "ERRONEOUS_MANUAL_DNS"
  });
  expect(audits).toHaveLength(1);
  expect(rawAfter[0]?.value).toBe(rawBefore[0]?.value);
  expect(readoutsAfter[0]?.value).toBe(readoutsBefore[0]?.value);
  expect(revisionsAfter[0]?.value).toBe(revisionsBefore[0]?.value);

  const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
  expect(publicBody.results.some((result) => result.givenName === "Bo" && result.familyName === "Skog")).toBe(false);
  await page.goto(`/results/${raceId}`);
  await expect(page.getByRole("row").filter({ hasText: "Bo Skog" })).toHaveCount(0);

  expect(page.url()).not.toContain(withdrawalAccess.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(withdrawalAccess.accessCredential);
  expect(storage).not.toContain(retainedRequestId);
});

test("manuell diskvalifikation och separat återtagande bevarar historik vid okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [31, 32, 33].map((code, index) => ({
      code,
      punchedAt: `2026-08-30T10:${10 + index * 10}:00Z`
    }))
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId,
    sessionId: deviceId,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{
      localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z",
      transport: "simulator",
      payload,
      contentHash: contentHash(payload)
    }]
  });
  const [rawBefore, readoutsBefore] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))
  ]);

  const disqualificationAccess = await issueResultDisqualificationAdminAccess(raceId);
  const protectedCandidates = await page.request.get(
    `/api/admin/races/${raceId}/result-disqualification-candidates`
  );
  expect(protectedCandidates.status()).toBe(401);
  expect(await protectedCandidates.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const disqualificationPage = await page.goto(`/admin/${raceId}/disqualifications`);
  expect(disqualificationPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(disqualificationPage?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(disqualificationPage?.headers()["x-frame-options"]).toBe("DENY");
  expect(disqualificationPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const disqualificationShell = await disqualificationPage?.text();
  expect(disqualificationShell).toContain("Diskvalificera individuellt resultat");
  expect(disqualificationShell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Diskvalifikationsnyckel")
    .fill(disqualificationAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Resultat som kan diskvalificeras" })).toBeVisible();
  const disqualificationCookies = await page.context().cookies();
  expect(disqualificationCookies.find((cookie) => cookie.name === "otid_result_disqualification_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(disqualificationCookies.find((cookie) => cookie.name === "otid_result_disqualification_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  const adaCandidate = page.locator("article.result-disqualification-entry").filter({ hasText: "Ada Löpare" });
  await expect(adaCandidate).toContainText("Kan diskvalificeras");
  await adaCandidate.getByRole("button", { name: "Granska diskvalifikation" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta diskvalifikationen" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.resultDisqualificationDecisions)
    .where(eq(schema.resultDisqualificationDecisions.raceId, raceId))).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalFetch = originalFetch;
    let dropped = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await originalFetch(input, init);
      if (!dropped && url.includes(`/api/admin/races/${race}/entries/`) &&
          url.endsWith("/result-disqualification")) {
        dropped = true;
        throw new TypeError("Simulerat tappat svar efter diskvalifikationscommit");
      }
      return response;
    };
  }, { race: raceId });
  await page.getByRole("button", { name: "Ja, diskvalificera resultatet" }).click();
  const retainedDisqualification = page.locator("section[role='alert']");
  await expect(retainedDisqualification).toContainText("Okänd commit-status");
  const disqualificationRequestId = (await retainedDisqualification.locator("dd").nth(1).textContent())?.trim();
  expect(disqualificationRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    if (testWindow.__otidOriginalFetch) window.fetch = testWindow.__otidOriginalFetch;
    delete testWindow.__otidOriginalFetch;
  });
  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Samma diskvalifikation bekräftades genom idempotent återspelning");
  await expect(retainedDisqualification).toHaveCount(0);

  const [decisions, decisionAudits] = await Promise.all([
    e2eDatabase.db.select().from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.raceId, raceId)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "RESULT_DISQUALIFIED")
    ))
  ]);
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({
    requestId: disqualificationRequestId,
    status: "DSQ",
    reason: "MANUAL_DISQUALIFICATION",
    createdResultRevision: 2
  });
  expect(decisionAudits).toHaveLength(1);
  const afterDisqualification = await e2eDatabase.db.select().from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.entryId, decisions[0]!.entryId))
    .orderBy(asc(schema.resultRevisions.revision));
  expect(afterDisqualification).toHaveLength(2);
  expect(afterDisqualification.map((revision) => revision.cause)).toEqual([
    "CARD_READOUT",
    "MANUAL_DISQUALIFICATION"
  ]);
  expect(afterDisqualification[1]).toMatchObject({
    status: "DSQ",
    reason: "MANUAL_DISQUALIFICATION",
    readoutId: null,
    disqualificationDecisionId: decisions[0]!.id
  });

  const disqualifiedPublicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const disqualifiedPublic = publicResultListResponseSchema.parse(await disqualifiedPublicResponse.json());
  const disqualifiedAda = disqualifiedPublic.results.find((result) => result.givenName === "Ada");
  expect(disqualifiedAda).toMatchObject({
    familyName: "Löpare",
    revision: 2,
    status: "DSQ",
    reason: "MANUAL_DISQUALIFICATION"
  });
  expect(disqualifiedAda).not.toHaveProperty("position");
  await page.goto(`/results/${raceId}`);
  await expect(page.getByRole("row").filter({ hasText: "Ada Löpare" })).toContainText("Diskvalificerad");

  const protectedWithdrawals = await page.request.get(
    `/api/admin/races/${raceId}/result-disqualification-withdrawals`
  );
  expect(protectedWithdrawals.status()).toBe(401);
  expect(await protectedWithdrawals.text()).not.toMatch(/Ada|Bo|12345|67890/);
  const withdrawalAccess = await issueResultDisqualificationWithdrawalAdminAccess(raceId);
  const withdrawalPage = await page.goto(`/admin/${raceId}/disqualification-withdrawals`);
  expect(withdrawalPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(withdrawalPage?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(withdrawalPage?.headers()["x-frame-options"]).toBe("DENY");
  expect(withdrawalPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const withdrawalShell = await withdrawalPage?.text();
  expect(withdrawalShell).toContain("Återta manuell diskvalifikation");
  expect(withdrawalShell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Återtagningsnyckel").fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Manuella diskvalifikationsbeslut" })).toBeVisible();
  const withdrawalCookies = await page.context().cookies();
  expect(withdrawalCookies.find((cookie) => cookie.name === "otid_result_disqualification_withdrawal_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(withdrawalCookies.find((cookie) => cookie.name === "otid_result_disqualification_withdrawal_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  const withdrawalCandidate = page.locator("article.result-disqualification-withdrawal-entry")
    .filter({ hasText: "Ada Löpare" });
  await expect(withdrawalCandidate).toContainText("Kan återtas");
  await withdrawalCandidate.getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta återtagandet" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.resultDisqualificationWithdrawals)
    .where(eq(schema.resultDisqualificationWithdrawals.raceId, raceId))).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    const originalFetch = window.fetch.bind(window);
    testWindow.__otidOriginalFetch = originalFetch;
    let dropped = false;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await originalFetch(input, init);
      if (!dropped && url.includes(`/api/admin/races/${race}/entries/`) &&
          url.endsWith("/result-disqualification-withdrawal")) {
        dropped = true;
        throw new TypeError("Simulerat tappat svar efter DSQ-återtagningscommit");
      }
      return response;
    };
  }, { race: raceId });
  await page.getByRole("button", { name: "Ja, återta diskvalifikationen" }).click();
  const retainedWithdrawal = page.locator("section[role='alert']");
  await expect(retainedWithdrawal).toContainText("Okänd commit-status");
  const withdrawalRequestId = (await retainedWithdrawal.locator("dd").nth(1).textContent())?.trim();
  expect(withdrawalRequestId).toMatch(/^[0-9a-f-]{36}$/);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __otidOriginalFetch?: typeof window.fetch };
    if (testWindow.__otidOriginalFetch) window.fetch = testWindow.__otidOriginalFetch;
    delete testWindow.__otidOriginalFetch;
  });
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Samma återtagande bekräftades genom idempotent återspelning");
  await expect(retainedWithdrawal).toHaveCount(0);

  const [withdrawals, withdrawalAudits, rawAfter, readoutsAfter, revisionsAfter] = await Promise.all([
    e2eDatabase.db.select().from(schema.resultDisqualificationWithdrawals)
      .where(eq(schema.resultDisqualificationWithdrawals.raceId, raceId)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "RESULT_DISQUALIFICATION_WITHDRAWN")
    )),
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId)),
    e2eDatabase.db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, decisions[0]!.entryId))
      .orderBy(asc(schema.resultRevisions.revision))
  ]);
  expect(withdrawals).toHaveLength(1);
  expect(withdrawals[0]).toMatchObject({
    requestId: withdrawalRequestId,
    disqualificationDecisionId: decisions[0]!.id,
    reason: "ERRONEOUS_MANUAL_DISQUALIFICATION",
    createdResultRevision: 3
  });
  expect(withdrawalAudits).toHaveLength(1);
  expect(revisionsAfter.map((revision) => revision.cause)).toEqual([
    "CARD_READOUT",
    "MANUAL_DISQUALIFICATION",
    "MANUAL_DISQUALIFICATION_WITHDRAWAL"
  ]);
  expect(revisionsAfter[2]).toMatchObject({
    revision: 3,
    status: "OK",
    reason: "COMPLETE",
    readoutId: null,
    disqualificationWithdrawalId: withdrawals[0]!.id
  });
  expect(revisionsAfter[2]?.evaluation).toEqual(revisionsAfter[0]?.evaluation);
  expect(rawAfter[0]?.value).toBe(rawBefore[0]?.value);
  expect(readoutsAfter[0]?.value).toBe(readoutsBefore[0]?.value);

  const restoredPublicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const restoredPublic = publicResultListResponseSchema.parse(await restoredPublicResponse.json());
  const restoredAda = restoredPublic.results.find((result) => result.givenName === "Ada");
  expect(restoredAda).toMatchObject({ familyName: "Löpare", revision: 3, status: "OK", reason: "COMPLETE" });
  await page.goto(`/results/${raceId}`);
  await expect(page.getByRole("row").filter({ hasText: "Ada Löpare" })).toContainText("Godkänd");

  expect(page.url()).not.toContain(disqualificationAccess.accessCredential);
  expect(page.url()).not.toContain(withdrawalAccess.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(disqualificationAccess.accessCredential);
  expect(storage).not.toContain(withdrawalAccess.accessCredential);
  expect(storage).not.toContain(disqualificationRequestId);
  expect(storage).not.toContain(withdrawalRequestId);
}, 60_000);

test("manuellt resultatgodkännande och separat återtagande bevarar MP-underlag vid okänd commit", async ({ page, request }) => {
  const raceId = await createImportedRace(request);
  const payload = {
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [
      { code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }
    ]
  };
  const deviceId = crypto.randomUUID();
  await ingestDeviceBatch(e2eDatabase.db, raceId, {
    deviceId,
    sessionId: deviceId,
    packageVersion: 3,
    firstSequence: 1,
    lastSequence: 1,
    events: [{
      localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z",
      transport: "simulator",
      payload,
      contentHash: contentHash(payload)
    }]
  });

  const [rawBefore, readoutsBefore] = await Promise.all([
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))
  ]);
  expect(rawBefore[0]?.value).toBe(1);
  expect(readoutsBefore[0]?.value).toBe(1);

  const initialPublicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const initialPublic = publicResultListResponseSchema.parse(await initialPublicResponse.json());
  expect(initialPublic.formatVersion).toBe(7);
  const initialAda = initialPublic.results.find((result) => result.givenName === "Ada");
  expect(initialAda).toMatchObject({
    familyName: "Löpare",
    revision: 1,
    status: "MP",
    reason: "MISSING_CONTROL",
    rankingState: "NOT_RANKABLE_STATUS",
    missingControls: [32],
    extraPunches: []
  });
  expect(initialAda).not.toHaveProperty("position");

  const approvalAccess = await issueResultApprovalAdminAccess(raceId);
  const withdrawalAccess = await issueResultApprovalWithdrawalAdminAccess(raceId);
  const protectedCandidates = await page.request.get(
    `/api/admin/races/${raceId}/result-approval-candidates`
  );
  expect(protectedCandidates.status()).toBe(401);
  expect(await protectedCandidates.text()).not.toMatch(/Ada|Bo|12345|67890/);

  const approvalPage = await page.goto(`/admin/${raceId}/result-approvals`);
  expect(approvalPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(approvalPage?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(approvalPage?.headers()["x-frame-options"]).toBe("DENY");
  expect(approvalPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const approvalShell = await approvalPage?.text();
  expect(approvalShell).toContain("Godkänn individuellt resultat manuellt");
  expect(approvalShell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Godkännandenyckel")
    .fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Godkännandenyckeln godkändes inte för detta lopp.");
  await expect(page.getByRole("heading", { name: "Resultat och godkännandestatus" })).toHaveCount(0);

  await page.getByLabel("Godkännandenyckel").fill(approvalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Resultat och godkännandestatus" })).toBeVisible();
  const approvalCookies = await page.context().cookies();
  expect(approvalCookies.find((cookie) => cookie.name === "otid_result_approval_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(approvalCookies.find((cookie) => cookie.name === "otid_result_approval_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });
  expect(approvalCookies.some((cookie) => cookie.name.includes("approval_withdrawal"))).toBe(false);

  const approvalCandidate = page.locator("article.result-approval-entry").filter({ hasText: "Ada Löpare" });
  await expect(approvalCandidate).toContainText("Kan godkännas manuellt");
  await expect(approvalCandidate).toContainText("MP/MISSING_CONTROL");
  await approvalCandidate.getByRole("button", { name: "Granska godkännande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta manuellt godkännande" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.resultApprovalDecisions)
    .where(eq(schema.resultApprovalDecisions.raceId, raceId))).toHaveLength(0);

  await page.evaluate(({ race }) => {
    const approvalWindow = window as typeof window & {
      __otidOriginalApprovalFetch?: typeof window.fetch;
      __otidApprovalFetchCount?: number;
      __otidApprovalBody?: string | null;
      __otidApprovalKey?: string | null;
    };
    const originalFetch = window.fetch.bind(window);
    approvalWindow.__otidOriginalApprovalFetch = originalFetch;
    approvalWindow.__otidApprovalFetchCount = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/admin/races/${race}/entries/`) && url.endsWith("/result-approval") &&
          (init?.method ?? "GET").toUpperCase() === "POST") {
        const body = typeof init?.body === "string" ? init.body : null;
        const key = new Headers(init?.headers).get("idempotency-key");
        approvalWindow.__otidApprovalFetchCount = (approvalWindow.__otidApprovalFetchCount ?? 0) + 1;
        if (approvalWindow.__otidApprovalFetchCount === 1) {
          approvalWindow.__otidApprovalBody = body;
          approvalWindow.__otidApprovalKey = key;
          const response = await originalFetch(input, init);
          if (!response.ok) return response;
          throw new TypeError("Simulerat tappat svar efter resultatgodkännandecommit");
        }
        if (body !== approvalWindow.__otidApprovalBody || key !== approvalWindow.__otidApprovalKey) {
          throw new TypeError("Uttrycklig retry ändrade approval-intent eller idempotency-key");
        }
      }
      return originalFetch(input, init);
    };
  }, { race: raceId });

  await page.getByRole("button", { name: "Ja, godkänn resultatet manuellt" }).click();
  const retainedApproval = page.locator("section[role='alert']");
  await expect(retainedApproval).toContainText("Okänd commit-status");
  await expect(retainedApproval).toContainText("Ingen automatisk retry görs");
  const approvalRequestId = (await retainedApproval.locator("dd").nth(1).textContent())?.trim();
  expect(approvalRequestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as typeof window & {
    __otidApprovalFetchCount?: number;
  }).__otidApprovalFetchCount)).toBe(1);

  const committedApproval = await e2eDatabase.db.select().from(schema.resultApprovalDecisions)
    .where(eq(schema.resultApprovalDecisions.raceId, raceId));
  expect(committedApproval).toHaveLength(1);
  expect(committedApproval[0]).toMatchObject({
    requestId: approvalRequestId,
    targetResultRevision: 1,
    status: "OK",
    reason: "MANUAL_APPROVAL",
    createdResultRevision: 2
  });

  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Samma godkännande bekräftades genom idempotent återspelning");
  await expect(retainedApproval).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & {
    __otidApprovalFetchCount?: number;
  }).__otidApprovalFetchCount)).toBe(2);
  await page.evaluate(() => {
    const approvalWindow = window as typeof window & {
      __otidOriginalApprovalFetch?: typeof window.fetch;
      __otidApprovalFetchCount?: number;
      __otidApprovalBody?: string | null;
      __otidApprovalKey?: string | null;
    };
    if (approvalWindow.__otidOriginalApprovalFetch) window.fetch = approvalWindow.__otidOriginalApprovalFetch;
    delete approvalWindow.__otidOriginalApprovalFetch;
    delete approvalWindow.__otidApprovalFetchCount;
    delete approvalWindow.__otidApprovalBody;
    delete approvalWindow.__otidApprovalKey;
  });

  const [approvalDecisions, approvalAudits, revisionsAfterApproval] = await Promise.all([
    e2eDatabase.db.select().from(schema.resultApprovalDecisions)
      .where(eq(schema.resultApprovalDecisions.raceId, raceId)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "RESULT_APPROVED")
    )),
    e2eDatabase.db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, committedApproval[0]!.entryId))
      .orderBy(asc(schema.resultRevisions.revision))
  ]);
  expect(approvalDecisions).toHaveLength(1);
  expect(approvalAudits).toHaveLength(1);
  expect(revisionsAfterApproval.map((revision) => revision.cause)).toEqual([
    "CARD_READOUT",
    "MANUAL_RESULT_APPROVAL"
  ]);
  expect(revisionsAfterApproval[1]).toMatchObject({
    revision: 2,
    status: "OK",
    reason: "MANUAL_APPROVAL",
    readoutId: null,
    approvalDecisionId: approvalDecisions[0]!.id
  });
  expect(revisionsAfterApproval[1]?.evaluation).toMatchObject({
    status: "OK",
    reason: "MANUAL_APPROVAL",
    missingControls: [32],
    extraPunches: []
  });

  const approvedPublicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const approvedPublic = publicResultListResponseSchema.parse(await approvedPublicResponse.json());
  expect(approvedPublic.formatVersion).toBe(7);
  const approvedAda = approvedPublic.results.find((result) => result.givenName === "Ada");
  expect(approvedAda).toMatchObject({
    familyName: "Löpare",
    revision: 2,
    status: "OK",
    reason: "MANUAL_APPROVAL",
    rankingState: "RANKED",
    position: 1,
    timeBehindMs: 0,
    missingControls: [32],
    extraPunches: []
  });
  await page.goto(`/results/${raceId}`);
  const approvedPublicRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(approvedPublicRow).toContainText("Godkänd manuellt av arrangör");
  await expect(approvedPublicRow).toContainText("Saknas: 32");

  const protectedWithdrawals = await page.request.get(
    `/api/admin/races/${raceId}/result-approval-withdrawals`
  );
  expect(protectedWithdrawals.status()).toBe(401);
  expect(await protectedWithdrawals.text()).not.toMatch(/Ada|Bo|12345|67890/);
  const withdrawalPage = await page.goto(`/admin/${raceId}/approval-withdrawals`);
  expect(withdrawalPage?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(withdrawalPage?.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(withdrawalPage?.headers()["x-frame-options"]).toBe("DENY");
  expect(withdrawalPage?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  const withdrawalShell = await withdrawalPage?.text();
  expect(withdrawalShell).toContain("Återta manuellt resultatgodkännande");
  expect(withdrawalShell).not.toMatch(/Ada Löpare|Bo Skog|12345|67890/);

  await page.getByLabel("Återtagningsnyckel för resultatgodkännande")
    .fill(approvalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Återtagningsnyckeln godkändes inte för detta lopp.");
  await expect(page.getByRole("heading", { name: "Manuella resultatgodkännanden" })).toHaveCount(0);

  await page.getByLabel("Återtagningsnyckel för resultatgodkännande")
    .fill(withdrawalAccess.accessCredential);
  await page.getByRole("button", { name: "Logga in säkert" }).click();
  await expect(page.getByRole("heading", { name: "Manuella resultatgodkännanden" })).toBeVisible();
  const withdrawalCookies = await page.context().cookies();
  expect(withdrawalCookies.find((cookie) => cookie.name === "otid_result_approval_withdrawal_admin_session"))
    .toMatchObject({ httpOnly: true, secure: false, sameSite: "Strict", path: "/" });
  expect(withdrawalCookies.find((cookie) => cookie.name === "otid_result_approval_withdrawal_admin_csrf"))
    .toMatchObject({ httpOnly: false, secure: false, sameSite: "Strict", path: "/" });

  const withdrawalCandidate = page.locator("article.result-approval-withdrawal-entry")
    .filter({ hasText: "Ada Löpare" });
  await expect(withdrawalCandidate).toContainText("Kan återtas");
  await expect(withdrawalCandidate).toContainText("Restaureringskälla: 1 · MP");
  await withdrawalCandidate.getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.getByRole("heading", { name: "Bekräfta återtagandet" })).toBeVisible();
  expect(await e2eDatabase.db.select().from(schema.resultApprovalWithdrawals)
    .where(eq(schema.resultApprovalWithdrawals.raceId, raceId))).toHaveLength(0);

  await page.getByRole("button", { name: "Ja, återta resultatgodkännandet" }).click();
  await expect(page.getByRole("status"))
    .toContainText("Resultatgodkännandet återtogs och en ny publicerad restaureringsrevision skapades");

  const [withdrawals, withdrawalAudits, rawAfter, readoutsAfter, revisionsAfterWithdrawal] = await Promise.all([
    e2eDatabase.db.select().from(schema.resultApprovalWithdrawals)
      .where(eq(schema.resultApprovalWithdrawals.raceId, raceId)),
    e2eDatabase.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "RESULT_APPROVAL_WITHDRAWN")
    )),
    e2eDatabase.db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId)),
    e2eDatabase.db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId)),
    e2eDatabase.db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, approvalDecisions[0]!.entryId))
      .orderBy(asc(schema.resultRevisions.revision))
  ]);
  expect(withdrawals).toHaveLength(1);
  expect(withdrawals[0]).toMatchObject({
    approvalDecisionId: approvalDecisions[0]!.id,
    withdrawnResultRevision: 2,
    expectedLatestResultRevision: 2,
    restoredFromResultRevision: 1,
    reason: "ERRONEOUS_MANUAL_APPROVAL",
    createdResultRevision: 3
  });
  expect(withdrawalAudits).toHaveLength(1);
  expect(revisionsAfterWithdrawal.map((revision) => revision.cause)).toEqual([
    "CARD_READOUT",
    "MANUAL_RESULT_APPROVAL",
    "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
  ]);
  expect(revisionsAfterWithdrawal[2]).toMatchObject({
    revision: 3,
    status: "MP",
    reason: "MISSING_CONTROL",
    readoutId: null,
    approvalWithdrawalId: withdrawals[0]!.id
  });
  expect(revisionsAfterWithdrawal[2]?.evaluation).toEqual(revisionsAfterWithdrawal[0]?.evaluation);
  expect(rawAfter[0]?.value).toBe(rawBefore[0]?.value);
  expect(readoutsAfter[0]?.value).toBe(readoutsBefore[0]?.value);

  const restoredPublicResponse = await request.get(`/api/public/races/${raceId}/results`);
  const restoredPublic = publicResultListResponseSchema.parse(await restoredPublicResponse.json());
  const restoredAda = restoredPublic.results.find((result) => result.givenName === "Ada");
  expect(restoredAda).toMatchObject({
    familyName: "Löpare",
    revision: 3,
    status: "MP",
    reason: "MISSING_CONTROL",
    rankingState: "NOT_RANKABLE_STATUS",
    missingControls: [32],
    extraPunches: []
  });
  expect(restoredAda).not.toHaveProperty("position");
  await page.goto(`/results/${raceId}`);
  const restoredPublicRow = page.getByRole("row").filter({ hasText: "Ada Löpare" });
  await expect(restoredPublicRow).toContainText("Felstämplad");
  await expect(restoredPublicRow).toContainText("Saknas: 32");

  expect(page.url()).not.toContain(approvalAccess.accessCredential);
  expect(page.url()).not.toContain(withdrawalAccess.accessCredential);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage)
  }));
  expect(storage).not.toContain(approvalAccess.accessCredential);
  expect(storage).not.toContain(withdrawalAccess.accessCredential);
  expect(storage).not.toContain(approvalRequestId);
}, 60_000);
