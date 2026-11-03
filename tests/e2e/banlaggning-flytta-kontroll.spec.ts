import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/georef";
import type { MapGeoreference } from "../../packages/map-file/src/model";
import { createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * Frågan när en delad kontroll flyttas långt i en bana (som Purple Pen): Lång och Mellan har båda 31, 32, 33 och 36
 * (fixturen, 1:10 000, 1 mm = 10 m). En kort flytt och en kontroll som bara finns i Lång frågar inte. 31 dras långt:
 * "Ny kontroll bara i Lång" ger 38 i Lång, Mellan har 31 kvar på sin plats; ångra och gör om; sparat efter omladdning.
 * 32: "Flytta i alla banor" med "Kom ihåg", så att 33 flyttas utan fråga; "Fråga igen" i Inställningar och Avbryt för 36.
 * Fältläget på telefonen (390 px): "Flytta hit" ställer samma fråga.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };

type Document = {
  controls: Record<string, { kind: string; code?: string; at: { x: number; y: number } }>;
  courseControls: Record<string, { control: string; next?: string }>;
  courses: { id: string; name: string; first?: string }[];
};

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

/** Drar kontrollen i (x, y) mm `dx` mm åt höger och `dy` mm uppåt. */
async function drag(page: Page, map: Locator, x: number, y: number, dx: number, dy = 0) {
  const from = await screenOf(map, x, y);
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2 * scale, from.y - dy / 2 * scale, { steps: 4 });
  await page.mouse.move(from.x + dx * scale, from.y - dy * scale, { steps: 4 });
  await page.mouse.up();
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
}

/** Banans koder i ordning (första grenen), start och mål som "·". */
function codes(document: Document, name: string): string[] {
  const course = document.courses.find(row => row.name === name)!;
  const out: string[] = [];
  for (let id = course.first; id; id = document.courseControls[id]!.next) out.push(document.controls[document.courseControls[id]!.control]!.code ?? "·");
  return out;
}

const byCode = (document: Document, code: string) => Object.values(document.controls).find(control => control.code === code);

