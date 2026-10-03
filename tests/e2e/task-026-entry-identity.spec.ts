import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { issuePairingAdminAccessCredential, revokePairingAdminAccessCredential } from "@o-tid/application";
import { eq } from "drizzle-orm";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const { db, pool } = createDatabase(database);
test.afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), otherEntryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetiskt namnprov", startsOn: "2026-09-09", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Rättningsprov", raceDate: "2026-09-09" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Testbana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, name: "Öppen testklass", courseVersionId, startRule: "FIXED" });
  await db.insert(schema.entries).values([
    { id: entryId, raceId, classId, givenName: "Åsa", familyName: "Testperson", organisationName: "Test OK",
      fixedStartTime: new Date("2026-09-09T10:00:00Z") },
    { id: otherEntryId, raceId, classId, givenName: "Bo", familyName: "Testperson", organisationName: "Annan OK",
      fixedStartTime: new Date("2026-09-09T10:01:00Z") }
  ]);
  const expiresAt = new Date(Date.now() + 3600_000);
  const start = await issuePairingAdminAccessCredential(db, { raceId, capability: "VIEW_START_LIST", label: "Syntetiskt listprov", expiresAt });
  const identity = await issuePairingAdminAccessCredential(db, { raceId, capability: "CHANGE_ENTRY_IDENTITY", label: "Syntetiskt rättningsprov", expiresAt });
  return { raceId, entryId, otherEntryId, start, identity };
}

for (const width of [1366, 390]) test(`TASK026 verklig HTTP/PG ${width}: deltagargenväg, granskning, tappat svar och historik`, async ({ page }, testInfo) => {
  const setup = await fixture();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/admin/${setup.raceId}/start-list`);
  const start = page.locator(".start-list-admin");
  await expect(start).toContainText("Logga in med startlistebehörighet för loppet.");
  await start.getByLabel("Startlistebehörighet", { exact: true }).fill(setup.start.accessCredential);
  await start.getByRole("button", { name: "Logga in", exact: true }).click();
  const row = start.getByRole("row").filter({ hasText: "Åsa Testperson" });
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Namn och klubb", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${setup.raceId}/entry-identity$`));
  const view = page.locator(".entry-identity-admin");
  await expect(view).toContainText("Behörighet saknas eller har gått ut. Logga in igen.");
  await expect(view.getByLabel("Namn- och klubbbehörighet", { exact: true })).toBeVisible();
  await expect(view).not.toContainText("Åsa Testperson");
  await view.getByLabel("Namn- och klubbbehörighet", { exact: true }).fill(setup.identity.accessCredential);
  await view.getByRole("button", { name: "Logga in", exact: true }).click();
  await view.getByRole("button", { name: "Välj länkad deltagare", exact: true }).click();
  await expect(view.getByLabel("Förnamn", { exact: true })).toHaveValue("Åsa");
  await view.getByLabel("Förnamn", { exact: true }).fill(" Åse ");
  await view.getByLabel("Klubb", { exact: true }).fill("");
  await view.getByRole("button", { name: "Granska rättning", exact: true }).click();
  const review = view.locator(".entry-identity-review");
  await expect(review).toContainText("Åsa");
  await expect(review).toContainText("Åse");
  expect(await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, setup.raceId))).toHaveLength(0);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/entries/${setup.entryId}/identity`, async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await review.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(view.getByRole("button", { name: "Försök igen med samma begäran", exact: true })).toBeVisible();
  await expect(view.getByLabel("Förnamn", { exact: true })).toBeDisabled();
  expect(await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, setup.raceId))).toHaveLength(1);
  await view.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(view.locator(".entry-identity-history")).toContainText("Åse");
  await expect(view.locator(".entry-identity-history")).toContainText("Åsa");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const journals = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, setup.raceId));
  expect(journals).toHaveLength(1);
  const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(entry).toMatchObject({ givenName: "Åse", familyName: "Testperson", organisationName: null, version: 2 });
  const [other] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.otherEntryId));
  expect(other).toMatchObject({ givenName: "Bo", organisationName: "Annan OK", version: 1 });
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const privateValue of ["Åsa", "Åse", "Testperson", setup.identity.accessCredential]) expect(storage).not.toContain(privateValue);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  await page.screenshot({ path: testInfo.outputPath(`entry-identity-${width}.png`), fullPage: true });
  if (width === 1366) {
    let release!: () => void, observed!: () => void, completed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const readObserved = new Promise<void>(resolve => { observed = resolve; });
    const handled = new Promise<void>(resolve => { completed = resolve; });
    const listUrl = `**/api/admin/races/${setup.raceId}/entry-identity`;
    await page.route(listUrl, async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200); observed(); await gate;
      try { await route.fulfill({ response }); }
      catch { /* Logout intentionally aborts the browser request before its held response. */ }
      finally { completed(); }
    });
    await view.getByRole("button", { name: "Läs in aktuellt underlag", exact: true }).click();
    await readObserved;
    await view.getByRole("button", { name: "Logga ut", exact: true }).click();
    await expect(view.getByLabel("Namn- och klubbbehörighet", { exact: true })).toBeVisible();
    release(); await handled;
    await expect(view).not.toContainText("Testperson");
    await page.unroute(listUrl);
    await view.getByLabel("Namn- och klubbbehörighet", { exact: true }).fill(setup.identity.accessCredential);
    await view.getByRole("button", { name: "Logga in", exact: true }).click();
    await expect(view.getByRole("combobox", { name: "Deltagare", exact: true })).toBeVisible();
  }
  await revokePairingAdminAccessCredential(db, { credentialId: setup.identity.credentialId, capability: "CHANGE_ENTRY_IDENTITY", reason: "Syntetiskt slutprov" });
  await view.getByRole("button", { name: "Läs in aktuellt underlag", exact: true }).click();
  await expect(view.getByLabel("Namn- och klubbbehörighet", { exact: true })).toBeVisible();
  await expect(view).not.toContainText("Testperson");
  await expect(view.locator(".entry-identity-history")).toHaveCount(0);
});
