import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { contentHash, ingestDeviceBatch, issuePairingAdminAccessCredential } from "@o-tid/application";
import { createDatabase, schema } from "@o-tid/database";
import { eq } from "drizzle-orm";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) {
  throw new Error("Explicit matching isolated database required");
}
const { db, pool } = createDatabase(database);
test.afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID();
  const courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetisk publik detalj", startsOn: "2026-09-19", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Detaljlopp", raceDate: "2026-09-19" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Syntetisk bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "H21", startRule: "FIXED" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Ada", familyName: "Löpare", organisationName: "Test OK",
    fixedStartTime: new Date("2026-09-19T10:00:00Z") });
  const cardNumber = `89${entryId.slice(0, 8)}`;
  await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber });
  const payload = {
    cardNumber,
    startPunchedAt: "2026-09-19T10:00:00Z",
    finishPunchedAt: "2026-09-19T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-19T10:10:00Z" }]
  };
  const deviceId = randomUUID();
  await ingestDeviceBatch(db, raceId, {
    deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T10:21:00Z", transport: "simulator", payload,
      contentHash: contentHash(payload) }]
  });
  const [entry] = await db.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  if (!entry) throw new Error("Synthetic entry missing");
  return { raceId, publicResultId: entry.publicResultId };
}

test("TASK089/TASK090/TASK287 public result list and speaker open the exact safe participant detail", async ({ page, request }) => {
  const { raceId, publicResultId } = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/results/${raceId}`);
  const favorite = page.getByRole("button", { name: "Spara favorit", exact: true });
  await favorite.click();
  await expect(page.getByRole("button", { name: "Ta bort favorit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Ta bort favorit", exact: true })).toBeVisible();
  const favoritesOnly = page.getByRole("checkbox", { name: "Visa bara mina favoriter", exact: true });
  await favoritesOnly.check();
  await expect(page.getByText("Ada Löpare", { exact: true })).toBeVisible();
  await favoritesOnly.uncheck();
  const storedFavorites = await page.evaluate(() => window.localStorage.getItem("otid:public-result-favorites:v1"));
  expect(storedFavorites).toContain(raceId); expect(storedFavorites).not.toMatch(/Ada|Löpare|Test OK/);
  const link = page.getByRole("link", { name: "Öppna resultat: Ada Löpare", exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(new RegExp(`^/results/${raceId}/participants/[0-9a-f-]{36}$`));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/results/${raceId}/participants/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
  await expect(page.getByText("Godkänt resultat", { exact: true })).toBeVisible();
  await page.getByText("Visa sträcktider", { exact: true }).click();
  await expect(page.getByText("Kontroll", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const detail = await request.get(href!);
  expect(detail.status()).toBe(200);
  expect(await detail.text()).not.toMatch(/entryId|cardNumber|readoutId|evaluation/i);
  const missing = await request.get(`/results/${raceId}/participants/${randomUUID()}`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toContain(publicResultId);

  const admin = await issuePairingAdminAccessCredential(db, {
    raceId, capability: "MANAGE_RACE", label: "TASK287 synthetic speaker browser",
    expiresAt: new Date(Date.now() + 3_600_000)
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/admin/${raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(admin.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("navigation", { name: "Arbetslägen", exact: true })
    .getByRole("button", { name: "Under tävlingen", exact: true }).click();
  await page.getByRole("navigation", { name: "Tävlingsdagens arbetsytor", exact: true })
    .getByRole("button", { name: "Speaker", exact: true }).click();
  const speaker = page.getByRole("region", { name: "Speaker", exact: true });
  const leaders = speaker.getByRole("region", { name: "Publika klassledare", exact: true });
  const feed = speaker.getByRole("region", { name: "Senaste resultatuppdateringarna", exact: true });
  await leaders.getByRole("button", { name: "Visa klassledare", exact: true }).click();
  const search = speaker.getByRole("searchbox", { name: "Sök i läst speakerunderlag", exact: true });
  await search.fill("Ada");
  const leaderLink = leaders.getByRole("table").getByRole("link", { name: "Visa publicerat resultat för Ada Löpare i ny flik", exact: true });
  await expect(leaderLink).toHaveAttribute("href", `/results/${raceId}/participants/${publicResultId}`);
  await expect(feed.getByRole("link")).toHaveCount(0);
  const [speakerDetail] = await Promise.all([page.waitForEvent("popup"), leaderLink.click()]);
  try {
    await expect(speakerDetail).toHaveURL(new RegExp(`/results/${raceId}/participants/${publicResultId}$`));
    await expect(speakerDetail.getByRole("heading", { name: "Ada Löpare", exact: true })).toBeVisible();
    await expect(speakerDetail.getByText("20:00", { exact: true })).toBeVisible();
    await speakerDetail.getByText("Visa sträcktider", { exact: true }).click();
    await expect(speakerDetail.getByRole("listitem").filter({ hasText: "Kontroll 31" })).toContainText("10:00");
    await expect(search).toHaveValue("Ada");
  } finally {
    await speakerDetail.close();
  }
});