test("banläggning: flytta en delad kontroll långt – ny kontroll bara i banan, i alla banor, kom ihåg, avbryt och i fältläget", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `flytta.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Flytta kontroll ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  const documentNow = async (page: Page = owner) => ((await (await page.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } })
    .setting.document;
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByRole("img", { name: "Karta med banpåtryck: Lång" });
  await expect(map).toBeVisible();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
  const question = owner.getByTestId("course-setting-move-question");
  let current = await documentNow();
  expect(codes(current, "Lång")).toEqual(["·", "31", "32", "33", "34", "35", "36", "·"]);
  expect(codes(current, "Mellan")).toEqual(["·", "31", "32", "33", "36", "·"]);

  // En kort flytt (30 m) frågar inte, och inte heller en kontroll som bara finns i Lång (34, 80 m).
  await drag(owner, map, 15, 42, 3);
  await saved(owner);
  await drag(owner, map, 98, 30, -8);
  await saved(owner);
  await expect(question).toHaveCount(0);
  current = await documentNow();
  expect(byCode(current, "31")!.at.x).toBeCloseTo(18, 0);
  expect(byCode(current, "34")!.at.x).toBeCloseTo(90, 0);

  // 31 långt (80 m upp): frågan med Mellan; Ny kontroll bara i Lång.
  await drag(owner, map, 18, 42, 0, 8);
  await expect(question).toBeVisible();
  await expect(question).toContainText("Flytta kontroll 31?");
  await expect(owner.getByTestId("course-setting-move-courses")).toHaveText("Mellan");
  await expect(owner.getByTestId("course-setting-move-all")).toContainText("Flytta i alla banor (2)");
  await expect(owner.getByTestId("course-setting-move-new")).toContainText("Ny kontroll bara i Lång");
  await screenshot(owner, "flytta-kontroll-fraga-1280");
  await owner.getByTestId("course-setting-move-new").click();
  await expect(question).toHaveCount(0);
  await expect(owner.getByText("Ny kontroll 38 i Lång; 31 står kvar i de andra banorna.")).toBeVisible();
  await expect(owner.getByTestId("course-setting-selected")).toHaveText("Vald: kontroll 38");
  await saved(owner);
  await screenshot(owner, "flytta-kontroll-ny-1280");
  current = await documentNow();
  expect(codes(current, "Lång")).toEqual(["·", "38", "32", "33", "34", "35", "36", "·"]);
  expect(codes(current, "Mellan")).toEqual(["·", "31", "32", "33", "36", "·"]);
  expect(byCode(current, "31")!.at.y).toBeCloseTo(42, 0);
  expect(byCode(current, "38")!.at).toEqual(expect.objectContaining({ y: expect.closeTo(50, 0) }));

  // Ett steg: ångra och gör om.
  await owner.getByRole("button", { name: "Ångra" }).click();
  await saved(owner);
  current = await documentNow();
  expect(codes(current, "Lång")[1]).toBe("31");
  expect(byCode(current, "38")).toBeUndefined();
  await owner.keyboard.press("Control+y");
  await saved(owner);

  // Sparat efter omladdning.
  await owner.reload();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  await expect(owner.getByTestId("course-setting-course").filter({ hasText: "Lång" })).toBeVisible();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
  current = await documentNow();
  expect(codes(current, "Lång")).toEqual(["·", "38", "32", "33", "34", "35", "36", "·"]);
  expect(codes(current, "Mellan")[1]).toBe("31");
  await expect(owner.getByTestId("course-setting-control-list")).toContainText("38");

  // 32 långt: Flytta i alla banor och Kom ihåg; 33 flyttas sedan utan fråga i båda banorna.
  await drag(owner, map, 42, 61, 8);
  await expect(question).toBeVisible();
  await owner.getByTestId("course-setting-move-remember").check();
  await owner.getByTestId("course-setting-move-all").click();
  await saved(owner);
  await drag(owner, map, 76, 52, 0, -8);
  await expect(owner.getByText("33 flyttades i alla banor (valet du sparat för sessionen).")).toBeVisible();
  await saved(owner);
  await expect(question).toHaveCount(0);
  current = await documentNow();
  expect(byCode(current, "32")!.at.x).toBeCloseTo(50, 0);
  expect(byCode(current, "33")!.at.y).toBeCloseTo(44, 0);
  expect(codes(current, "Mellan")).toEqual(["·", "31", "32", "33", "36", "·"]);

  // Inställningar: valet syns och "Fråga igen"; gränsen går att välja. Sedan frågar 36 igen, och Avbryt lämnar den.
  await owner.getByRole("tab", { name: "Inställningar" }).click();
  const settings = owner.getByTestId("course-setting-move-settings");
  await expect(settings.getByTestId("course-setting-move-remembered")).toHaveText("Sparat för sessionen: flytta i alla banor.");
  await expect(settings.getByTestId("course-setting-move-threshold")).toHaveValue("50");
  await settings.scrollIntoViewIfNeeded();
  await screenshot(owner, "flytta-kontroll-installningar-1280");
  await settings.getByTestId("course-setting-move-forget").click();
  await expect(settings.getByTestId("course-setting-move-remembered")).toHaveText("Inget val sparat: frågan visas.");
  const before36 = byCode(await documentNow(), "36")!.at;
  await drag(owner, map, 50, 18, -8);
  await expect(question).toBeVisible();
  await owner.getByTestId("course-setting-move-cancel").click();
  await expect(question).toHaveCount(0);
  await saved(owner);
  expect(byCode(await documentNow(), "36")!.at).toEqual(before36);

  // Fältläget på telefonen: position vid (60, 50) mm, 36 väljs och "Flytta hit" frågar.
  const wgs = mapPointToWgs84(georeference, { x: 60, y: 50 });
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, geolocation: { latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 5 }, permissions: ["geolocation"] });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  const phoneMap = phone.getByTestId("course-setting-map");
  await expect(phone.getByTestId("course-setting-field")).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await expect(phoneMap).toHaveAttribute("data-px-per-mm", /\d/);
  await phone.getByTestId("course-setting-field-course").selectOption({ label: "Lång" });
  await phone.getByRole("button", { name: "Visa hela kartan" }).click();
  await phone.waitForTimeout(400);
  const at36 = await screenOf(phoneMap, before36.x, before36.y);
  await phone.touchscreen.tap(at36.x, at36.y);
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 36");
  await phone.getByRole("button", { name: "Min position" }).click();
  await expect(phone.getByText("Position ±5 m")).toBeVisible({ timeout: 15_000 });
  await phone.getByTestId("course-setting-move-here").click();
  const phoneQuestion = phone.getByTestId("course-setting-move-question");
  await expect(phoneQuestion).toBeVisible({ timeout: 15_000 });
  await expect(phoneQuestion).toContainText("Flytta kontroll 36?");
  expect(await phone.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  const dialogBox = (await phoneQuestion.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
  await screenshot(phone, "flytta-kontroll-fraga-390");
  await phone.getByTestId("course-setting-move-new").click();
  await expect(phone.getByTestId("course-setting-field-note")).toHaveText("Ny kontroll 39 i Lång; 36 står kvar i de andra banorna. Flyttad, noggrannhet ±5 m");
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 15_000 });
  await screenshot(phone, "flytta-kontroll-ny-390");
  current = await documentNow(phone);
  expect(codes(current, "Lång")).toEqual(["·", "38", "32", "33", "34", "35", "39", "·"]);
  expect(codes(current, "Mellan")).toEqual(["·", "31", "32", "33", "36", "·"]);
  expect(byCode(current, "39")!.at.x).toBeCloseTo(60, 0);
  expect(byCode(current, "39")!.at.y).toBeCloseTo(50, 0);
  expect(byCode(current, "36")!.at).toEqual(before36);
  await phoneContext.close();
});
