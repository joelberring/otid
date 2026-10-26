import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, openStep, publishRace, registerAccount, sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * Steg 52 (ADR-0176): banhemlighet. Under tävlingen visar den publika resultatlistan, deltagarsidan och API:t ingen
 * gafflingsbild och inga kontrollägen (variantkoden och sträcktiderna står kvar). Arrangören ser allt. "Visa banorna publikt
 * nu" i Publicera visar dem för alla, och valet går att ångra.
 */
const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/iof/${name}`, import.meta.url));

async function importFile(page: Page, name: string, summary: string) {
  await page.getByLabel("IOF XML 3.0").setInputFiles(fixture(name));
  await page.getByRole("button", { name: "Importera", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Filen är inläst" })).toContainText(summary);
}

// Variant AD i course-data-forked.xml.
const variantAd = [31, 50, 41, 42, 50, 43, 44, 50, 32, 60, 63, 64, 60, 61, 62, 60, 33];

test("banorna är hemliga publikt tills arrangören visar dem, och arrangören ser dem hela tiden", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `hemlig.${suffix}@exempel.se`, "Hedda Hemlig");
  const raceId = await createRace(owner, `Hemliga banor ${suffix}`, today(), "Tävling med gafflade banor");
  await publishRace(owner);
  await owner.goto(`/admin/${raceId}/imports`);
  await importFile(owner, "course-data-forked.xml", "2 banor och 2 klasser, 4 varianter");
  await importFile(owner, "entry-list-forked.xml", "7 deltagare");
  await importFile(owner, "course-assignment-forked.xml", "4 löpare fick sin variant");
  const start = Date.now() - 90 * 60_000;
  await sendReadout(owner, raceId, { cardNumber: "8101003", startPunchedAt: new Date(start).toISOString(),
    finishPunchedAt: new Date(start + (variantAd.length + 1) * 120_000).toISOString(),
    punches: variantAd.map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * 120_000).toISOString() })) });

  // Besökaren: Cia med variant och sträcktider, men ingen gafflingsbild i listan, på deltagarsidan eller i API:t.
  const visitor = await (await browser.newContext()).newPage();
  await expect(async () => {
    await visitor.goto(`/results/${raceId}`);
    await expect(visitor.getByRole("row", { name: /Cia Holm/ })).toContainText("Godkänd", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(visitor.getByRole("row", { name: /Cia Holm/ })).toContainText("Variant AD");
  await expect(visitor.getByRole("button", { name: "Visa gafflingar: H21" })).toHaveCount(0);
  const hidden = await (await visitor.request.get(`/api/public/races/${raceId}/results`)).text();
  expect(hidden).not.toMatch(/"forking"|latitude|longitude/);
  expect(hidden).toContain("\"courseVariantCode\":\"AD\"");
  await visitor.getByRole("row", { name: /Cia Holm/ }).getByRole("link", { name: "Cia Holm" }).click();
  await visitor.waitForURL(/\/participants\//);
  const participant = visitor.url();
  await expect(visitor.getByText("Variant AD").first()).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Visa gafflingar", exact: true })).toHaveCount(0);

  // Arrangören ser gafflingsbilden på den publika sidan (inloggad) och läget i Publicera.
  const ownerPublic = await owner.context().newPage();
  await ownerPublic.goto(`/results/${raceId}`);
  await ownerPublic.getByRole("button", { name: "Visa gafflingar: H21" }).click();
  await expect(ownerPublic.getByRole("img", { name: "Banbild: Cia Holm sprang variant AD" })).toBeVisible();
  await ownerPublic.close();
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-secrecy`);
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Publicera");
  const secrecy = owner.getByRole("region", { name: "Banorna publikt" });
  await expect(secrecy).toContainText("Banorna är hemliga publikt. 6 löpare har inget resultat än.");
  await secrecy.getByRole("button", { name: "Visa banorna publikt nu" }).click();
  await expect(secrecy).toContainText("Banorna syns publikt: du har valt att visa dem.");

  // Nu ser besökaren bilden i listan och på deltagarsidan, och API:t har den.
  await visitor.goto(`/results/${raceId}`);
  await visitor.getByRole("button", { name: "Visa gafflingar: H21" }).click();
  await expect(visitor.getByRole("img", { name: "Banbild: Cia Holm sprang variant AD" })).toBeVisible();
  expect(await (await visitor.request.get(`/api/public/races/${raceId}/results`)).text()).toContain("\"forking\"");
  await visitor.goto(participant);
  await visitor.getByRole("button", { name: "Visa gafflingar", exact: true }).click();
  await expect(visitor.getByRole("img", { name: "Banbild: Cia Holm sprang variant AD" })).toBeVisible();

  // Ångra: banorna är hemliga igen.
  await secrecy.getByRole("button", { name: "Dölj banorna igen" }).click();
  await expect(secrecy).toContainText("Banorna är hemliga publikt.");
  await visitor.goto(`/results/${raceId}`);
  await expect(visitor.getByRole("row", { name: /Cia Holm/ })).toContainText("Variant AD");
  await expect(visitor.getByRole("button", { name: "Visa gafflingar: H21" })).toHaveCount(0);
  expect(await (await visitor.request.get(`/api/public/races/${raceId}/results`)).text()).not.toContain("\"forking\"");
});
