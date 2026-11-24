import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mapPointToWgs84, readMapFile } from "../../packages/map-file/src/index";
import { buildZip, syntheticPpen } from "../../packages/club-archive/test/synthetic-archive";
import { DEMO_TEMPLATE_RUNNERS } from "../../packages/application/src/demo-template-race";
import { demoMapFile } from "./bildspel-karta";
import { composeSlides } from "./bildspel-bilder";
import { addCourseAndClass, addEntry, chooseOrganiser, mapSettled, openStep, readExercise, registerAccount, today, unique, warmCourseSetting,
  warmRoute } from "./helpers";

/**
 * Startsidans bildspel (ägaren 2026-11-24): skärmbilderna ur programmet tas här, mot en lokal instans med påhittade data, och
 * sätts ihop till `apps/web/public/bildspel/*.webp` (1440 × 900, telefonen infälld där bilden säger så). Körs bara med
 * `pnpm bildspel` (OTID_BILDSPEL=1), aldrig i CI. Allt är påhittat: kartan «Tallbacken» är räknad (`bildspel-karta.ts`), löparna
 * är demotävlingens (`DEMO_TEMPLATE_RUNNERS`) och klubbarkivet byggs av påhittade zip-filer.
 *
 * Testerna körs i ordning: det första skapar kontot, kartprojektet, tävlingen och klubben och sparar läget i
 * `$TMPDIR/otid-bildspel/lage.json` (eller `OTID_BILDSPEL_RAW`), så att en enskild bild kan tas om med `-g` utan att allt byggs igen.
 */
test.skip(!process.env.OTID_BILDSPEL, "Bara med pnpm bildspel");
test.describe.configure({ mode: "serial" });

const root = fileURLToPath(new URL("../../", import.meta.url));
const RAW = process.env.OTID_BILDSPEL_RAW ?? join(tmpdir(), "otid-bildspel");
const STATE = join(RAW, "lage.json");
const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

type State = { email: string; projectId: string; raceId: string; shortCode: string; clubId: string; storage: string };
const state = (): State => JSON.parse(readFileSync(STATE, "utf8")) as State;
const csrfOf = async (page: Page) => (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";

/** Lång: start, åtta kontroller och mål (kartans mm); sträckan 2–3 går runt sjön, norr eller söder om. */
const COURSE = { start: [-74, 22], controls: [[-52, 46], [-30, 12], [34, 12], [62, 44], [90, -20], [42, -50], [-8, -42], [-44, -26]],
  finish: [-70, 10] } as const;

async function open(browser: Browser, viewport: { width: number; height: number }, extra: Parameters<Browser["newContext"]>[0] = {})
  : Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: state().storage, viewport, locale: "sv-SE", ...extra });
  return { context, page: await context.newPage() };
}
const phoneOf = (browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}) =>
  open(browser, PHONE, { hasTouch: true, isMobile: true, deviceScaleFactor: 2, ...extra });

/** Skärmbilden utan utvecklingsserverns märke (finns inte i drift; avläsningssidans CSP tillåter ingen sådan stil). */
async function shot(page: Page, name: string): Promise<void> {
  if (await page.locator("nextjs-portal").count()) await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(RAW, `${name}.png`) });
}

const screenOf = async (page: Page, x: number, y: number) => {
  const map = page.getByTestId("course-setting-map");
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
};
/** Kartans +-knapp (banläggningen och kartprojektet) och vänta tills kartan står still. */
async function zoomIn(page: Page, times: number): Promise<void> {
  for (let step = 0; step < times; step += 1) await page.getByRole("button", { name: /^(Zooma in|Förstora)/ }).first().click();
  await mapSettled(page.getByTestId("course-setting-map"));
}
const clickMap = async (page: Page, [x, y]: readonly [number, number]) => { const at = await screenOf(page, x, y); await page.mouse.click(at.x, at.y); };

