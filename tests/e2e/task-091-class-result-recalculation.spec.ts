import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { ingestDeviceBatch, issuePairingAdminAccessCredential } from "@o-tid/application";
import { eq } from "drizzle-orm";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const { db, pool } = createDatabase(database);
test.afterAll(async () => pool.end());

test("TASK091 granskar, retryar och sparar en atomisk klassomräkning utan sidscroll", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(setup.admin.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("button", { name: "Efter tävlingen", exact: true }).click();

  const panel = page.locator("details").filter({ hasText: "Räkna om flera resultat" });
  await panel.locator("summary").click();
  await panel.locator("select").selectOption(setup.classId);
  await panel.getByRole("button", { name: "Hämta klassunderlag", exact: true }).click();
  await expect(panel).toContainText("Ada Ett");
  await expect(panel).toContainText("Bea Två");
  await expect(panel).toContainText("Tekniskt redo för omräkning.");
  await panel.getByRole("button", { name: "Välj alla tekniskt redo", exact: true }).click();
  await expect(panel).toContainText("2 valda (högst 100)");
  await panel.getByRole("button", { name: "Granska klassomräkning", exact: true }).click();
  const review = panel.getByRole("alert");
  await expect(review).toContainText("Manifesthash");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const writes: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/classes/${setup.classId}/result-recalculation`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (writes.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); return route.abort("failed"); }
    return route.continue();
  });
  await review.getByRole("button", { name: "Bekräfta atomisk omräkning", exact: true }).click();
  await expect(page.getByText("Svaret saknas. Omräkningen kan vara sparad. Försök igen med samma begäran.", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(panel).toContainText("Klassomräkningen är sparad för 2 deltagare.");
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  expect(await db.select().from(schema.classResultRecalculations).where(eq(schema.classResultRecalculations.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.classResultRecalculationItems).where(eq(schema.classResultRecalculationItems.raceId, setup.raceId))).toHaveLength(2);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(4);
  expect(revisions.filter((row) => row.cause === "EXPLICIT_RECALCULATION")).toHaveLength(2);
});

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), controlId = randomUUID(), entryIds = [randomUUID(), randomUUID()];
  await db.insert(schema.events).values({ id: eventId, name: "TASK091 browser", startsOn: "2026-09-19", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Klassomräkning", raceDate: "2026-09-19" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Bana 091" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, name: "H21", courseVersionId, startRule: "PUNCH" });
  for (const [index, entryId] of entryIds.entries()) {
    const cardNumber = String(910001 + index);
    await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: index === 0 ? "Ada" : "Bea", familyName: index === 0 ? "Ett" : "Två" });
    await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber });
    const payload = { cardNumber, startPunchedAt: "2026-09-19T10:00:00Z", finishPunchedAt: `2026-09-19T10:2${index}:00Z`, punches: [{ code: 31, punchedAt: "2026-09-19T10:10:00Z" }] };
    const deviceId = randomUUID();
    expect((await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: `2026-09-19T10:3${index}:00Z`, transport: "simulator", payload,
        contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] })).acknowledgements[0]?.status).toBe("stored");
  }
  await db.update(schema.races).set({ snapshotVersion: 2 }).where(eq(schema.races.id, raceId));
  const admin = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK091 browser", expiresAt: new Date(Date.now() + 3_600_000) });
  return { raceId, classId, admin };
}
