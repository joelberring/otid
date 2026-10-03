import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createEvent,
  importIofXml,
  issueStationCredential
} from "@o-tid/application";
import { publicResultListResponseSchema } from "@o-tid/contracts";
import { createDatabase } from "@o-tid/database";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) {
  throw new Error("Explicit matching isolated database required");
}
const { db, pool } = createDatabase(database);
test.afterAll(async () => pool.end());

async function createImportedRace(): Promise<string> {
  const created = await createEvent(db, {
    name: `TASK107 ${Date.now()}-${Math.random()}`,
    raceName: "Individuellt",
    raceDate: "2026-09-20",
    timeZone: "Europe/Stockholm"
  });
  for (const fixture of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, created.race.id, await readFile(resolve("fixtures/iof", fixture), "utf8"));
  }
  return created.race.id;
}

test("TASK107 station readout reaches an already open public mobile result page", async ({ page, context, request }) => {
  const raceId = await createImportedRace();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/results/${raceId}`);
  await expect(page.getByText("Inga publicerade resultat ännu.", { exact: true })).toBeVisible();

  const station = await context.newPage();
  try {
    await station.goto(`/admin/${raceId}/simulator`);
    await expect(station.getByText("Utvecklingsyta.", { exact: false })).toBeVisible();
    await expect(station.locator("small").filter({ hasText: "Enhet:" }))
      .toContainText(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
    const deviceId = await station.evaluate((id) => localStorage.getItem(`otid:${id}:device-id`), raceId);
    if (!deviceId) throw new Error("Station simulator did not create a device id");
    const credential = await issueStationCredential(db, {
      raceId, deviceId, scope: "READOUT", expiresAt: new Date(Date.now() + 3_600_000)
    });
    await station.getByLabel("Stationscredential", { exact: true }).fill(credential.token);
    await station.getByLabel("Bricknummer", { exact: true }).fill("12345");
    await station.getByLabel("Kontrollkoder, kommaseparerade", { exact: true }).fill("31,32,33");
    await station.getByRole("button", { name: "Simulera och skicka", exact: true }).click();
    await expect(station.getByRole("status")).toContainText("stored");

    const row = page.getByRole("row").filter({ hasText: "Ada Löpare" });
    await expect(row).toContainText("Godkänt resultat", { timeout: 12_000 });
    await expect(row).toContainText("H21");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const publicResponse = await request.get(`/api/public/races/${raceId}/results`);
    expect(publicResponse.status()).toBe(200);
    const publicBody = publicResultListResponseSchema.parse(await publicResponse.json());
    expect(publicBody.results).toHaveLength(1);
    expect(JSON.stringify(publicBody)).not.toMatch(/entryId|cardNumber|readoutId|resultRevisionId|rawPayload/i);

    const pollUrl = `**/api/public/races/${raceId}/results`;
    await page.route(pollUrl, route => route.abort("failed"));
    await expect(page.getByText("Resultatlistan kunde inte uppdateras. Senast verifierade resultat visas fortfarande.", { exact: true }))
      .toBeVisible({ timeout: 8_000 });
    await expect(row).toContainText("Ada Löpare");
    await expect(row).toContainText("Godkänt resultat");
  } finally {
    await station.close();
  }
});