/** Stockholmstid som TT:MM, `minutes` minuter från nu (avrundat nedåt till hel minut). */
const clock = (minutes: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" })
  .format(new Date(Date.now() + minutes * 60_000));

test("data: konto, kartprojekt, tävling och klubb", async ({ browser, baseURL }) => {
  test.setTimeout(1_200_000);
  mkdirSync(RAW, { recursive: true });
  const email = `bildspel.${unique()}@exempel.se`;
  const owner = await registerAccount(browser, email, "Bea Banläggare");
  await owner.setViewportSize(DESKTOP);
  const headers = async () => ({ origin: baseURL!, "x-otid-csrf": await csrfOf(owner) });

  // Kartprojektet med den påhittade kartan och uppgifter till (det falska) Lantmäteriet, så att guiden visar alla steg.
  await warmRoute(owner, "/api/account/map-sources/lantmateriet");
  expect((await owner.request.put("/api/account/map-sources/lantmateriet", { headers: await headers(),
    data: { formatVersion: 1, method: "BASIC", id: "geotorget-demo", secret: "hemligt-demo-1" } })).status()).toBe(200);
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { ...await headers(),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Tallbacken", "x-otid-file-name": "Tallbacken.omap" },
    data: Buffer.from(demoMapFile()) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;

  // Tävlingen i dag med tre klasser, demotävlingens löpare och en lottad startlista som började för en dryg timme sedan.
  await owner.goto("/organizer");
  await owner.getByLabel("Tävlingens namn").fill("Höstnatten");
  await owner.getByLabel("Datum").fill(today());
  await owner.getByRole("radio", { name: "Tävling", exact: true }).check();
  await chooseOrganiser(owner);
  await owner.getByTestId("create-race-submit").click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const raceId = owner.url().split("/").at(-2)!;
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33 34 35 36 37 38");
  await addCourseAndClass(owner, "Mellan", "D21", "31 32 33 36 37 38");
  await addCourseAndClass(owner, "Kort", "Öppen", "31 37 38");
  const classOf: Record<string, string> = { H21: "H21", D21: "D21", H45: "D21", D45: "Öppen" };
  for (const [index, runner] of DEMO_TEMPLATE_RUNNERS.entries()) {
    await addEntry(owner, { className: classOf[runner.className]!, givenName: runner.givenName, familyName: runner.familyName, club: runner.club,
      card: String(8_101_001 + index) });
  }
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await draw.getByLabel("Första start (klockslag)").fill(clock(-95));
  for (const className of ["H21", "D21", "Öppen"]) {
    await draw.getByLabel(`Startsätt ${className}`).selectOption({ label: "Minutstart" });
    await draw.getByLabel(`Vakanser ${className}`).fill("1");
  }
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  await owner.getByRole("region", { name: "Så blir startlistan" }).getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();
  await owner.getByRole("button", { name: "Publicera startlistan" }).click();
  await expect(owner.getByText("Startlistan är publicerad.")).toBeVisible();
  const published = await owner.request.put(`/api/admin/races/${raceId}/administrator/race-publication`, { headers: await headers() });
  expect(published.status()).toBe(200);
  const shortCode = (await published.json() as { publication: { shortCode: string } }).publication.shortCode;

  // Kartan till tävlingen (för kontrollkartan och resultatens karta) och banläggningen med banan Lång.
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  const mapFile = join(RAW, "Tallbacken.omap");
  writeFileSync(mapFile, demoMapFile());
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(mapFile);
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByRole("button", { name: "Börja med en tom banläggning" }).click();
  await owner.getByLabel("Namn på ny bana").fill("Lång");
  await owner.getByRole("button", { name: "Ny bana" }).click();
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await owner.getByRole("button", { name: "Visa hela kartan" }).click().catch(() => undefined);
  await mapSettled(owner.getByTestId("course-setting-map"));
  await owner.getByRole("button", { name: "Ny start" }).click();
  await clickMap(owner, COURSE.start);
  await owner.getByRole("button", { name: "Ny kontroll" }).click();
  for (const control of COURSE.controls) await clickMap(owner, control);
  await owner.getByRole("button", { name: "Nytt mål" }).click();
  await clickMap(owner, COURSE.finish);
  await expect(owner.getByTestId("course-setting-course").filter({ hasText: "Lång" })).toContainText("8 kontroller");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 20_000 });

  // Klubben och klubbarkivet ur påhittade zip-filer (som klubbens Drive-mappar), importerade med kommandot i repot.
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill("OK Tallbacken");
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByText("För den som kan Git: kommandoraden").click();
  await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
  const token = (await owner.getByTestId("import-token").textContent())!.trim();
  const folder = mkdtempSync(join(tmpdir(), "otid-bildspel-"));
  try {
    const map = Buffer.from(demoMapFile());
    // En ny version av samma karta (annan anteckning, samma georeferens).
    const revised = Buffer.from(map.toString("utf8").replace(/<notes>[^<]*<\/notes>/, "<notes>Tallbacken, reviderad 2026-10-01.</notes>"), "utf8");
    writeFileSync(join(folder, "2025.zip"), buildZip([
      { name: "2025/04-10 Tallbacken [Anna]/Tallbacken.omap", data: map },
      { name: "2025/04-10 Tallbacken [Anna]/Tallbacken Kurvbild.ppen", data: syntheticPpen("C:\\OL\\Tallbacken.omap", "Kurvbild") },
      { name: "2025/05-15 Tallbacken stafett [Per]/Stafett Tallbacken.ppen", data: syntheticPpen("C:\\OL\\Tallbacken.omap", "Stafett") },
      { name: "2025/09-04 Tallbacken [Kim]/Tallbacken Kompass.ppen", data: syntheticPpen("C:\\OL\\Tallbacken.omap", "Kompass") }
    ]));
    writeFileSync(join(folder, "2026.zip"), buildZip([
      { name: "2026/03-19 Tallbacken natt [Anna]/Tallbacken Nattstjärna.ppen", data: syntheticPpen("D:\\Kartor\\Tallbacken.omap", "Nattstjärna") },
      { name: "2026/05-07 Tallbacken [Per]/Tallbacken Linjeorientering.ppen", data: syntheticPpen("D:\\Kartor\\Tallbacken.omap", "Linjeorientering") },
      { name: "2026/10-08 Tallbacken natt [Kim]/Tallbacken 2026-10-01 V2.omap", data: revised },
      { name: "2026/10-08 Tallbacken natt [Kim]/Tallbacken natt.ppen", data: syntheticPpen("D:\\Kartor\\Tallbacken 2026-10-01 V2.omap", "Natt") }
    ]));
    execFileSync("pnpm", ["--silent", "archive-import", folder, "--server", baseURL!, "--rapport", join(folder, "rapport.txt")],
      { cwd: root, encoding: "utf8", timeout: 300_000, env: { ...process.env, OTID_IMPORT_TOKEN: token, INIT_CWD: root,
        ...(baseURL!.startsWith("https://") ? { NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {}) } });
  } finally { rmSync(folder, { recursive: true, force: true }); }

  const storage = join(RAW, "konto.json");
  await owner.context().storageState({ path: storage });
  writeFileSync(STATE, JSON.stringify({ email, projectId, raceId, shortCode, clubId, storage } satisfies State, null, 2));
});

test("1 grundkarta: guiden Ny grundkarta med laser, OpenStreetMap och ortofoto", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/organizer/map-projects/${state().projectId}/map`);
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
  await page.getByTestId("map-project-tab-basemap").click();
  await page.getByTestId("map-project-guide").evaluate(element => element.scrollIntoView({ block: "start" }));
  await shot(page, "grundkarta");
  await context.close();
});

test("2 rita: ritläget i datorn och i telefonen", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/organizer/map-projects/${state().projectId}/map`);
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
  await shot(page, "rita");
  await context.close();
  const phone = await phoneOf(browser);
  await phone.page.goto(`/organizer/map-projects/${state().projectId}/map`);
  await expect(phone.page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 180_000 });
  await zoomIn(phone.page, 2);
  await shot(phone.page, "rita-mobil");
  await phone.context.close();
});

