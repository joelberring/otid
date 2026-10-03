import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { issuePairingAdminAccessCredential, revokePairingAdminAccessCredential, issueCheckinRecoveryGrant } from "@o-tid/application";
import { StartCheckinRecoveryManifestSchema } from "@o-tid/contracts";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
if (!url || url !== process.env.DATABASE_URL) throw new Error("Matching isolated DATABASE_URL and TEST_DATABASE_URL required");
const { db, pool } = createDatabase(url);
test.afterAll(async () => pool.end());
const passphrase = "En separat och syntetisk arbetslösenfras";
async function unlock(page: Page) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Lås upp lokal lista", exact: true }) });
  await form.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
  await form.getByRole("button").click();
  await expect(page.getByRole("region", { name: "Avprickningslista" })).toBeVisible();
}
async function prepare(page: Page, raceId: string, credential: string, capability: "START_CHECKIN" | "FINISH_FOREST_WATCH") {
  await page.goto("/checkin/index.html");
  await page.getByRole("button", { name: "Förbered offline-appskal" }).click();
  await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskal kontrollerat:");
  await page.getByRole("button", { name: "Kontrollera beständig lagring" }).click();
  await page.getByLabel("Loppets interna id").fill(raceId);
  await page.getByLabel("Arbetsuppgift", { exact: true }).selectOption(capability);
  await page.getByLabel("Mobilens namn").fill(`E2E ${capability}`);
  await page.getByLabel("Personlig arbetsbehörighet", { exact: true }).fill(credential);
  await page.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
  await page.getByLabel("Jag godkänner att den privata listan", { exact: false }).check();
  const risk = page.getByLabel("Jag accepterar den risken", { exact: false });
  if (await risk.isVisible()) await risk.check();
  await page.getByRole("button", { name: "Förbered privat startlista", exact: true }).click();
  await expect(page.getByRole("region", { name: "Avprickningslista" })).toBeVisible();
}
const operationStatus = (page: Page) => page.getByRole("status", { name: "Avprickning och synk" });
async function sync(page: Page) {
  await page.getByRole("button", { name: "Synka väntande markeringar", exact: true }).click();
  await expect(operationStatus(page)).toContainText("Synk klar");
}

