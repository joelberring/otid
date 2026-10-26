import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { addEntry, createRace, openStep, publishRace, registerAccount, reviewScreenshots, sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * Steg 52 (ADR-0176): kontrollkartan. En påhittad banfil med koordinater läses in, två löpare i H21 (Lång: 31 32 33 34 35 36)
 * läses av; Bo tar 32 sist och missar 35. Banor → Kontrollkarta visar belastningen och en bana; deltagarkortet visar
 * Bos stämplingar på kartan. Publikt finns "Visa på kartan" först när banorna är publika (alla har resultat).
 */
const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/iof/${name}`, import.meta.url));

async function readOut(page: Page, raceId: string, cardNumber: string, codes: number[]) {
  const start = Date.now() - 60 * 60_000;
  await sendReadout(page, raceId, { cardNumber, startPunchedAt: new Date(start).toISOString(),
    finishPunchedAt: new Date(start + (codes.length + 1) * 180_000).toISOString(),
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * 180_000).toISOString() })) });
}

async function expectNoPageScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("kontrollkartan: belastning, bana, deltagarens stämplingar och publikt först när banorna är publika", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `karta.${suffix}@exempel.se`, "Kim Karta");
  const raceId = await createRace(owner, `Kontrollkarta ${suffix}`, today(), "Tävling");
  await publishRace(owner);
  await owner.goto(`/admin/${raceId}/imports`);
  await owner.getByLabel("IOF XML 3.0").setInputFiles(fixture("course-file-kontrollkarta.xml"));
  await owner.getByRole("button", { name: "Importera", exact: true }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Filen är inläst" })).toBeVisible();
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmRoute(owner, `${admin}/control-map`);
  await warmRoute(owner, `${admin}/entries/00000000-0000-4000-8000-000000000000/control-map`);
  await warmRoute(owner, `/api/public/races/${raceId}/results/00000000-0000-4000-8000-000000000000/control-map`);
  // Anmälan kontrollerar dubbletter först; rutterna kompileras vid första anropet.
  await warmRoute(owner, `${admin}/registration-candidates`, "POST");
  await warmRoute(owner, `${admin}/registration`, "POST");
  await owner.goto(`/admin/${raceId}/manage`);
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Ek", club: "OK Skogen", card: "8301001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Ek", club: "OK Skogen", card: "8301002" });
  await readOut(owner, raceId, "8301001", [31, 32, 33, 34, 35, 36]);

  // Publikt med en löpare kvar: ingen karta.
  const visitor = await (await browser.newContext()).newPage();
  await expect(async () => {
    await visitor.goto(`/results/${raceId}`);
    await expect(visitor.getByRole("row", { name: /Ada Ek/ })).toContainText("Godkänd", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await visitor.getByRole("row", { name: /Ada Ek/ }).getByRole("link", { name: "Ada Ek" }).click();
  await visitor.waitForURL(/\/participants\//);
  await expect(visitor.getByRole("heading", { name: "Ada Ek" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Visa på kartan" })).toHaveCount(0);

  await readOut(owner, raceId, "8301002", [31, 33, 34, 36, 32]);

  // Banor → Kontrollkarta: belastningen per kontroll med tabell.
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Öppna kontrollkartan" }).click();
  const dialog = owner.getByRole("dialog", { name: "Kontrollkarta" });
  const map = dialog.getByRole("img", { name: "Kontrollkarta med kontroller, start och mål" });
  await expect(map).toBeVisible();
  await expect(map.locator("[data-control]")).toHaveCount(9);
  const table = dialog.getByRole("table", { name: "Belastning per kontroll" });
  // Stämplingar är förvalt när någon läst ut: 36 finns på alla tre banorna, 35 har bara Ada stämplat.
  await expect(table.getByRole("row", { name: /^36 3 3 2 2/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /^35 2 2 2 1/ })).toBeVisible();
  await reviewScreenshots(owner, "kontrollkarta-belastning");
  // Dialogen ryms på 390 px och rullar aldrig i sidled (tabellen rullar inom sin ruta).
  await owner.setViewportSize({ width: 390, height: 900 });
  expect(await dialog.evaluate(element => ({ inside: element.getBoundingClientRect().right <= window.innerWidth,
    scroll: element.scrollWidth - element.clientWidth }))).toEqual({ inside: true, scroll: 0 });
  await owner.setViewportSize({ width: 1280, height: 720 });

  // En bana: linjer och nummer, övriga kontroller nedtonade.
  await dialog.getByRole("button", { name: "Bana", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Bana", exact: true }).selectOption({ label: "Lång (H21)" });
  const course = dialog.getByRole("img", { name: "Kontrollkarta: Lång" });
  await expect(course).toBeVisible();
  await expect(course.locator('[data-control="32"]')).toHaveAttribute("data-tone", "course");
  await expect(course.locator('[data-control="37"]')).toHaveAttribute("data-tone", "dim");
  await reviewScreenshots(owner, "kontrollkarta-bana");
  await dialog.getByRole("button", { name: "Stäng" }).click();
  await expect(dialog).toHaveCount(0);

  // Deltagarkortet: Bo på kartan med saknad kontroll och fel ordning.
  await openStep(owner, "Anmälda");
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: /Bo Ek/ }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name: "Bo Ek" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await card.getByRole("button", { name: "Visa på kartan" }).click();
  await expect(card.getByText("Kontroll 35 saknas, mellan 34 och 36.")).toBeVisible();
  await expect(card.getByText("Kontroll 32 är stämplad i fel ordning (ska vara mellan 31 och 33).")).toBeVisible();
  await expect(card.getByRole("img", { name: "Karta: Bo Eks bana med stämplingarna" }).locator('[data-control="35"]'))
    .toHaveAttribute("data-tone", "missing");
  await card.getByRole("region", { name: "Visa på kartan" }).scrollIntoViewIfNeeded();
  await reviewScreenshots(owner, "kontrollkarta-deltagarkort");

  // Publikt: alla har resultat, banorna är publika. Bos sida har "Visa på kartan" med bara Bos bana.
  await visitor.goto(`/results/${raceId}`);
  await visitor.getByRole("row", { name: /Bo Ek/ }).getByRole("link", { name: "Bo Ek" }).click();
  await visitor.waitForURL(/\/participants\//);
  await visitor.getByRole("button", { name: "Visa på kartan" }).click();
  await expect(visitor.getByText("Kontroll 35 saknas, mellan 34 och 36.")).toBeVisible({ timeout: 30_000 });
  const runnerMap = visitor.getByRole("img", { name: "Karta: Bo Eks bana med stämplingarna" });
  await expect(runnerMap.locator("[data-control]")).toHaveCount(6);
  await reviewScreenshots(visitor, "kontrollkarta-publikt");
  await visitor.setViewportSize({ width: 390, height: 900 });
  await expectNoPageScroll(visitor);
});