test("3 vägval: sträckan runt sjön inzoomad i banläggningen", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/admin/${state().raceId}/course-setting`);
  await page.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  await mapSettled(page.getByTestId("course-setting-map"));
  await page.getByRole("button", { name: "Välj och flytta" }).click();
  const [a, b] = [COURSE.controls[1], COURSE.controls[2]];
  const from = await screenOf(page, a[0], a[1]), to = await screenOf(page, b[0], b[1]);
  await page.mouse.click((from.x + to.x) / 2, (from.y + to.y) / 2);
  await expect(page.getByTestId("course-setting-selected")).toHaveText(/^Sträckan kontroll 32–kontroll 33/);
  await page.getByRole("tab", { name: "Vald" }).click();
  await expect(page.getByTestId("course-setting-leg").getByText(/Fågelväg/)).toBeVisible({ timeout: 90_000 });
  // Inzoomat på sträckan.
  const map = page.getByTestId("course-setting-map");
  const center = await screenOf(page, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -150);
  await mapSettled(map);
  await page.waitForTimeout(2_000);
  await shot(page, "vagval");
  await context.close();
});

test("4 gps: alla kontroller i datorn och fältläget i telefonen", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/admin/${state().raceId}/course-setting`);
  await page.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  await mapSettled(page.getByTestId("course-setting-map"));
  await shot(page, "gps");
  await context.close();
  const georeference = readMapFile(demoMapFile(), "Tallbacken.omap").georeference!;
  const here = mapPointToWgs84(georeference, { x: COURSE.controls[4][0] - 3, y: COURSE.controls[4][1] - 4 });
  const phone = await phoneOf(browser, { geolocation: { latitude: here.latitude, longitude: here.longitude, accuracy: 5 }, permissions: ["geolocation"] });
  await phone.page.goto(`/admin/${state().raceId}/course-setting`);
  await expect(phone.page.getByTestId("course-setting-field")).toBeVisible({ timeout: 60_000 });
  const map = phone.page.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
  await phone.page.getByTestId("course-setting-field-course").selectOption({ label: "Lång" });
  await mapSettled(map);
  const control = await screenOf(phone.page, COURSE.controls[4][0], COURSE.controls[4][1]);
  await phone.page.touchscreen.tap(control.x, control.y);
  await expect(phone.page.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 35");
  await phone.page.getByTestId("course-setting-inspect").click();
  await expect(phone.page.getByTestId("course-setting-inspected-by")).toContainText("Kollad av Bea Banläggare");
  const follow = phone.page.getByTestId("course-setting-field").locator("button[data-mode]");
  for (let tries = 0; tries < 3 && await follow.getAttribute("data-mode") !== "follow"; tries += 1) await follow.click();
  await zoomIn(phone.page, 2);
  await shot(phone.page, "gps-mobil");
  await phone.context.close();
});

