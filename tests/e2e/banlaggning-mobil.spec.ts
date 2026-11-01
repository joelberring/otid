import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/georef";
import type { MapGeoreference } from "../../packages/map-file/src/model";
import { createRace, openStep, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * Fältläget, första versionen (ADR-0181 beslut 6–7): banläggningen på en telefon (390 × 844) med fejkad position. Välj
 * kontroll 32, Min position, Flytta hit (medelvärdet under 5 s), en meter norrut, kolumn F = 1.5 och G = SO via
 * Uppgifter, och allt är sparat efter omladdning.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

/** Kartfilsfixturens georeferens (kartfil.omap: SWEREF 99 TM, 1:10 000, referenspunkten i kartans origo). */
const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const target = { x: 60, y: 50 };

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

type Document = { controls: Record<string, { kind: string; code?: string; at: { x: number; y: number };
  descriptions: { box: string; ref?: string; text?: string }[] }> };

test("banläggning på telefonen: min position, flytta hit, finjustera, F och G, sparat efter omladdning", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `banlaggning.mobil.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Banläggning mobil ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);

  // Kartfilen och .ppen laddas upp vid datorn.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByRole("link", { name: "Banläggning" }).click();
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible();
  // Bred skärm: knappen Min position finns på kartan, sidopanelerna som vanligt.
  await expect(owner.getByRole("button", { name: "Min position" })).toBeVisible();
  await expect(owner.getByTestId("course-setting-field")).toHaveCount(0);

  // Telefonen: samma konto, smal skärm, position på (60, 50) mm med ±5 m.
  const wgs = mapPointToWgs84(georeference, target);
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, geolocation: { latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 5 },
    permissions: ["geolocation"] });
  let phone = await phoneContext.newPage();
  const page = await phone.goto(`/admin/${raceId}/course-setting`);
  expect(page!.headers()["permissions-policy"]).toBe("camera=(), geolocation=(self), microphone=()");
  await expect(phone.getByTestId("course-setting-field")).toBeVisible();
  const map = phone.getByTestId("course-setting-map");
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-px-per-mm", /\d/);
  await phone.waitForTimeout(500);

  // Välj kontroll 32 (42, 61 mm) med fingret.
  const control = await screenOf(map, 42, 61);
  await phone.touchscreen.tap(control.x, control.y);
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 32");
  await screenshot(phone, "banlaggning-mobil-vald");

  // Min position och Flytta hit.
  await phone.getByRole("button", { name: "Min position" }).click();
  await expect(phone.getByText("Position ±5 m")).toBeVisible({ timeout: 15_000 });
  await screenshot(phone, "banlaggning-mobil-position");
  await phone.getByTestId("course-setting-move-here").click();
  await expect(phone.getByTestId("course-setting-move-here")).toContainText("Mäter");
  await expect(phone.getByTestId("course-setting-field-note")).toHaveText("Flyttad, noggrannhet ±5 m", { timeout: 15_000 });
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 15_000 });
  await screenshot(phone, "banlaggning-mobil-flyttad");

  // En meter norrut: 0,1 mm uppåt i 1:10 000.
  await phone.getByRole("button", { name: "Flytta 1 m norrut" }).click();

  // Uppgifter: F = 1.5 och G = SO.
  await phone.getByRole("button", { name: "Uppgifter" }).click();
  const sheet = phone.getByRole("dialog", { name: "Uppgifter för kontroll 32" });
  await sheet.getByRole("button", { name: "1.5", exact: true }).click();
  await expect(sheet.getByLabel("Höjd (kolumn F, m)")).toHaveValue("1.5");
  await sheet.getByRole("button", { name: "SO", exact: true }).click();
  await screenshot(phone, "banlaggning-mobil-uppgifter");
  await sheet.getByRole("button", { name: "Spara" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 15_000 });

  // Utan nät: "Inte sparat – försöker igen". Sidan stängs innan nätet kommer tillbaka; ändringen finns kvar i
  // webbläsaren och erbjuds när sidan öppnas igen.
  const status = () => phone.getByTestId("course-setting-field-status");
  // Steg 66: ändringarna sparas som åtgärder (POST course-setting/edits).
  await phone.route(`**${admin}/course-setting/edits`, route => route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue());
  await phone.getByRole("button", { name: "Flytta 1 m österut" }).click();
  await expect(status()).toHaveText("Inte sparat – försöker igen", { timeout: 15_000 });
  await screenshot(phone, "banlaggning-mobil-inte-sparat");
  await phone.close({ runBeforeUnload: false });
  phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByText(/osparade ändringar/)).toBeVisible();
  await screenshot(phone, "banlaggning-mobil-aterstall");
  await phone.getByRole("button", { name: "Återställ ändringarna" }).click();
  await expect(status()).toHaveText("Sparat", { timeout: 15_000 });

  // Omladdning: allt är sparat och inget erbjuds att återställa.
  await phone.reload();
  await expect(phone.getByTestId("course-setting-field")).toBeVisible();
  await expect(phone.getByText(/osparade ändringar/)).toHaveCount(0);
  const state = await (await phone.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const moved = Object.values(state.setting.document.controls).find(row => row.code === "32")!;
  expect(moved.at.x).toBeCloseTo(target.x + 0.1, 2);
  expect(moved.at.y).toBeCloseTo(target.y + 0.1, 2);
  expect(moved.descriptions.find(box => box.box === "F")).toEqual({ box: "F", text: "1.5" });
  expect(moved.descriptions.find(box => box.box === "G")).toEqual({ box: "G", ref: "11.1SE" });
  await screenshot(phone, "banlaggning-mobil-omladdad");
});
