import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/georef";
import type { MapGeoreference } from "../../packages/map-file/src/model";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0199: varningarna i banläggningen. Kartfilen och kartfil.ppen (kontrollernas id: 33 = 4, 34 = 5, 35 = 6, 36 = 7, mål = 9) läses in och
 * fem förbjudna områden läggs ut: ett tvärs över sträckan 33–34 (vägvalet går runt: ingen varning, en rad i Vald sträcka)
 * och fyra som ramar in kontroll 36 (ingen laglig väg dit: fel). Godta → fliken räknar ned → omladdning → fortfarande
 * godtagen → Ångra. Visa: varningarnas och de kollade kontrollernas markeringar går att släcka och förblir släckta.
 * Fältläget i telefonen utan nät: den valda raden och statusen ryms på 390 px.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function shot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const badge = (page: Page) => page.locator("#course-setting-tab-checks");
const marks = (page: Page) => page.getByTestId("course-setting-overprint");

test("banläggning-varningar: vägval runt förbjudet område, inringad kontroll, godta, omladdning, ångra och Visa", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `varningar.${suffix}@exempel.se`, "Kim Lindqvist");
  const raceId = await createRace(owner, `Varningar ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });

  // De förbjudna områdena som åtgärder (som editorn sparar dem).
  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { version: number } };
  const csrf = (await owner.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
  const areas = [rect(84, 38, 90, 44), rect(44, 12, 46, 24), rect(54, 12, 56, 24), rect(44, 12, 56, 14), rect(44, 22, 56, 24)];
  const saved = await owner.request.post(`${admin}/course-setting/edits`, {
    headers: { origin: new URL(owner.url()).origin, "x-otid-csrf": csrf, "content-type": "application/json" },
    data: { formatVersion: 1, requestId: randomUUID(), baseVersion: state.setting.version,
      edits: areas.map(points => ({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points } })) } });
  expect(saved.status()).toBe(200);
  await owner.reload();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });

  // Varningar: medan vägvalen räknas står fågelvägarna som notiser; sedan bara sträckorna utan laglig väg, som fel.
  await badge(owner).click();
  const panel = owner.getByTestId("course-setting-checks");
  const noRoute = panel.locator('[data-group="ERROR:LEG_NO_ROUTE"]');
  await expect(noRoute).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByRole("status").filter({ hasText: "Räknar vägvalen" })).toHaveCount(0, { timeout: 120_000 });
  // Kontroll 36 är inringad: 35–36 (Lång), 33–36 (Mellan) och 36–mål på båda banorna (en rad).
  await expect(noRoute.getByTestId("course-setting-check")).toHaveCount(3);
  await expect(noRoute.locator('[data-key="LEG_NO_ROUTE/7/9"]')).toHaveText(/^Lång, Mellan: kontroll 36–mål har ingen väg runt ett förbjudet område\./);
  // 33–34 går runt: ingen rad alls.
  await expect(panel.locator('[data-key^="LEG_THROUGH_FORBIDDEN/4/5"], [data-key^="LEG_NO_ROUTE/4/5"]')).toHaveCount(0);
  await expect(panel.locator('[data-group$=":LEG_THROUGH_FORBIDDEN"]')).toHaveCount(0);
  const before = Number(await badge(owner).getAttribute("data-count"));
  expect(before).toBeGreaterThanOrEqual(3);
  await reviewScreenshots(owner, "banlaggning-varningar");

  // Sträckan 33–34 på kartan: Vald sträcka säger att vägvalet går runt.
  await owner.getByRole("tab", { name: "Banor" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-center", /,/);
  // Kartan passas in på banan efter bytet: klicka på sträckan när den står still.
  await expect(async () => {
    const onLeg = await screenOf(map, 81.5, 46.5);
    await owner.mouse.click(onLeg.x, onLeg.y);
    await expect(owner.getByTestId("course-setting-selected")).toHaveText("Sträckan kontroll 33–kontroll 34", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await owner.getByRole("tab", { name: "Vald" }).click();
  await expect(owner.getByTestId("course-setting-leg-forbidden")).toHaveText(/^Fågelvägen korsar ett förbjudet område – vägvalet går runt \(\+\d+ m\)\.$/,
    { timeout: 90_000 });
  await shot(owner, "banlaggning-varningar-vald-stracka");

  // Godta 36–mål: fliken räknar ned och raden ligger under Godtagna.
  await badge(owner).click();
  const row = noRoute.locator('[data-key="LEG_NO_ROUTE/7/9"]');
  await row.getByRole("button", { name: /^Godta:/ }).click();
  await expect(badge(owner)).toHaveAttribute("data-count", String(before - 1));
  const accepted = panel.getByTestId("course-setting-checks-accepted");
  await expect(accepted.locator("summary")).toHaveText("Godtagna (1)");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });

  // Omladdning: fortfarande godtagen (sparad i dokumentet).
  await owner.reload();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await badge(owner).click();
  await expect(panel.getByTestId("course-setting-checks-accepted").locator("summary")).toHaveText("Godtagna (1)", { timeout: 120_000 });
  await expect(badge(owner)).toHaveAttribute("data-count", String(before - 1), { timeout: 120_000 });
  const document = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: { event: { acceptedChecks?: Record<string, unknown> } } } };
  expect(Object.keys(document.setting.document.event.acceptedChecks ?? {})).toEqual(["LEG_NO_ROUTE/7/9"]);

  // Ångra (verktygsraden, historiken efter omladdningen): varningen är tillbaka.
  await owner.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect(badge(owner)).toHaveAttribute("data-count", String(before));
  await expect(panel.getByTestId("course-setting-checks-accepted")).toHaveCount(0);

  // Godta alla av sorten och Ångra en rad i Godtagna.
  await noRoute.getByRole("button", { name: "Godta alla 3" }).click();
  await expect(badge(owner)).toHaveAttribute("data-count", String(before - 3));
  await panel.getByTestId("course-setting-checks-accepted").locator("summary").click();
  await panel.getByTestId("course-setting-checks-accepted").locator('[data-key="LEG_NO_ROUTE/6/7"]').getByRole("button", { name: /^Ångra godtagandet:/ }).click();
  await expect(badge(owner)).toHaveAttribute("data-count", String(before - 2));
  await expect(panel.getByTestId("course-setting-checks-accepted").locator("summary")).toHaveText("Godtagna (2)");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await reviewScreenshots(owner, "banlaggning-varningar-godtagna");

  // Visa → Markera varningar: raden markerar kontrollerna; släckt syns ingen markering.
  await panel.locator('[data-key="LEG_NO_ROUTE/6/7"]').getByRole("button", { name: /kontroll 35–kontroll 36/ }).click();
  await expect(marks(owner)).toHaveAttribute("data-marks", /flagged:2/);
  await owner.getByRole("button", { name: /^Visa/ }).click();
  await owner.getByRole("checkbox", { name: "Markera varningar" }).uncheck();
  await expect(marks(owner)).toHaveAttribute("data-marks", /flagged:0/);
  await owner.getByRole("checkbox", { name: "Markera varningar" }).check();

  // Telefonen i fältläget: Kollad syns som förval och går att släcka i Visa, också efter omladdning.
  const wgs = mapPointToWgs84(georeference, { x: 42, y: 61 });
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, geolocation: { latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 6 }, permissions: ["geolocation"] });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  const phoneMap = phone.getByTestId("course-setting-map");
  await expect(phone.getByTestId("course-setting-field")).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await phone.getByTestId("course-setting-field-course").selectOption({ label: "Lång" });
  await phone.getByRole("button", { name: "Visa hela kartan" }).click();
  await phone.waitForTimeout(400);
  const at = await screenOf(phoneMap, 42, 61);
  await phone.touchscreen.tap(at.x, at.y);
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 32");

  // Utan nät: Kollad väntar och en flytt väntar; raden och statusen får plats på 390 px.
  await phoneContext.setOffline(true);
  await phone.getByTestId("course-setting-inspect").click();
  await expect(phone.getByTestId("course-setting-inspected-by")).toContainText("Kollad av Kim Lindqvist");
  await phone.getByRole("button", { name: "Flytta 1 m österut" }).click();
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText(/Utan nät – \d+ ändring(ar)? väntar/, { timeout: 15_000 });
  await noSideScroll(phone);
  const bar = await phone.getByTestId("course-setting-field").boundingBox();
  const pill = await phone.getByTestId("course-setting-field-status").boundingBox();
  expect(pill!.x + pill!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 0.5);
  await shot(phone, "banlaggning-varningar-falt-utan-nat-390");
  await phoneContext.setOffline(false);
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 30_000 });
  await expect(marks(phone)).toHaveAttribute("data-marks", /inspected:1/, { timeout: 15_000 });

  await phone.getByRole("button", { name: /^Visa/ }).click();
  const inspected = phone.getByRole("checkbox", { name: "Kollade kontroller" });
  await expect(inspected).toBeChecked();
  await inspected.uncheck();
  await expect(marks(phone)).toHaveAttribute("data-marks", /inspected:0/);
  await phone.reload();
  await expect(phone.getByTestId("course-setting-field")).toBeVisible({ timeout: 30_000 });
  await expect(marks(phone)).toHaveAttribute("data-marks", /inspected:0/, { timeout: 30_000 });
  await phone.getByRole("button", { name: /^Visa/ }).click();
  await expect(phone.getByRole("checkbox", { name: "Kollade kontroller" })).not.toBeChecked();
  await shot(phone, "banlaggning-varningar-falt-visa-390");

  // Varningarna i telefonen (fliken bakom "Mer"): grupperna, Godta och Godtagna ryms på 390 px.
  await phone.getByTestId("course-setting-field-more").click();
  await phone.getByTestId("course-setting-tab-more").click();
  await phone.getByRole("menuitem", { name: /Varningar/ }).click();
  await expect(phone.getByTestId("course-setting-checks").locator('[data-group="ERROR:LEG_NO_ROUTE"]')).toBeVisible({ timeout: 120_000 });
  await noSideScroll(phone);
  await shot(phone, "banlaggning-varningar-panel-390");
  await phoneContext.close();
});