test("5 layout: layouterna och tryckfärgerna", async ({ browser }) => {
  test.setTimeout(400_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/admin/${state().raceId}/course-setting`);
  await page.getByTestId("course-setting-tab-layout").click();
  await expect(page.getByTestId("layout-page")).toBeVisible({ timeout: 60_000 });
  if (await page.getByTestId("layout-entry").count() < 2) {
    for (const [name, scale, paper] of [["Elit A3", "10000", "A3"], ["Ungdom A4", "7500", "A4"]] as const) {
      const before = await page.getByTestId("layout-entry").count();
      await page.getByTestId("layout-add").click();
      const entry = page.getByTestId("layout-entry").nth(before);
      await entry.getByTestId("layout-name").fill(name);
      await entry.getByTestId("layout-name").press("Enter");
      await entry.getByTestId("layout-scale").fill(scale);
      await entry.getByTestId("layout-scale").press("Enter");
      await entry.getByTestId("layout-paper").selectOption(paper);
      if (paper === "A3") await entry.getByTestId("layout-orientation").selectOption("landscape");
    }
  }
  // Banan Lång på alla tre layouterna: A4 1:10 000 (huvudlayouten), A3 liggande 1:10 000 och A4 1:7 500.
  for (let tries = 0; tries < 2 && await page.getByRole("button", { name: /^Lägg till ark för Lång/ }).count(); tries += 1) {
    await page.getByRole("button", { name: /^Lägg till ark för Lång/ }).first().click();
    await page.waitForTimeout(1_500);
  }
  await expect(page.getByTestId("layout-cell")).toHaveCount(3);
  const close = page.getByRole("button", { name: "Stäng arket" });
  if (await close.count()) await close.click();
  await page.getByTestId("layout-cell").last().click();
  await page.waitForTimeout(3_000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "layout");
  // Utskriften: tryckfärgerna utfällda och arket med kartan, som två urklipp ovanpå layouten.
  await page.goto(`/admin/${state().raceId}/course-setting/print`);
  await expect(page.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 90_000 });
  const colors = page.getByTestId("print-profile");
  await colors.getByTestId("print-colors-show").click();
  await expect(colors.getByTestId("print-colors-details")).toBeVisible();
  await colors.screenshot({ path: join(RAW, "layout-farger.png") });
  await page.getByTestId("print-sheet").first().screenshot({ path: join(RAW, "layout-ark.png") });
  await context.close();
});

test("6 förbered: startlistan efter lottningen", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/admin/${state().raceId}/manage`);
  await openStep(page, "Start");
  await expect(page.getByRole("region", { name: "Lottning" })).toBeVisible();
  // Klasserna i lottningen överst och startlistan under.
  await page.getByRole("region", { name: "Lottning" }).getByRole("table").first().evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -170));
  await shot(page, "forbered");
  await context.close();
});