test("TASK006W verklig HTTP/PG: offline start, tappad kvittens, DNS-rättning vid mål och sen negativ rapport", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(60_000);
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const fixedClassId = randomUUID(), freeClassId = randomUUID(), fixedId = randomUUID(), freeId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetiskt offlineavprickningsprov", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Mobilprov", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Provbana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values([
    { id: fixedClassId, raceId, name: "Minutklass", courseVersionId, startRule: "FIXED" },
    { id: freeClassId, raceId, name: "Fri klass", courseVersionId, startRule: "PUNCH" }
  ]);
  await db.insert(schema.entries).values([
    { id: fixedId, raceId, classId: fixedClassId, givenName: "Minut", familyName: "Provperson", fixedStartTime: new Date("2026-09-05T10:00:00Z") },
    { id: freeId, raceId, classId: freeClassId, givenName: "Fri", familyName: "Provperson" }
  ]);
  const start = await issuePairingAdminAccessCredential(db, { raceId, capability: "START_CHECKIN", label: "Start E2E", expiresAt: new Date(Date.now() + 3600_000) });
  const finish = await issuePairingAdminAccessCredential(db, { raceId, capability: "FINISH_FOREST_WATCH", label: "Mål E2E", expiresAt: new Date(Date.now() + 3600_000) });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, raceId, start.accessCredential, "START_CHECKIN");
  const fixed = page.getByRole("article", { name: "Minut Provperson" }), free = page.getByRole("article", { name: "Fri Provperson" });
  await expect(fixed).toContainText("12:00:00"); await expect(free).toContainText("Fri start");
  await page.getByLabel("Klassfilter", { exact: true }).selectOption(fixedClassId);
  await expect(free).toHaveCount(0);
  await page.getByLabel("Klassfilter", { exact: true }).selectOption("");
  await context.setOffline(true);
  await page.getByLabel("Aktivera skrivläge", { exact: true }).check();
  await fixed.getByRole("button", { name: "Markera startat", exact: true }).click();
  await expect(operationStatus(page)).toContainText("Markeringen är sparad lokalt");
  await free.getByRole("button", { name: "Markera uppgiven ej start", exact: true }).click();
  await expect(free).toContainText("Väntar på serverkvittens: 1");
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(0);
  await page.reload(); await expect(page.getByText("Fri Provperson", { exact: true })).toHaveCount(0); await unlock(page);
  await expect(free).toContainText("Uppgiven ej start"); await expect(page.getByLabel("Aktivera skrivläge", { exact: true })).not.toBeChecked();
  await context.setOffline(false);
  const sent: string[] = [];
  await page.route(`**/api/admin/races/${raceId}/start-checkin/sync`, async (route) => {
    sent.push(route.request().postData()!);
    const result = await route.fetch(); expect(result.status()).toBe(200);
    if (sent.length === 1) await route.abort("failed"); else await route.fulfill({ response: result });
  });
  await page.getByRole("button", { name: "Synka väntande markeringar", exact: true }).click();
  await expect(operationStatus(page)).toContainText("Synken stoppades");
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(1);
  await page.reload(); await unlock(page); await sync(page);
  expect(sent).toHaveLength(3); expect(sent[0]).toBe(sent[1]);
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(2);
  const decisions = await db.select().from(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.raceId, raceId));
  expect(decisions).toHaveLength(1); expect(decisions[0]!.entryId).toBe(freeId);
  // Queue a negative report before a separate finish mobile records a real manual return.
  await context.setOffline(true);
  await page.getByLabel("Aktivera skrivläge", { exact: true }).check();
  await fixed.getByRole("button", { name: "Markera uppgiven ej start", exact: true }).click();
  await expect(fixed).toContainText("Väntar på serverkvittens: 1");
  const finishContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000", viewport: { width: 390, height: 844 } });
  try {
    const target = await finishContext.newPage();
    await prepare(target, raceId, finish.accessCredential, "FINISH_FOREST_WATCH");
    await target.getByLabel("Aktivera skrivläge", { exact: true }).check();
    for (const name of ["Fri Provperson", "Minut Provperson"]) {
      const article = target.getByRole("article", { name });
      await article.getByLabel("Startmarkering", { exact: true }).selectOption("STARTED");
      await article.getByLabel("Manuell återkomst registrerad", { exact: true }).check();
      await article.getByRole("button", { name: "Spara målkorrektion", exact: true }).click();
      await expect(article).toContainText("Väntar på serverkvittens: 1");
    }
    await sync(target);
    expect(await db.select().from(schema.startCheckinDnsWithdrawals).where(eq(schema.startCheckinDnsWithdrawals.raceId, raceId))).toHaveLength(1);
    expect(await db.select().from(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.raceId, raceId))).toEqual(decisions);
    await context.setOffline(false); await sync(page);
    await expect(fixed).toContainText("Konflikter att kontrollera: 1");
    await expect(fixed.getByRole("button", { name: "Markera startat", exact: true })).toBeDisabled();
    const revisions = await db.select().from(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.raceId, raceId));
    expect(revisions.filter((row) => row.entryId === fixedId)).toHaveLength(2);
    expect(revisions.filter((row) => row.entryId === fixedId && row.revision === 2)[0]).toMatchObject({ startState: "STARTED", manualReturnRegistered: true });
    expect(await db.select().from(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.raceId, raceId))).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath("late-report-conflict.png"), fullPage: true });
    const originalOperations = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId));
    await target.goto(`/admin/${raceId}/forest-watch`);
    const panel = target.getByRole("region", { name: "Granska mottagna konfliktrapporter" });
    await panel.getByLabel("Deltagare med ogranskade rapporter").selectOption(fixedId);
    await panel.getByRole("button", { name: "Hämta granskningsunderlag" }).click();
    await panel.getByLabel("Orsak till granskningsbeslut").fill("Återkomst kontrollerad vid mål");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Bekräfta granskning – behåll registrerat läge" }).click();
    await expect(panel.getByRole("status")).toContainText("Granskningen är sparad");
    // Existing local evidence remains unresolved until an authenticated roster refresh.
    await expect(fixed).toContainText("Konflikter att kontrollera: 1");
    await sync(page);
    await expect(fixed).toContainText("Konflikter att kontrollera: 0");
    await expect(fixed).toContainText("Granskade konfliktrapporter – originalkvittensen bevarad: 1");
    await context.setOffline(true); await page.reload(); await unlock(page);
    await expect(fixed).toContainText("Konflikter att kontrollera: 0");
    await expect(fixed).toContainText("Granskade konfliktrapporter – originalkvittensen bevarad: 1");
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toEqual(originalOperations);
    // Automatic reconnect must serialize duplicate online events and stop on local lock.
    await page.getByLabel("Aktivera skrivläge", { exact: true }).check();
    await fixed.getByRole("button", { name: "Markera uppgiven ej start", exact: true }).click();
    await expect(fixed).toContainText("Väntar på serverkvittens: 1");
    await page.getByLabel("Synka automatiskt när nätet återkommer medan listan är upplåst", { exact: true }).check();
    await page.unroute(`**/api/admin/races/${raceId}/start-checkin/sync`);
    let acknowledge!: () => void, release!: () => void;
    const committed = new Promise<void>(resolve => { acknowledge = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const autoBodies: string[] = [];
    await page.route(`**/api/admin/races/${raceId}/start-checkin/sync`, async route => {
      autoBodies.push(route.request().postData()!);
      const response = await route.fetch(); expect(response.status()).toBe(200);
      if (autoBodies.length === 1) { acknowledge(); await released; }
      await route.fulfill({ response });
    });
    await context.setOffline(false);
    await page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("online")); });
    await committed;
    expect(autoBodies).toHaveLength(1);
    await page.getByRole("button", { name: "Lås lokal lista", exact: true }).click();
    release();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("region", { name: "Avprickningslista" })).toHaveCount(0);
    await unlock(page);
    await expect(page.getByLabel("Synka automatiskt när nätet återkommer medan listan är upplåst", { exact: true })).not.toBeChecked();
    await expect(fixed).toContainText("Väntar på serverkvittens: 1");
    await sync(page);
    expect(autoBodies).toHaveLength(2); expect(autoBodies[0]).toBe(autoBodies[1]);
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(originalOperations.length + 1);
    await expect(fixed).toContainText("Konflikter att kontrollera: 1");
  } finally { await finishContext.close(); }
});

