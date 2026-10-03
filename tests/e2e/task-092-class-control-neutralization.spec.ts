import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { issuePairingAdminAccessCredential } from "@o-tid/application";
import { eq } from "drizzle-orm";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const { db, pool } = createDatabase(database);
test.afterAll(async () => pool.end());

test("TASK092 neutraliserar exakt kontrollförekomst med retry på 390px", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(setup.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("button", { name: "Under tävlingen", exact: true }).click();
  await page.getByRole("navigation", { name: "Tävlingsdagens arbetsytor", exact: true })
    .getByRole("button", { name: "Tid- & kontrollrättning", exact: true }).click();
  const panel = page.locator("details").filter({ hasText: "Neutralisera en kontroll för klass" });
  await panel.locator("summary").click();
  await panel.getByLabel("Klass", { exact: true }).selectOption(setup.classId);
  await panel.getByRole("button", { name: "Läs in kontrollföljd", exact: true }).click();
  await panel.getByLabel("Kontrollförekomst", { exact: true }).selectOption({ label: "#2 · kod 31" });
  await panel.getByLabel("Jag förstår att gamla resultat inte räknas om automatiskt.", { exact: true }).check();
  await panel.getByRole("button", { name: "Granska neutralisering", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("förekomst #2, kod 31");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const writes: string[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/classes/${setup.classId}/control-neutralization`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    writes.push(route.request().postData() ?? "");
    if (writes.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); return route.abort("failed"); }
    return route.continue();
  });
  await panel.getByRole("button", { name: "Bekräfta neutralisering", exact: true }).click();
  await expect(panel.getByText("Svaret är osäkert.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Bekräfta neutralisering", exact: true }).click();
  await expect.poll(async () => (await db.select().from(schema.classControlNeutralizations).where(eq(schema.classControlNeutralizations.raceId, setup.raceId))).length).toBe(1);
  expect(writes).toHaveLength(2); expect(writes[1]).toBe(writes[0]);
});

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), versionId = randomUUID(), classId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "TASK092 browser", startsOn: "2026-09-19", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Neutralisering", raceDate: "2026-09-19" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Bana" });
  await db.insert(schema.courseVersions).values({ id: versionId, courseId, version: 1 });
  const first = randomUUID(), second = randomUUID(), control = randomUUID();
  await db.insert(schema.controls).values({ id: control, raceId, code: 31 });
  await db.insert(schema.courseControls).values([{ id: first, courseVersionId: versionId, controlId: control, sequence: 1 }, { id: second, courseVersionId: versionId, controlId: control, sequence: 2 }]);
  await db.insert(schema.classes).values({ id: classId, raceId, name: "H21", courseVersionId: versionId, startRule: "PUNCH" });
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK092 browser", expiresAt: new Date(Date.now() + 3_600_000) });
  return { raceId, classId, accessCredential: issued.accessCredential };
}