test("7 avläsning: övningsstationen i datorn och i telefonen", async ({ browser }) => {
  test.setTimeout(400_000);
  const read = async (page: Page, runners: readonly [string, string?][]) => {
    await page.goto(`/admin/${state().raceId}/readout`);
    await page.waitForURL(`**/readout/index.html#${state().raceId}`);
    await expect(page.getByTestId("package-status")).toContainText("v", { timeout: 60_000 });
    await page.getByRole("button", { name: "Starta övningsstation" }).click();
    await expect(page.getByTestId("station-status")).toContainText("Övningsstation");
    for (const [runner, button] of runners) await readExercise(page, new RegExp(runner), button ? { button } : {});
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const { context, page } = await open(browser, DESKTOP);
  await read(page, [["Kalle Kompass"], ["Stina Stigfinnare"], ["Olle Punkthöjd"], ["Myra Mossberg"], ["Sten Brantlund"],
    ["Tuva Höjdkvist", "Läs av: missad kontroll"], ["Lo Kärrström"]]);
  await shot(page, "avlasning");
  await context.close();
  const phone = await phoneOf(browser);
  await read(phone.page, [["Elsa Hällmark"]]);
  await shot(phone.page, "avlasning-mobil");
  await phone.context.close();
});

test("8 resultat: resultatsidan och live i telefonen", async ({ browser }) => {
  test.setTimeout(300_000);
  const visitor = await browser.newContext({ viewport: DESKTOP, locale: "sv-SE" });
  const page = await visitor.newPage();
  await page.goto(`/results/${state().raceId}`);
  await expect(page.getByText("Kalle Kompass").first()).toBeVisible({ timeout: 60_000 });
  await shot(page, "resultat");
  await visitor.close();
  const phone = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: "sv-SE" });
  const live = await phone.newPage();
  await live.goto(`/t/${state().shortCode}/live`);
  await expect(live.getByText("Kalle Kompass").first()).toBeVisible({ timeout: 60_000 });
  await shot(live, "resultat-mobil");
  await phone.close();
});

test("9 arkiv: klubbarkivets träningar", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await open(browser, DESKTOP);
  await page.goto(`/organizer/clubs/${state().clubId}`);
  const tab = page.getByRole("tab", { name: "Träningar" });
  await tab.click();
  await expect(page.getByTestId("archive-entries").getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  // De små bilderna ritas i webbläsaren första gången arkivet visas.
  await expect(page.getByTestId("archive-entries").getByText("Ingen bild än")).toHaveCount(0, { timeout: 120_000 });
  // Flikarna överst (kortet «Kom igång» ovanför hör till en ny klubb).
  await tab.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -12));
  await shot(page, "arkiv");
  await context.close();
});

test("sätt ihop bilderna", async () => {
  test.setTimeout(120_000);
  for (const name of ["grundkarta", "rita", "vagval", "gps", "layout", "forbered", "avlasning", "resultat", "arkiv"]) {
    expect(existsSync(join(RAW, `${name}.png`)), name).toBe(true);
  }
  const sizes = await composeSlides(RAW, join(root, "apps/web/public/bildspel"));
  for (const [name, bytes] of Object.entries(sizes)) expect(bytes, name).toBeLessThan(200_000);
});