test("TASK006W recovery: spärrad behörighet, fryst kö, tappat verkligt svar och privat retry efter reload", async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Synthetic recovery browser", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Recovery", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Fri klass", startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Recovery", familyName: "Provperson" });
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability: "START_CHECKIN", label: "Synthetic recovery",
    expiresAt: new Date(Date.now() + 3600_000) });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, raceId, credential.accessCredential, "START_CHECKIN");
  const article = page.getByRole("article", { name: "Recovery Provperson" });
  await context.setOffline(true);
  await page.getByLabel("Aktivera skrivläge", { exact: true }).check();
  await article.getByRole("button", { name: "Markera startat", exact: true }).click();
  await expect(article).toContainText("Väntar på serverkvittens: 1");
  await article.getByRole("button", { name: "Markera uppgiven ej start", exact: true }).click();
  await expect(article).toContainText("Väntar på serverkvittens: 2");
  const clearForm = page.getByRole("form", { name: "Avsluta och rensa denna lokala lista" });
  await clearForm.getByRole("checkbox").check();
  await clearForm.getByRole("button").click();
  await expect(operationStatus(page)).toContainText("Rensningen kunde inte bekräftas");
  await expect(article).toContainText("Väntar på serverkvittens: 2");
  await page.reload(); await unlock(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportera privat återhämtningsunderlag", exact: true }).click()]);
  const manifest = StartCheckinRecoveryManifestSchema.parse(JSON.parse(readFileSync(await download.path(), "utf8")));
  expect(manifest.items).toHaveLength(2);
  await revokePairingAdminAccessCredential(db, { credentialId: credential.credentialId, capability: "START_CHECKIN", reason: "Synthetic recovery test" });
  const issued = await issueCheckinRecoveryGrant(db, { manifest, operatorLabel: "Synthetic sponsor", reason: "Browser test",
    expiresAt: new Date(Date.now() + 1800_000) });
  await context.setOffline(false);
  await page.getByRole("button", { name: "Synka väntande markeringar", exact: true }).click();
  await expect(operationStatus(page)).toContainText("Synken stoppades");
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(0);
  const recovery = page.getByRole("form", { name: "Återför bevarad kö med arrangörens hjälp" });
  const fillRecovery = async (token: string) => {
    await recovery.getByLabel("Tillfällig återhämtningsbehörighet", { exact: true }).fill(token);
    await recovery.getByLabel("Jag vill återföra den bevarade kön", { exact: false }).check();
    await recovery.getByRole("button", { name: "Återför bevarade markeringar", exact: true }).click();
  };
  await fillRecovery(issued.token.replace(/\.[^.]+$/, "." + "A".repeat(43)));
  await expect(operationStatus(page)).toContainText("Återföringen stoppades");
  await expect(article).toContainText("Väntar på serverkvittens: 2");
  await expect(recovery.getByLabel("Tillfällig återhämtningsbehörighet", { exact: true })).toHaveValue("");
  const sent: string[] = [];
  let responseReady!: () => void, releaseResponse!: () => void, responseFinished!: () => void;
  const heldResponse = new Promise<void>(resolve => { responseReady = resolve; });
  const releasedResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
  const finishedResponse = new Promise<void>(resolve => { responseFinished = resolve; });
  await page.route(`**/api/admin/races/${raceId}/checkin-recovery/sync`, async route => {
    expect(route.request().headers()["cookie"]).toBeUndefined();
    expect(route.request().headers()["x-otid-csrf"]).toBeUndefined();
    expect(route.request().headers()["authorization"]).toBe(`Bearer ${issued.token}`);
    sent.push(route.request().postData()!);
    const response = await route.fetch(); expect(response.status()).toBe(200);
    if (sent.length === 1) await route.abort("failed");
    else if (sent.length === 2) {
      responseReady(); await releasedResponse;
      try { await route.fulfill({ response }); } finally { responseFinished(); }
    } else await route.fulfill({ response });
  });
  await page.getByLabel("Synka automatiskt när nätet återkommer", { exact: false }).check();
  await fillRecovery(issued.token);
  await expect(operationStatus(page)).toContainText("Återföringen stoppades");
  await expect(page.getByLabel("Synka automatiskt när nätet återkommer", { exact: false })).not.toBeChecked();
  await expect(page.getByLabel("Aktivera skrivläge", { exact: true })).not.toBeChecked();
  expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, issued.grantId))).toHaveLength(1);
  await context.setOffline(true); await page.reload(); await unlock(page);
  await expect(article).toContainText("Väntar på serverkvittens: 2");
  await expect(recovery.getByLabel("Tillfällig återhämtningsbehörighet", { exact: true })).toHaveValue("");
  await context.setOffline(false); await fillRecovery(issued.token); await heldResponse;
  try {
    await page.getByRole("button", { name: "Lås lokal lista", exact: true }).click();
    await expect(page.getByText("Recovery Provperson", { exact: true })).toHaveCount(0);
  } finally { releaseResponse(); }
  await finishedResponse;
  await expect(page.getByText("Recovery Provperson", { exact: true })).toHaveCount(0);
  await unlock(page);
  await expect(article).toContainText("Väntar på serverkvittens: 2");
  await expect(recovery.getByLabel("Tillfällig återhämtningsbehörighet", { exact: true })).toHaveValue("");
  await fillRecovery(issued.token);
  await expect(operationStatus(page)).toContainText("Återföringen är kvitterad och sparad lokalt");
  await expect(operationStatus(page)).toContainText("Listunderlaget har inte uppdaterats");
  await expect(article).toContainText("Väntar på serverkvittens: 0");
  expect(sent).toHaveLength(4); expect(sent[0]).toBe(sent[1]); expect(sent[0]).toBe(sent[2]);
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(2);
  expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, issued.grantId))).toHaveLength(2);
  expect(await db.select().from(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.raceId, raceId))).toHaveLength(1);
  const persisted = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("otid-checkin-vault-v1"); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(new Error("IDB unavailable"));
    });
    try {
      const stores = await Promise.all(Array.from(database.objectStoreNames).map(name => new Promise<unknown>((resolve, reject) => {
        const read = database.transaction(name).objectStore(name).getAll(); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(new Error("IDB read failed"));
      })));
      const cacheBodies: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const key of await cache.keys()) { const response = await cache.match(key); cacheBodies.push(key.url, await response!.text()); }
      }
      return { stores: JSON.stringify(stores), cache: cacheBodies.join("\n"), webStorage: JSON.stringify([localStorage, sessionStorage]) };
    } finally { database.close(); }
  });
  for (const value of Object.values(persisted)) for (const secret of [issued.token, credential.accessCredential, passphrase, "Recovery Provperson"]) expect(value).not.toContain(secret);
  await page.getByRole("button", { name: "Lås lokal lista", exact: true }).click();
  await expect(page.getByText("Recovery Provperson", { exact: true })).toHaveCount(0);
  await unlock(page); await expect(article).toContainText("Väntar på serverkvittens: 0");
  await page.screenshot({ path: testInfo.outputPath("recovery-complete.png"), fullPage: true });
  await clearForm.getByRole("checkbox").check(); await clearForm.getByRole("button").click();
  await expect(operationStatus(page)).toContainText("har raderats från denna webbläsare");
  await expect(article).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Lås upp lokal lista", exact: true })).toHaveCount(0);
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toHaveLength(2);
});
