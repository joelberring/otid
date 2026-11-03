import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, openStep, registerAccount, reviewScreenshots, today, unique, warmCourseSetting } from "./helpers";

/**
 * Steg 62 (ADR-0180): banläggningen i webben. Kartfilen och en .ppen (Purple Pen) laddas upp på sidan, banan syns, en
 * kontroll flyttas med musen, en ny bana byggs med klick (start, tre kontroller, mål), ångra tar bort ett steg, sidan
 * laddas om (allt är sparat) och dokumentet förs över till tävlingen som en banfil. Ringklippen slås på och görs fasta.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

/** Skärmpunkten för kartans mm (y uppåt) ur kartans vy (`data-center`, `data-px-per-mm`). */
async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function clickMap(page: Page, map: Locator, x: number, y: number) {
  const at = await screenOf(map, x, y);
  await page.mouse.click(at.x, at.y);
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
}

type Document = { controls: Record<string, { kind: string; code?: string; at: { x: number; y: number }; circleGaps?: unknown[] }>;
  courses: { id: string; name: string }[]; event: { circleCutting?: { overlap: boolean; details: boolean } } };

test("banläggning: .ppen in, flytta, ny bana med klick, ångra, sparat efter omladdning och överfört till tävlingen", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `banlaggning.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Banläggning ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);

  // Länken från Banor.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByRole("link", { name: "Banläggning" }).click();
  await expect(owner.getByRole("heading", { name: "Banläggning", level: 1 })).toBeVisible();

  // Utan kartfil: ladda upp den här.
  await expect(owner.getByText("Banläggningen ritas på kartfilen (OCAD eller Mapper). Ladda upp kartfilen först.")).toBeVisible();
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });

  // .ppen från Purple Pen: läses i webbläsaren och sparas.
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible();
  await expect(owner.getByTestId("course-setting-course")).toHaveCount(2);
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByRole("img", { name: "Karta med banpåtryck: Lång" });
  await expect(map).toBeVisible();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await expect(owner.getByTestId("course-setting-course").filter({ hasText: "Lång" })).toContainText("6 kontroller");
  // Steg 66: arbetsytan fyller fönstret och sidan skrollar inte.
  expect(await owner.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight + 1)).toBe(true);
  await reviewScreenshots(owner, "banlaggning-inlast");

  // Flytta kontroll 32 (42, 61 mm) 5 mm åt höger med musen.
  const from = await screenOf(map, 42, 61);
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  await owner.mouse.move(from.x, from.y);
  await owner.mouse.down();
  await owner.mouse.move(from.x + 2.5 * scale, from.y, { steps: 4 });
  await owner.mouse.move(from.x + 5 * scale, from.y, { steps: 4 });
  await owner.mouse.up();
  await expect(owner.getByTestId("course-setting-selected")).toHaveText("Vald: kontroll 32");
  await saved(owner);

  // Vald sträcka ger vägvalens besked.
  await owner.getByRole("button", { name: "Välj och flytta" }).click();
  const legFrom = await screenOf(map, 76, 52), legTo = await screenOf(map, 92, 48);
  await owner.mouse.click((legFrom.x + legTo.x) / 2, (legFrom.y + legTo.y) / 2);
  await expect(owner.getByTestId("course-setting-selected")).toHaveText("Sträckan kontroll 33–kontroll 34");
  await owner.getByRole("tab", { name: "Vald" }).click();
  await expect(owner.getByTestId("course-setting-leg").getByText(/Fågelväg/)).toBeVisible({ timeout: 60_000 });

  // Ny bana med tre kontroller, byggd med klick.
  await owner.getByRole("tab", { name: "Banor" }).click();
  await owner.getByLabel("Namn på ny bana").fill("Kort");
  await owner.getByRole("button", { name: "Ny bana" }).click();
  const short = owner.getByRole("img", { name: "Karta med banpåtryck: Kort" });
  await expect(short).toBeVisible();
  await owner.getByRole("button", { name: "Ny start" }).click();
  await clickMap(owner, short, 60, 30);
  await owner.getByRole("button", { name: "Ny kontroll" }).click();
  for (const [x, y] of [[70, 40], [86, 42], [66, 64], [56, 80]] as const) await clickMap(owner, short, x, y);
  await owner.getByRole("button", { name: "Nytt mål" }).click();
  await clickMap(owner, short, 58, 26);
  const kort = owner.getByTestId("course-setting-course").filter({ hasText: "Kort" });
  await expect(kort).toContainText("4 kontroller");
  // Ångra två gånger: målet och den fjärde kontrollen.
  await owner.getByRole("button", { name: "Ångra" }).click();
  await owner.keyboard.press("Control+z");
  await expect(kort).toContainText("3 kontroller");
  await owner.getByRole("button", { name: "Nytt mål" }).click();
  await clickMap(owner, short, 58, 26);
  await expect(kort).toContainText("3 kontroller");
  await saved(owner);
  await reviewScreenshots(owner, "banlaggning-ny-bana");

  // Ringklipp (ADR-0180 beslut 10, i lådans Inställningar): valen sparas i dokumentet och detaljklippen kan göras fasta.
  await owner.getByRole("tab", { name: "Inställningar" }).click();
  await owner.getByLabel(/Klipp ringar där de överlappar/).check();
  await owner.getByLabel(/Klipp ringar över viktiga detaljer/).check();
  await expect(owner.getByText("Räknar klippen …")).toHaveCount(0, { timeout: 30_000 });
  await owner.getByRole("button", { name: "Gör klippen fasta (för Purple Pen)" }).click();
  await expect(owner.getByText(/fick fasta klipp|Klippen var redan fasta/)).toBeVisible();
  await saved(owner);

  // Ladda om: allt är sparat.
  await owner.reload();
  await expect(owner.getByTestId("course-setting-course").filter({ hasText: "Kort" })).toContainText("3 kontroller");
  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { version: number; document: Document } };
  const moved = Object.values(state.setting.document.controls).find(control => control.code === "32")!;
  expect(moved.at.x).toBeCloseTo(47, 0);
  expect(moved.at.y).toBeCloseTo(61, 0);
  expect(state.setting.document.event.circleCutting).toEqual({ overlap: true, details: true });
  await owner.getByRole("tab", { name: "Inställningar" }).click();
  await expect(owner.getByLabel(/Klipp ringar över viktiga detaljer/)).toBeChecked();
  expect(Object.values(state.setting.document.controls).filter(control => control.kind === "NORMAL").map(control => control.code).sort())
    .toEqual(["31", "32", "33", "34", "35", "36", "37", "38", "39", "40"]);

  // Överför till tävlingen (Fil-menyn): banfilens förhandsvisning och godkännandet.
  await owner.getByRole("button", { name: /^Fil/ }).click();
  // Menyn ryms i fönstret (den hamnade utanför till höger).
  const menuBox = (await owner.getByRole("menu").boundingBox())!;
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(owner.viewportSize()!.width);
  await owner.getByRole("menuitem", { name: "Överför till tävlingen …" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Överför till tävlingen" }).click();
  const review = owner.getByRole("region", { name: /Banläggningen, version \d+/ });
  await expect(review.getByText("Kort", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: /^Godkänn \d+ ändring/ }).click();
  await expect(owner.getByText(/Klart|sparad|ändring/).first()).toBeVisible();
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  const table = owner.getByRole("region", { name: /Banor/ }).first();
  for (const name of ["Lång", "Mellan", "Kort"]) await expect(table.getByText(name, { exact: true }).first()).toBeVisible();

  // Banhemligheten: dokumentet är bara för admin.
  const visitor = await (await browser.newContext()).newPage();
  expect((await visitor.request.get(`${admin}/course-setting`)).status()).toBe(401);
  expect((await visitor.request.get(`${admin}/course-setting/original`)).status()).toBe(401);
});
