import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addPerson, createRace, openStep, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * Steg 66 (ADR-0181): samarbete i banläggningen med två användare i två webbläsare. Ägaren ger en hjälpare behörigheten
 * "föreslå"; hjälparens flytt blir ett förslag som syns hos ägaren, granskas ovanpå banan och godkänns, och båda ser
 * resultatet. En notis från hjälparen syns hos ägaren inom några sekunder. Två med "ändra" flyttar olika kontroller
 * samtidigt och båda ändringarna finns kvar. Skärmbilder vid 1440×900 och 390×844 när E2E_SCREENSHOT_DIR är satt.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
type Document = { controls: Record<string, { kind: string; code?: string; at: { x: number; y: number } }> };

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

/** Drar kontrollen i (x, y) mm `dx` mm åt höger. */
async function dragControl(page: Page, map: Locator, x: number, y: number, dx: number) {
  const from = await screenOf(map, x, y);
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2 * scale, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx * scale, from.y, { steps: 4 });
  await page.mouse.up();
}

async function openLong(page: Page) {
  await page.getByTestId("course-setting-view").selectOption({ label: "Lång" });
  const map = page.getByRole("img", { name: "Karta med banpåtryck: Lång" });
  await expect(map).toBeVisible();
  await expect(page.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
  return map;
}

async function shoot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  const before = page.viewportSize();
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${directory}/${name}-${width}x${height}.png` });
  }
  if (before) await page.setViewportSize(before);
}

const state = async (page: Page, raceId: string) => (await (await page.request.get(`/api/admin/races/${raceId}/administrator/course-setting`)).json()) as
  { setting: { version: number; document: Document } };
const byCode = (document: Document, code: string) => Object.values(document.controls).find(control => control.code === code)!;

test("banläggning tillsammans: förslag som godkänns, notis som syns direkt och två som ändrar samtidigt", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Samarbete ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);

  // Ägaren: kartfil och .ppen.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });

  // Hjälparen får "föreslå" och "Erik" får "ändra", som andra roller under Inställningar.
  const helperEmail = `hjalpare.${suffix}@exempel.se`, editorEmail = `erik.${suffix}@exempel.se`;
  const helper = await registerAccount(browser, helperEmail, "Hilda Hjälpare");
  const erik = await registerAccount(browser, editorEmail, "Erik Ändrare");
  const manage = await owner.context().newPage();
  await manage.goto(`/admin/${raceId}/manage`);
  await addPerson(manage, helperEmail, "Banläggning: föreslå");
  await addPerson(manage, editorEmail, "Banläggning: ändra");
  await openStep(manage, "Banor");
  await manage.close();

  // Hjälparen ser loppet i Mina tävlingar och öppnar banläggningen, men inte resten av tävlingen.
  await helper.reload();
  await expect(helper.getByText(`Samarbete ${suffix}`)).toBeVisible();
  await expect(helper.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(0);
  await helper.getByRole("button", { name: "Öppna banläggningen" }).click();
  await helper.waitForURL(/course-setting$/);
  await expect(helper.getByText("Du kan föreslå ändringar")).toBeVisible({ timeout: 30_000 });
  expect((await helper.request.get(`/api/admin/races/${raceId}/administrator/participants`)).status()).toBe(401);
  const helperMap = await openLong(helper);
  const ownerMap = await openLong(owner);
  await expect(owner.getByTestId("course-setting-presence")).toContainText("Hilda Hjälpare", { timeout: 15_000 });

  // Förslag: hjälparen flyttar 32 (42, 61 mm) 5 mm och skickar förslaget med en kommentar.
  const before = await state(owner, raceId);
  await dragControl(helper, helperMap, 42, 61, 5);
  await expect(helper.getByTestId("course-setting-suggesting")).toContainText("1 ändring");
  await helper.getByRole("tab", { name: "Förslag" }).click();
  await helper.getByLabel("Kommentar till förslaget").fill("Stenen syns bättre härifrån");
  await helper.getByTestId("course-setting-draft").getByRole("button", { name: "Skicka förslaget" }).click();
  await expect(helper.getByText("Förslaget är skickat.")).toBeVisible();
  expect((await state(owner, raceId)).setting.version).toBe(before.setting.version);

  // Ägaren ser förslaget inom några sekunder, granskar det ovanpå banan och godkänner.
  await owner.getByRole("tab", { name: /Förslag/ }).click();
  const suggestions = owner.getByTestId("course-setting-suggestions");
  await expect(suggestions.getByText(/Hilda Hjälpare.*1 ändring/)).toBeVisible({ timeout: 10_000 });
  await suggestions.getByRole("button", { name: "Granska" }).click();
  await expect(owner.getByTestId("course-setting-review")).toContainText("Flytta kontroll 32");
  await expect(owner.getByTestId("course-setting-review")).toContainText("Stenen syns bättre härifrån");
  await shoot(owner, "samarbete-forslag");
  await owner.getByRole("button", { name: "Godkänn alla" }).click();
  await expect(suggestions.getByText("1 ändring är gjorda.")).toBeVisible();
  const approved = await state(owner, raceId);
  expect(approved.setting.version).toBe(before.setting.version + 1);
  expect(byCode(approved.setting.document, "32").at.x).toBeCloseTo(47, 0);
  // Båda ser resultatet: hjälparens editor har läst in den nya versionen.
  await expect(owner.locator("main[data-version]")).toHaveAttribute("data-version", String(approved.setting.version));
  await expect(helper.locator("main[data-version]")).toHaveAttribute("data-version", String(approved.setting.version), { timeout: 10_000 });

  // Notis: hjälparen sätter en notis på kartan; ägaren ser den inom några sekunder.
  await helper.getByRole("button", { name: "Ny notis" }).click();
  // Övre delen av kartan: rutan med vald kontroll (32 är fortfarande vald) ligger nertill.
  const mapBox = (await helperMap.boundingBox())!;
  await helper.mouse.click(mapBox.x + mapBox.width * 0.7, mapBox.y + mapBox.height * 0.3);
  await helper.getByRole("form", { name: "Ny notis" }).getByLabel("Text").fill("Stenen saknas på kartan");
  await helper.getByRole("button", { name: "Spara notisen" }).click();
  await owner.getByRole("tab", { name: /Notiser/ }).click();
  await expect(owner.getByTestId("course-setting-notes").getByText("Stenen saknas på kartan")).toBeVisible({ timeout: 10_000 });
  await shoot(helper, "samarbete-hjalpare");

  // Två med "ändra" flyttar olika kontroller samtidigt (31 och 33): båda ändringarna finns kvar hos båda.
  await erik.reload();
  await erik.getByRole("button", { name: "Öppna banläggningen" }).click();
  await erik.waitForURL(/course-setting$/);
  const erikMap = await openLong(erik);
  const start = await state(owner, raceId);
  const c31 = byCode(start.setting.document, "31").at, c33 = byCode(start.setting.document, "33").at;
  await Promise.all([dragControl(owner, ownerMap, c31.x, c31.y, 4), dragControl(erik, erikMap, c33.x, c33.y, -4)]);
  await expect.poll(async () => {
    const now = (await state(owner, raceId)).setting.document;
    return [Math.round(byCode(now, "31").at.x - c31.x), Math.round(byCode(now, "33").at.x - c33.x)];
  }, { timeout: 20_000 }).toEqual([4, -4]);
  const final = await state(owner, raceId);
  for (const page of [owner, erik, helper]) {
    await expect(page.locator("main[data-version]")).toHaveAttribute("data-version", String(final.setting.version), { timeout: 15_000 });
  }
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat");
  await expect(erik.getByTestId("course-setting-status")).toHaveText("Sparat");
  await shoot(erik, "samarbete-andrare");

  // Banhemligheten gäller: utan inloggning syns varken dokumentet, notiserna eller förslagen.
  const visitor = await (await browser.newContext()).newPage();
  for (const path of ["course-setting", "course-setting/notes", "course-setting/suggestions"]) {
    expect((await visitor.request.get(`/api/admin/races/${raceId}/administrator/${path}`)).status()).toBe(401);
  }
});
