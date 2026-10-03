import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Steg 1 (ADR-0168): två behörighetsnivåer.
 * Konto → tävling → bana/klass/deltagare → bjud in en administratör →
 * den inbjudna kan arbeta → en utloggad besökare ser publikt men inte admin.
 */

const password = "hemligt-lösen-1";
const unique = () => Math.random().toString(36).slice(2, 8);

async function registerAccount(browser: Browser, loginName: string, displayName: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/organizer");
  await page.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await page.getByLabel("Ditt namn").fill(displayName);
  await page.getByLabel("Inloggningsnamn").fill(loginName);
  await page.getByLabel("Lösenord").fill(password);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  return page;
}

test("konto, tävling, medadministratör och publik vy", async ({ browser, request }) => {
  const suffix = unique();
  const owner = await registerAccount(browser, `anna.${suffix}`, "Anna Arrangör");

  // Skapa tävling.
  const eventName = `Klubbträning ${suffix}`;
  await owner.getByLabel("Eventnamn").fill(eventName);
  await owner.getByLabel("Loppets namn").fill("Torsdag");
  await owner.getByLabel("Datum").fill("2026-10-08");
  await owner.getByRole("button", { name: "Skapa tävling" }).last().click();
  await expect(owner.getByText("Tävlingen skapades.")).toBeVisible();

  // Öppna arbetsytan med kontot, utan någon separat behörighetskod.
  await owner.getByRole("button", { name: "Öppna arbetsytan" }).first().click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const raceId = owner.url().split("/").at(-2)!;
  await expect(owner.getByRole("heading", { name: eventName })).toBeVisible();

  // Bana och klass.
  await owner.getByRole("button", { name: "Öppna upplägg" }).click();
  await owner.getByRole("button", { name: "Banor", exact: true }).click();
  await owner.getByText("Förbered bana och klass").click();
  const courseForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Granska bana och klass" }) });
  await courseForm.getByLabel("Bannamn").fill("Lång");
  await courseForm.getByLabel("Klassnamn").fill("H21");
  await courseForm.getByLabel("Kontrollföljd").fill("31 32 33");
  await courseForm.getByRole("button", { name: "Granska bana och klass" }).click();
  await owner.getByRole("button", { name: "Bekräfta och spara" }).click();
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible();

  // Deltagare.
  await owner.getByRole("button", { name: "Deltagare", exact: true }).first().click();
  await owner.getByRole("button", { name: "Ny deltagare" }).click();
  const entryForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Granska anmälan" }) });
  await entryForm.getByLabel("Anmälningsklass").selectOption({ label: "H21" });
  await entryForm.getByLabel("Förnamn").fill("Eva");
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill("Löpare");
  await entryForm.getByLabel("Klubb").fill("OK Test");
  await entryForm.getByLabel("Bricknummer (valfritt)").fill("8001234");
  await entryForm.getByRole("button", { name: "Granska anmälan" }).click();
  await owner.getByRole("button", { name: "Bekräfta anmälan" }).click();
  await expect(owner.getByText("Deltagaren är anmäld.")).toBeVisible();

  // En annan person registrerar sig men ser ingenting förrän ägaren bjuder in.
  const helperLogin = `bertil.${suffix}`;
  const helper = await registerAccount(browser, helperLogin, "Bertil Hjälpare");
  await expect(helper.getByText("Inga tävlingar ännu")).toBeVisible();
  const helperForbidden = await helper.request.get(`/api/admin/races/${raceId}/administrator/participants`);
  expect(helperForbidden.status()).toBe(401);

  await owner.goto("/organizer");
  await owner.getByText("Visa medadministratörer").click();
  await owner.getByLabel("Befintligt kontos inloggningsnamn").fill(helperLogin);
  await owner.getByRole("button", { name: "Ge eventåtkomst" }).click();
  await expect(owner.getByText("aktiv åtkomst")).toBeVisible();

  await helper.reload();
  await expect(helper.getByText(eventName)).toBeVisible();
  await helper.getByRole("button", { name: "Öppna arbetsytan" }).first().click();
  await helper.waitForURL(/manage$/);
  await helper.getByRole("button", { name: "Deltagare", exact: true }).first().click();
  await expect(helper.getByRole("button", { name: "Eva Löpare OK Test" })).toBeVisible();

  // Utloggad besökare: publika sidor fungerar, admin-API nekas.
  const publicResults = await request.get(`/results/${raceId}`);
  expect(publicResults.status()).toBe(200);
  const startList = await request.get(`/starts/${raceId}`);
  expect(startList.status()).toBe(200);
  const adminApi = await request.get(`/api/admin/races/${raceId}/administrator/participants`);
  expect(adminApi.status()).toBe(401);
});
