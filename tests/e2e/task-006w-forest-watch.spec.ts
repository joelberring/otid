import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { canonicalStartCheckinOperation, type StartCheckinOperation } from "@o-tid/contracts";
import { issuePairingAdminAccessCredential, loginPairingAdmin, registerStartCheckinDeviceAsAdmin, syncStartCheckinAsAdmin } from "@o-tid/application";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const { db, pool } = createDatabase(url);
test.afterAll(async () => pool.end());

test("TASK 006W privat målrapport: riktig HTTP/PG, grupper, mobil, filter, utskrift och auth", async ({ page, context }) => {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const freeClassId = randomUUID(), fixedClassId = randomUUID();
  const entryIds = Array.from({ length: 5 }, () => randomUUID());
  await db.insert(schema.events).values({ id: eventId, name: "Syntetiskt skogskontrollprov", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Målprov", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Provbana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values([
    { id: freeClassId, raceId, name: "Fri klass", courseVersionId, startRule: "PUNCH" },
    { id: fixedClassId, raceId, name: "Minutklass", courseVersionId, startRule: "FIXED" }
  ]);
  await db.insert(schema.entries).values(entryIds.map((id, index) => ({ id, raceId, classId: index === 0 ? fixedClassId : freeClassId,
    givenName: ["Startad", "Okänd", "Ejstart", "Återkommen", "Konflikt"][index]!, familyName: "Provperson",
    fixedStartTime: index === 0 ? new Date("2026-09-05T10:00:00Z") : null })));
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability: "FINISH_FOREST_WATCH", label: "E2E mål",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential },
    { expectedRaceId: raceId, expectedCapability: "FINISH_FOREST_WATCH" });
  if (login.status !== "authenticated") throw new Error("Fixture login failed");
  const auth = { raceId, capability: "FINISH_FOREST_WATCH" as const, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const deviceId = randomUUID();
  expect((await registerStartCheckinDeviceAsAdmin(db, { ...auth, readBody: async () => ({ formatVersion: 1, deviceId, label: "Målmobil E2E" }) })).status).toBe("registered");
  let sequence = 0;
  async function mark(index: number, state: "STARTED" | "UNMARKED" | "REPORTED_NOT_STARTED", returned: boolean, expectedRevision = 0) {
    const operation: StartCheckinOperation = { formatVersion: 1, requestId: randomUUID(), dependsOnRequestId: null, deviceId,
      actorCredentialId: credential.credentialId, raceId, entryId: entryIds[index]!, localSequence: ++sequence,
      packageVersion: 1, expectedEntryVersion: 1, expectedRevision, observedAt: new Date().toISOString(),
      action: { kind: "FINISH_CORRECTION", state, manualReturnRegistered: returned } };
    const result = await syncStartCheckinAsAdmin(db, { ...auth, readBody: async () => ({ operation,
      contentHash: createHash("sha256").update(canonicalStartCheckinOperation(operation)).digest("hex") }) });
    expect(result.status).toBe("stored");
  }
  await mark(0, "STARTED", false); await mark(2, "REPORTED_NOT_STARTED", false);
  await mark(3, "UNMARKED", true); await mark(4, "STARTED", false); await mark(4, "REPORTED_NOT_STARTED", false);
  let operationsBefore = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId));
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto(`/admin/${raceId}/forest-watch`);
  // Next dev overrides shell Cache-Control; the shell contains no person data.
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByLabel("Målpersonalens behörighet")).toBeVisible();
  await expect(page.getByText("Startad Provperson", { exact: true })).toHaveCount(0);
  await page.getByLabel("Målpersonalens behörighet").fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  const report = page.getByRole("region", { name: "Kvar i skogen – målpersonal" });
  await expect(report).toBeVisible();
  const privateResponse = await page.request.get(`/api/admin/races/${raceId}/finish-forest-watch/roster`);
  expect(privateResponse.headers()["cache-control"]).toContain("no-store");
  for (const state of ["STARTED_NO_RETURN", "UNCONFIRMED", "NOT_STARTED", "RETURNED", "CONFLICT"]) {
    await expect(page.locator(`[data-forest-group="${state}"] tbody tr`)).toHaveCount(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.getByRole("button", { name: "Skriv ut listan" }).boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: "test-results/task-006w-forest-mobile.png", fullPage: true });
  await page.getByLabel("Klassfilter", { exact: true }).selectOption(fixedClassId);
  await expect(report.getByText("Startad Provperson", { exact: true })).toBeVisible();
  await expect(report.getByText("Okänd Provperson", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Skriv ut listan" })).toBeHidden();
  await expect(report).toContainText("1 / 5"); await expect(report).toContainText("Offlineenheter");
  await expect(report).toContainText("Målmobil E2E");
  await page.screenshot({ path: "test-results/task-006w-forest-print.png", fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  // Explicit review never registers return; changed evidence requires fresh human review.
  const reviewPanel = page.getByRole("region", { name: "Granska mottagna konfliktrapporter" });
  await reviewPanel.getByLabel("Deltagare med ogranskade rapporter").selectOption(entryIds[4]!);
  await reviewPanel.getByRole("button", { name: "Hämta granskningsunderlag" }).click();
  await expect(reviewPanel.getByRole("heading", { name: "Mottagna men inte genomförda rapporter (1)" })).toBeVisible();
  await mark(4, "REPORTED_NOT_STARTED", false);
  operationsBefore = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId));
  await reviewPanel.getByLabel("Orsak till granskningsbeslut").fill("Kontrollerat vid mål, startuppgift behålls");
  await reviewPanel.getByRole("checkbox").check();
  await reviewPanel.getByRole("button", { name: "Bekräfta granskning – behåll registrerat läge" }).click();
  await expect(reviewPanel.getByRole("status")).toContainText("Underlaget har ändrats");
  expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, raceId))).toHaveLength(0);
  await reviewPanel.getByRole("button", { name: "Hämta granskningsunderlag" }).click();
  await expect(reviewPanel.getByRole("heading", { name: "Mottagna men inte genomförda rapporter (2)" })).toBeVisible();
  await reviewPanel.getByLabel("Orsak till granskningsbeslut").fill("Båda rapporterna kontrollerade vid mål");
  await reviewPanel.getByRole("checkbox").check();
  const reviewPath = `**/api/admin/races/${raceId}/finish-forest-watch/conflict-reviews`;
  const reviewBodies: string[] = [];
  await page.route(reviewPath, async route => {
    reviewBodies.push(route.request().postData()!);
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    if (reviewBodies.length === 1) await route.abort("failed");
    else await route.fulfill({ response: committed });
  });
  await reviewPanel.getByRole("button", { name: "Bekräfta granskning – behåll registrerat läge" }).click();
  await expect(reviewPanel.getByRole("status")).toContainText("Svaret är osäkert");
  await expect(reviewPanel.getByLabel("Orsak till granskningsbeslut")).toBeDisabled();
  await reviewPanel.getByRole("button", { name: "Försök igen med samma granskningsbeslut" }).click();
  await expect(reviewPanel.getByRole("status")).toContainText("Granskningen är sparad");
  expect(reviewBodies).toHaveLength(2); expect(reviewBodies[0]).toBe(reviewBodies[1]);
  expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, raceId))).toHaveLength(1);
  await page.unroute(reviewPath);
  await page.getByLabel("Klassfilter", { exact: true }).selectOption("");
  await expect(page.locator('[data-forest-group="STARTED_NO_RETURN"] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-forest-group="STARTED_NO_RETURN"]')).toContainText("Konflikt Provperson");
  await page.emulateMedia({ media: "print" }); await expect(reviewPanel).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Uppdatera lista" }).click();
  await expect(report.getByRole("alert")).toContainText("Uppdatering saknas");
  await context.setOffline(false);
  await page.getByRole("button", { name: "Uppdatera lista" }).click();
  await expect(report.getByRole("alert")).toHaveCount(0);
  // A delayed response cannot repopulate the list after local logout.
  let finishDelayed: () => void = () => undefined;
  const delayedFinished = new Promise<void>((resolve) => { finishDelayed = resolve; });
  await page.route(`**/api/admin/races/${raceId}/finish-forest-watch/roster`, async (route) => {
    const value = await route.fetch(); await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ response: value }); finishDelayed();
  });
  const pendingRead = page.waitForRequest((request) => request.url().endsWith("/finish-forest-watch/roster"));
  await page.getByRole("button", { name: "Uppdatera lista" }).click();
  await pendingRead;
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await delayedFinished;
  await expect(report).toHaveCount(0); await expect(page.getByLabel("Målpersonalens behörighet")).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/admin/races/${raceId}/finish-forest-watch/roster`)).status()).toBe(401);
  await page.unroute(`**/api/admin/races/${raceId}/finish-forest-watch/roster`);
  await page.getByLabel("Målpersonalens behörighet").fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(report).toBeVisible();
  await page.route(`**/api/admin/races/${raceId}/finish-forest-watch/roster`, (route) => route.fulfill({ status: 401, body: "" }));
  await page.getByRole("button", { name: "Uppdatera lista" }).click();
  await expect(report).toHaveCount(0);
  expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, raceId))).toEqual(operationsBefore);
});
