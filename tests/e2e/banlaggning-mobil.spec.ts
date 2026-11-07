import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/georef";
import type { MapGeoreference } from "../../packages/map-file/src/model";
import { courseSettingInPhone, createRace, mapSettled, openStep, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * Fältläget, första versionen (ADR-0181 beslut 6–7): banläggningen på en telefon (390 × 844) med fejkad position. Välj
 * kontroll 32, Min position, Flytta hit (medelvärdet under 5 s), en meter norrut, kolumn F = 1.5 och G = SO via
 * Uppgifter, och allt är sparat efter omladdning. En ändring utan nät ligger i telefonen och skickas när sidan öppnas igen.
 *
 * Ägarens synpunkter från skogen (steg 66): banväljaren i raden överst och banan ritad med sträckor, nummer, start och
 * mål; fältknapparna med en bana vald; krysset i vald kontrolls mitt; en dragning med fingret lyfter kontrollen ovanför
 * fingret; sidan skrollar aldrig när man drar på kartan.
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

/** Dragning med ett finger (riktiga touch-händelser via CDP, som ger pekarhändelser av typen touch). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, during?: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  const point = (at: { x: number; y: number }) => [{ x: Math.round(at.x), y: Math.round(at.y), id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from) });
  for (let step = 1; step <= 8; step += 1) {
    const at = { x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(at) });
  }
  if (during) await during();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const scrolled = (page: Page) => page.evaluate(() => [window.scrollY, document.scrollingElement!.scrollTop, document.body.scrollTop]);
/** Samma lyft som `LIFT_PX` i `course-setting-draw-cross.ts`. */
const LIFT_PX = 56;

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
  await owner.getByTestId("nav-course-setting").click();
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
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
  await expect(phone.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-px-per-mm", /\d/);
  await mapSettled(map);

  // Banväljaren i fältets rad: banan Lång ritas med sträckor, nummer, start och mål (inte bara kontrollerna).
  const allControls = await map.getByTestId("course-setting-overprint").screenshot();
  const course = phone.getByTestId("course-setting-field-course");
  await expect(course).toBeVisible();
  await course.selectOption({ label: "Lång" });
  await expect(course).toHaveValue("1");
  await expect(phone.getByRole("img", { name: "Karta med banpåtryck: Lång" })).toBeVisible();
  await expect.poll(async () => (await map.getByTestId("course-setting-overprint").screenshot()).equals(allControls)).toBe(false);
  await screenshot(phone, "banlaggning-mobil-bana");

  // Sidan skrollar inte när man panorerar kartan med fingret (eller hjulet).
  const box = (await map.boundingBox())!;
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.wheel(0, 400);
  expect(await scrolled(phone)).toEqual([0, 0, 0]);
  await phone.getByRole("button", { name: "Visa hela kartan" }).click();
  await mapSettled(map);
  // Kartans övre vänstra hörn (5, 95 mm) är tomt.
  const empty = await screenOf(map, 5, 95);
  const centerBefore = await map.getAttribute("data-center");
  await touchDrag(phone, empty, { x: empty.x - 40, y: empty.y + 120 });
  expect(await scrolled(phone)).toEqual([0, 0, 0]);
  await expect(map).not.toHaveAttribute("data-center", centerBefore!);

  // Skydd mot att flytta av misstag: en kontroll som inte är vald flyttas inte med fingret, dragningen panorerar.
  const before = await (await phone.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const c31 = Object.values(before.setting.document.controls).find(row => row.code === "31")!.at;
  const unselected = await screenOf(map, c31.x, c31.y);
  const centerUnselected = await map.getAttribute("data-center");
  await touchDrag(phone, unselected, { x: unselected.x + 30, y: unselected.y + 10 });
  await expect(map).not.toHaveAttribute("data-center", centerUnselected!);
  const still = await (await phone.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  expect(Object.values(still.setting.document.controls).find(row => row.code === "31")!.at).toEqual(c31);

  // Tryck för att välja kontroll 31, dra den sedan med fingret: kontrollen lyfts ovanför fingret, krysset syns i mitten
  // och sidan står still.
  const from = await screenOf(map, c31.x, c31.y);
  await phone.touchscreen.tap(from.x, from.y);
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 31");
  const to = { x: from.x + 30, y: from.y + 10 };
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  await touchDrag(phone, from, to, async () => {
    await expect(map.getByTestId("course-setting-cross")).toHaveAttribute("data-cross", /,drag$/);
    expect(await scrolled(phone)).toEqual([0, 0, 0]);
    await screenshot(phone, "banlaggning-mobil-dra");
  });
  expect(await scrolled(phone)).toEqual([0, 0, 0]);
  // 31 finns också på Mellan och flyttades långt: frågan, flytta i alla banor.
  await phone.getByTestId("course-setting-move-all").click();
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 31");
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 15_000 });
  const dragged = await (await phone.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const c31After = Object.values(dragged.setting.document.controls).find(row => row.code === "31")!.at;
  // Fingret flyttades 30 px åt höger och 10 px ned; kontrollen hamnar LIFT_PX ovanför fingret.
  expect((c31After.x - c31.x) * scale).toBeCloseTo(30, -1);
  expect((c31.y - c31After.y) * scale).toBeCloseTo(10 - LIFT_PX, -1);
  await expect(map.getByTestId("course-setting-cross")).toHaveAttribute("data-cross", `${c31After.x.toFixed(2)},${c31After.y.toFixed(2)}`);

  // Välj kontroll 32 (42, 61 mm) med fingret; fältknapparna fungerar med banan vald.
  const control = await screenOf(map, 42, 61);
  await phone.touchscreen.tap(control.x, control.y);
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 32");
  await expect(map.getByTestId("course-setting-cross")).toHaveAttribute("data-cross", "42.00,61.00");
  await screenshot(phone, "banlaggning-mobil-vald");

  // Min position och Flytta hit.
  await phone.getByRole("button", { name: "Min position" }).click();
  await expect(phone.getByText("Position ±5 m")).toBeVisible({ timeout: 15_000 });
  await screenshot(phone, "banlaggning-mobil-position");
  await phone.getByTestId("course-setting-move-here").click();
  await expect(phone.getByTestId("course-setting-move-here")).toContainText("Mäter");
  await phone.getByTestId("course-setting-move-all").click({ timeout: 15_000 });
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

  // Utan nät (steg 67): "Utan nät – 1 ändring väntar". Sidan stängs innan nätet kommer tillbaka; ändringen ligger i
  // telefonen (IndexedDB) och skickas när sidan öppnas igen.
  const status = () => phone.getByTestId("course-setting-field-status");
  // Steg 66: ändringarna sparas som åtgärder (POST course-setting/edits).
  await phone.route(`**${admin}/course-setting/edits`, route => route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue());
  await phone.getByRole("button", { name: "Flytta 1 m österut" }).click();
  await expect(status()).toHaveText("Utan nät – 1 ändring väntar", { timeout: 15_000 });
  await screenshot(phone, "banlaggning-mobil-inte-sparat");
  // Ändringen ligger i telefonen (posten skrivs strax efter ändringen) innan sidan stängs.
  await expect.poll(async () => (await courseSettingInPhone(phone, raceId)).waiting, { timeout: 15_000 }).toBe(1);
  await phone.close({ runBeforeUnload: false });
  phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByText("1 ändring från förra gången skickas.")).toBeVisible();
  await screenshot(phone, "banlaggning-mobil-aterstall");
  await expect(status()).toHaveText("Sparat", { timeout: 15_000 });

  // Omladdning: allt är sparat och inget erbjuds att återställa.
  await phone.reload();
  await expect(phone.getByTestId("course-setting-field")).toBeVisible();
  await expect(phone.getByText(/från förra gången/)).toHaveCount(0);
  const state = await (await phone.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const moved = Object.values(state.setting.document.controls).find(row => row.code === "32")!;
  expect(moved.at.x).toBeCloseTo(target.x + 0.1, 2);
  expect(moved.at.y).toBeCloseTo(target.y + 0.1, 2);
  expect(moved.descriptions.find(box => box.box === "F")).toEqual({ box: "F", text: "1.5" });
  expect(moved.descriptions.find(box => box.box === "G")).toEqual({ box: "G", ref: "11.1SE" });
  await screenshot(phone, "banlaggning-mobil-omladdad");
});
