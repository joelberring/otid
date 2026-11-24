import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/index";
import { buildZip } from "../../packages/club-archive/test/synthetic-archive";
import { DEMO_TEMPLATE_RUNNERS } from "../../packages/application/src/demo-template-race";
import { demoMapFile } from "./bildspel-karta";
import { composeSlides } from "./bildspel-bilder";
import { writeDemoLaser } from "./bildspel-laser";
import { archivePpen, ownMap, slideCourses, slideLeg, slideMap, type XY } from "./bildspel-underlag";
import { E2E_GEO_WORKER_TOKEN } from "./fake-geodata";
import { addCourseAndClass, addEntry, chooseOrganiser, mapSettled, openStep, registerAccount, today, unique, warmCourseSetting,
  warmRoute } from "./helpers";

/**
 * Startsidans bildspel (ägaren 2026-11-24): skärmbilderna ur programmet tas här, mot en lokal instans med påhittade data, och
 * sätts ihop till `apps/web/public/bildspel/*.webp` (svenska) och `apps/web/public/bildspel/en/*.webp` (engelska), 1440 × 900
 * med telefonen infälld där bilden säger så. Körs bara med `pnpm bildspel` (OTID_BILDSPEL=1), aldrig i CI. Allt är påhittat:
 * kartan «Tallbacken» är räknad (`bildspel-karta.ts`), löparna är demotävlingens (`DEMO_TEMPLATE_RUNNERS`) och klubbarkivet
 * byggs av påhittade zip-filer. Kartan och banorna kan tas ur egna filer utanför repot (`bildspel-underlag.ts`, README).
 *
 * Varje bild tas på båda språken: svenska som förut, engelska med kakan `otid-lang=en` och webbläsarens språk en-GB (samma
 * språkval som för en besökare), och tävlingen heter då «Autumn Night». Första start är 50 minuter före serverns klocka; körs
 * servern och databasen med libfaketime (README) går webbläsaren på samma klocka, så att starttiderna blir dagtid oavsett när
 * skriptet körs. Lagringen är bekräftad (avläsningens varning om Spara-läget syns inte).
 *
 * Testerna körs i ordning: det första skapar kontot, kartprojekten, tävlingen och klubben och sparar läget i
 * `$TMPDIR/otid-bildspel/lage.json` (eller `OTID_BILDSPEL_RAW`), så att en enskild bild kan tas om med `-g` utan att allt byggs igen.
 */
test.skip(!process.env.OTID_BILDSPEL, "Bara med pnpm bildspel");
test.describe.configure({ mode: "serial" });

const root = fileURLToPath(new URL("../../", import.meta.url));
const RAW = process.env.OTID_BILDSPEL_RAW ?? join(tmpdir(), "otid-bildspel");
const STATE = join(RAW, "lage.json");
const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;
const LANGUAGES = ["sv", "en"] as const;
type Language = (typeof LANGUAGES)[number];
const LOCALE: Record<Language, string> = { sv: "sv-SE", en: "en-GB" };
const RACE_NAME: Record<Language, string> = { sv: "Höstnatten", en: "Autumn Night" };
const { course: COURSE } = slideCourses();
const LEG = slideLeg(COURSE);

/** `clockOffset`: serverns klocka minus testkörningens (ms), när servern körs med libfaketime (README). */
type State = { email: string; projectId: string; draftProjectId: string; raceId: string; shortCode: string; clubId: string; storage: string;
  clockOffset: number };
const state = (): State => JSON.parse(readFileSync(STATE, "utf8")) as State;
const csrfOf = async (page: Page) => (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
const rawOf = (language: Language) => join(RAW, language);
/** Ett mönster för en text på båda språken (början av texten). */
const either = (sv: string, en: string) => new RegExp(`^(${[sv, en].map(text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);

async function open(browser: Browser, baseURL: string, viewport: { width: number; height: number }, language: Language,
  extra: Parameters<Browser["newContext"]>[0] & { visitor?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const { visitor, ...options } = extra;
  const context = await browser.newContext({ ...(visitor ? {} : { storageState: state().storage }), viewport, locale: LOCALE[language],
    timezoneId: "Europe/Stockholm", ...options });
  // Samma kaka som språkvalet i sidhuvudet (`otid-lang`, apps/web/src/lib/language.ts).
  await context.addCookies([{ name: "otid-lang", value: language, url: baseURL }]);
  // Webbläsaren går på serverns klocka (libfaketime fungerar inte i Chromium).
  if (Math.abs(state().clockOffset) > 60_000) await context.clock.install({ time: Date.now() + state().clockOffset });
  // Beständig lagring som en installerad webbläsare med tillåtelse (testwebbläsaren svarar annars nej).
  await context.addInitScript(() => {
    if (!navigator.storage) return;
    Object.defineProperty(navigator.storage, "persist", { value: () => Promise.resolve(true) });
    Object.defineProperty(navigator.storage, "persisted", { value: () => Promise.resolve(true) });
  });
  return { context, page: await context.newPage() };
}
const phoneOf = (browser: Browser, baseURL: string, language: Language, extra: Parameters<typeof open>[4] = {}) =>
  open(browser, baseURL, PHONE, language, { hasTouch: true, isMobile: true, deviceScaleFactor: 2, ...extra });

/** Skärmbilden utan utvecklingsserverns märke (finns inte i drift; avläsningssidans CSP tillåter ingen sådan stil). */
async function shot(page: Page, language: Language, name: string): Promise<void> {
  if (await page.locator("nextjs-portal").count()) await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(rawOf(language), `${name}.png`) });
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
  for (let step = 0; step < times; step += 1) await page.getByRole("button", { name: /^(Zooma in|Förstora|Zoom in)/ }).first().click();
  await mapSettled(page.getByTestId("course-setting-map"));
}
const clickMap = async (page: Page, [x, y]: XY) => { const at = await screenOf(page, x, y); await page.mouse.click(at.x, at.y); };

/** Tävlingens namn på bildens språk (Inställningar i arbetsytan; bara när det byts). */
let raceNamed: Language | undefined;
async function nameRace(browser: Browser, baseURL: string, language: Language): Promise<void> {
  if (raceNamed === language) return;
  const { context, page } = await open(browser, baseURL, DESKTOP, "sv");
  await page.goto(`/admin/${state().raceId}/manage`);
  await openStep(page, "Inställningar");
  const settings = page.getByRole("region", { name: "Inställningar" });
  await settings.getByLabel("Tävlingens namn").fill(RACE_NAME[language]);
  await settings.getByRole("button", { name: "Spara inställningar" }).click();
  await expect(settings.getByText("Inställningarna är sparade.")).toBeVisible();
  await context.close();
  raceNamed = language;
}

/** Geo-arbetaren ett varv mot webben, med bildspelets Karttapullautin (Tallbackens bild och kurvor ur `dir`). */
function runGeoWorker(origin: string, dir: string): Promise<{ code: number | null; output: string }> {
  const work = mkdtempSync(join(tmpdir(), "otid-bildspel-geo-"));
  const ini = join(work, "pullauta.default.ini");
  writeFileSync(ini, "batch=0\nprocesses=2\n");
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(root, "scripts/geo-worker.ts")], { cwd: work, env: { ...process.env, OTID_GEO_ORIGIN: origin,
      OTID_GEO_WORKER_TOKEN: E2E_GEO_WORKER_TOKEN, OTID_GEO_WORKER_NAME: "bildspel-geo", OTID_GEO_ONCE: "1",
      OTID_PULLAUTA: join(root, "tests/e2e/bildspel-pullauta.mjs"), OTID_BILDSPEL_LASER: dir, OTID_DWGREAD: join(root, "tests/e2e/fake-dwgread.mjs"),
      OTID_LASCLIP: join(root, "tests/e2e/fake-lasclip.mjs"), OTID_PULLAUTA_INI: ini, OTID_GEO_WORKDIR: join(work, "jobb"),
      NODE_TLS_REJECT_UNAUTHORIZED: "0", NODE_NO_WARNINGS: "1" } });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", code => resolve({ code, output }));
  });
}

test("data: konto, kartprojekt, tävling och klubb", async ({ browser, baseURL }) => {
  test.setTimeout(1_500_000);
  mkdirSync(RAW, { recursive: true });
  const map = slideMap(), { ppen } = slideCourses();
  const email = `bildspel.${unique()}@exempel.se`;
  const owner = await registerAccount(browser, email, "Bea Banläggare");
  await owner.setViewportSize(DESKTOP);
  const headers = async () => ({ origin: baseURL!, "x-otid-csrf": await csrfOf(owner) });
  const upload = async (name: string, fileName: string, bytes: Uint8Array) => {
    const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { ...await headers(),
      "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": encodeURIComponent(name),
      "x-otid-file-name": encodeURIComponent(fileName) }, data: Buffer.from(bytes) });
    expect(created.status(), await created.text()).toBe(201);
    return (await created.json() as { projectId: string }).projectId;
  };

  // Kartprojektet med kartan och uppgifter till (det falska) Lantmäteriet, så att guiden visar alla steg.
  await warmRoute(owner, "/api/account/map-sources/lantmateriet");
  expect((await owner.request.put("/api/account/map-sources/lantmateriet", { headers: await headers(),
    data: { formatVersion: 1, method: "BASIC", id: "geotorget-demo", secret: "hemligt-demo-1" } })).status()).toBe(200);
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const projectId = await upload(map.name, map.fileName, map.bytes);

  // Guiden Ny grundkarta (alltid Tallbacken, också med en egen karta): ett nytt kartprojekt med vägar, stigar och vatten och en
  // färdig laserkörning, vars bild och kurvor är Tallbackens (`bildspel-laser.ts`). Fukt, vegetation och Lantmäteriets
  // marktäcke och byggnader är av, eftersom den falska geodatan inte hör till Tallbacken.
  const draftProjectId = await upload("Tallbacken ny grundkarta", "Tallbacken ny grundkarta.omap", demoMapFile({ terrain: false }));
  const api = `/api/organizer/map-projects/${draftProjectId}`;
  for (const [path, method] of [[`${api}/sources/lantmateriet/laser`, "POST"], [`${api}/geo-jobs`, "GET"], [`${api}/layers`, "GET"],
    ["/api/geo-worker/claim", "POST"]] as const) await warmRoute(owner, path, method);
  await owner.goto(`/organizer/map-projects/${draftProjectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
  await owner.getByTestId("map-project-tab-basemap").click();
  const laser = owner.getByTestId("map-project-laser");
  await laser.getByText("Laserkörningar (avancerat)").click();
  await laser.getByTestId("map-project-laser-search").click();
  await expect(laser.getByTestId("map-project-laser-items")).toContainText("MB", { timeout: 30_000 });
  for (const id of ["map-project-laser-moisture", "map-project-laser-vegetation", "map-project-laser-extra-LAND_COVER", "map-project-laser-extra-BUILDINGS"]) {
    const box = laser.getByTestId(id);
    if (await box.count() && await box.isChecked()) await box.uncheck();
  }
  await laser.getByTestId("map-project-laser-name").fill("Tallbacken laser");
  await laser.getByTestId("map-project-laser-start").click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Jobbet ligger i kön.");
  const ready = join(RAW, "laser");
  writeDemoLaser(ready);
  const worker = await runGeoWorker(baseURL!, ready);
  expect(worker.code, worker.output).toBe(0);
  await expect(laser.getByTestId("map-project-laser-job").first()).toContainText("Klart", { timeout: 60_000 });
  await expect(owner.getByTestId("map-project-guide")).toHaveAttribute("data-step", "review", { timeout: 30_000 });

  // Tävlingen i dag med tre klasser, demotävlingens löpare och en lottad startlista som började för 50 minuter sedan, på
  // serverns klocka (README: med libfaketime alltid förmiddag, oavsett när skriptet körs).
  const serverNow = Date.parse((await owner.request.get("/organizer")).headers()["date"] ?? "") || Date.now();
  const clockOffset = Math.abs(serverNow - Date.now()) > 60_000 ? serverNow - Date.now() : 0;
  const firstStart = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(Math.floor((serverNow - 50 * 60_000) / 300_000) * 300_000));
  await owner.goto("/organizer");
  await owner.getByLabel("Tävlingens namn").fill(RACE_NAME.sv);
  await owner.getByLabel("Datum").fill(today(new Date(serverNow)));
  await owner.getByRole("radio", { name: "Tävling", exact: true }).check();
  await chooseOrganiser(owner);
  await owner.getByTestId("create-race-submit").click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const raceId = owner.url().split("/").at(-2)!;
  await addCourseAndClass(owner, COURSE.name, "H21", COURSE.codes.join(" "));
  await addCourseAndClass(owner, "Mellan", "D21", "31 32 33 36 37 38");
  await addCourseAndClass(owner, "Kort", "Öppen", "31 37 38");
  const classOf: Record<string, string> = { H21: "H21", D21: "D21", H45: "D21", D45: "Öppen" };
  for (const [index, runner] of DEMO_TEMPLATE_RUNNERS.entries()) {
    await addEntry(owner, { className: classOf[runner.className]!, givenName: runner.givenName, familyName: runner.familyName, club: runner.club,
      card: String(8_101_001 + index) });
  }
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await draw.getByLabel("Första start (klockslag)").fill(firstStart);
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

  // Kartan till tävlingen (för kontrollkartan och resultatens karta) och banläggningen: banfilen, eller banan Lång för hand.
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  // Filnamnet i ASCII (uppladdningen kände inte igen «Kungshatt och Fågelön.omap» från Playwright).
  const mapFile = join(RAW, `karta${map.fileName.slice(map.fileName.lastIndexOf("."))}`);
  writeFileSync(mapFile, map.bytes);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(mapFile);
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  if (ppen) {
    const ppenFile = join(RAW, "banor.ppen");
    writeFileSync(ppenFile, ppen);
    await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(ppenFile);
    await owner.getByRole("button", { name: "Läs in .ppen" }).click();
    await expect(owner.getByTestId("course-setting-course").filter({ hasText: COURSE.name }).first()).toBeVisible({ timeout: 60_000 });
  } else {
    await owner.getByRole("button", { name: "Börja med en tom banläggning" }).click();
    await owner.getByLabel("Namn på ny bana").fill(COURSE.name);
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
    await expect(owner.getByTestId("course-setting-course").filter({ hasText: COURSE.name })).toContainText(`${COURSE.controls.length} kontroller`);
  }
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
    const bytes = Buffer.from(map.bytes);
    // En ny version av samma karta (Tallbacken: annan anteckning, samma georeferens; en egen karta läggs in igen som den är).
    const revised = ownMap ? bytes
      : Buffer.from(bytes.toString("utf8").replace(/<notes>[^<]*<\/notes>/, "<notes>Tallbacken, reviderad 2026-10-01.</notes>"), "utf8");
    const courses = ppen ?? readFileSync(join(root, "fixtures/course-setting/kartfil.ppen"));
    // Tallbackens träningar på olika delar av kartan (banfilens banor ligger annars på samma ställe).
    const at = (shift: XY): XY => ownMap ? [0, 0] : shift;
    const name = map.name, file = map.fileName, v2 = `${name} 2026-10-01 V2${file.slice(file.lastIndexOf("."))}`;
    writeFileSync(join(folder, "2025.zip"), buildZip([
      { name: `2025/04-10 ${name} [Anna]/${file}`, data: bytes },
      { name: `2025/04-10 ${name} [Anna]/${name} Kurvbild.ppen`, data: archivePpen(courses, `C:\\OL\\${file}`, "Kurvbild", at([-110, -80])) },
      { name: `2025/05-15 ${name} stafett [Per]/Stafett ${name}.ppen`, data: archivePpen(courses, `C:\\OL\\${file}`, "Stafett", at([0, -80])) },
      { name: `2025/09-04 ${name} [Kim]/${name} Kompass.ppen`, data: archivePpen(courses, `C:\\OL\\${file}`, "Kompass", at([-110, 0])) }
    ]));
    writeFileSync(join(folder, "2026.zip"), buildZip([
      { name: `2026/03-19 ${name} natt [Anna]/${name} Nattstjärna.ppen`, data: archivePpen(courses, `D:\\Kartor\\${file}`, "Nattstjärna", at([-60, -40])) },
      { name: `2026/05-07 ${name} [Per]/${name} Linjeorientering.ppen`, data: archivePpen(courses, `D:\\Kartor\\${file}`, "Linjeorientering", at([10, -20])) },
      { name: `2026/10-08 ${name} natt [Kim]/${v2}`, data: revised },
      { name: `2026/10-08 ${name} natt [Kim]/${name} natt.ppen`, data: archivePpen(courses, `D:\\Kartor\\${v2}`, "Natt", at([-50, 0])) }
    ]));
    execFileSync("pnpm", ["--silent", "archive-import", folder, "--server", baseURL!, "--rapport", join(folder, "rapport.txt")],
      { cwd: root, encoding: "utf8", timeout: 300_000, env: { ...process.env, OTID_IMPORT_TOKEN: token, INIT_CWD: root,
        ...(baseURL!.startsWith("https://") ? { NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {}) } });
  } finally { rmSync(folder, { recursive: true, force: true }); }

  const storage = join(RAW, "konto.json");
  await owner.context().storageState({ path: storage });
  writeFileSync(STATE, JSON.stringify({ email, projectId, draftProjectId, raceId, shortCode, clubId, storage, clockOffset } satisfies State, null, 2));
  for (const language of LANGUAGES) mkdirSync(rawOf(language), { recursive: true });
});

test("1 grundkarta: guiden Ny grundkarta med en färdig laserkörning", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  for (const language of LANGUAGES) {
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/organizer/map-projects/${state().draftProjectId}/map`);
    await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
    await page.getByTestId("map-project-tab-basemap").click();
    const guide = page.getByTestId("map-project-guide");
    // Körningen är klar: kurvorna ur laserdatan läses in som utkast på kartan, med laserbilden under.
    await expect(guide).toHaveAttribute("data-step", "review", { timeout: 60_000 });
    await guide.getByTestId("map-project-guide-load").click();
    await expect(guide.getByTestId("map-project-guide-candidates")).toBeVisible({ timeout: 60_000 });
    // Bara kurvorna: de andra lagren kommer ur den falska geodatan (OpenStreetMap och Lantmäteriet), som inte hör till Tallbacken.
    const layers = page.getByTestId("map-project-candidate-bar").getByTestId("map-project-candidate-layer");
    for (let index = 0; index < await layers.count(); index += 1) {
      const layer = layers.nth(index);
      const label = await layer.locator("xpath=..").innerText();
      if (!/^10[12] /.test(label.trim()) && await layer.isChecked()) await layer.uncheck();
    }
    await mapSettled(page.getByTestId("course-setting-map"));
    await guide.evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(1_500);
    await shot(page, language, "grundkarta");
    await context.close();
  }
});

test("2 rita: ritläget i datorn och i telefonen", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  for (const language of LANGUAGES) {
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/organizer/map-projects/${state().projectId}/map`);
    await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
    await shot(page, language, "rita");
    await context.close();
    const phone = await phoneOf(browser, baseURL!, language);
    await phone.page.goto(`/organizer/map-projects/${state().projectId}/map`);
    await expect(phone.page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 180_000 });
    await zoomIn(phone.page, 2);
    await shot(phone.page, language, "rita-mobil");
    await phone.context.close();
  }
});

test("3 vägval: sträckan inzoomad i banläggningen", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  for (const language of LANGUAGES) {
    await nameRace(browser, baseURL!, language);
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/admin/${state().raceId}/course-setting`);
    await page.getByTestId("course-setting-course").filter({ hasText: COURSE.name }).first().click();
    await mapSettled(page.getByTestId("course-setting-map"));
    await page.getByRole("button", { name: either("Välj och flytta", "Select and move") }).click();
    const [a, b] = [COURSE.controls[LEG[0]]!, COURSE.controls[LEG[1]]!];
    const from = await screenOf(page, a[0], a[1]), to = await screenOf(page, b[0], b[1]);
    await page.mouse.click((from.x + to.x) / 2, (from.y + to.y) / 2);
    await expect(page.getByTestId("course-setting-selected")).toHaveText(either("Sträckan ", "Leg "));
    await page.getByRole("tab", { name: /^(Vald|Selected)$/ }).click();
    await expect(page.getByTestId("course-setting-leg").getByText(either("Fågelväg", "Straight line"))).toBeVisible({ timeout: 90_000 });
    // Inzoomat på sträckan.
    const map = page.getByTestId("course-setting-map");
    const center = await screenOf(page, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -150);
    await mapSettled(map);
    await page.waitForTimeout(2_000);
    await shot(page, language, "vagval");
    await context.close();
  }
});

test("4 gps: alla kontroller i datorn och fältläget i telefonen", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  const control = COURSE.controls[Math.min(4, COURSE.controls.length - 1)]!;
  const georeference = slideMap().georeference;
  const here = georeference ? mapPointToWgs84(georeference, { x: control[0] - 3, y: control[1] - 4 }) : null;
  for (const language of LANGUAGES) {
    await nameRace(browser, baseURL!, language);
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/admin/${state().raceId}/course-setting`);
    await page.getByTestId("course-setting-course").filter({ hasText: COURSE.name }).first().click();
    await mapSettled(page.getByTestId("course-setting-map"));
    await shot(page, language, "gps");
    await context.close();
    const phone = await phoneOf(browser, baseURL!, language,
      here ? { geolocation: { latitude: here.latitude, longitude: here.longitude, accuracy: 5 }, permissions: ["geolocation"] } : {});
    await phone.page.goto(`/admin/${state().raceId}/course-setting`);
    await expect(phone.page.getByTestId("course-setting-field")).toBeVisible({ timeout: 60_000 });
    const map = phone.page.getByTestId("course-setting-map");
    await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 120_000 });
    await phone.page.getByTestId("course-setting-field-course").selectOption({ label: COURSE.name });
    await mapSettled(map);
    const at = await screenOf(phone.page, control[0], control[1]);
    await phone.page.touchscreen.tap(at.x, at.y);
    await expect(phone.page.getByTestId("course-setting-field-selected")).toHaveText(/^(Vald|Selected): /);
    const inspected = phone.page.getByTestId("course-setting-inspected-by");
    if (!await inspected.count()) await phone.page.getByTestId("course-setting-inspect").click();
    await expect(inspected).toContainText(/(Kollad av|Checked by) Bea Banläggare/);
    const follow = phone.page.getByTestId("course-setting-field").locator("button[data-mode]");
    for (let tries = 0; here && tries < 3 && await follow.getAttribute("data-mode") !== "follow"; tries += 1) await follow.click();
    await zoomIn(phone.page, 3);
    await phone.page.waitForTimeout(2_000);
    await shot(phone.page, language, "gps-mobil");
    await phone.context.close();
  }
});

test("5 layout: layouterna och tryckfärgerna", async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  for (const language of LANGUAGES) {
    await nameRace(browser, baseURL!, language);
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/admin/${state().raceId}/course-setting`);
    await page.getByTestId("course-setting-tab-layout").click();
    await expect(page.getByTestId("layout-page")).toBeVisible({ timeout: 60_000 });
    // Huvudlayouten A4 1:10 000 och två till, båda liggande så att banan ryms: A3 1:10 000 och A4 1:7 500.
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
        await entry.getByTestId("layout-orientation").selectOption("landscape");
      }
    }
    const add = page.getByRole("button", { name: either(`Lägg till ark för ${COURSE.name}`, `Add a sheet for ${COURSE.name}`) });
    for (let tries = 0; tries < 2 && await add.count(); tries += 1) {
      await add.first().click();
      await page.waitForTimeout(1_500);
    }
    await expect(page.getByTestId("layout-cell")).toHaveCount(3);
    const close = page.getByRole("button", { name: /^(Stäng arket|Close the sheet)$/ });
    if (await close.count()) await close.click();
    await page.getByTestId("layout-cell").last().click();
    await page.waitForTimeout(3_000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, language, "layout");
    // Utskriften: tryckfärgerna utfällda och arket med kartan, som två urklipp ovanpå layouten.
    await page.goto(`/admin/${state().raceId}/course-setting/print`);
    await expect(page.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 90_000 });
    const colors = page.getByTestId("print-profile");
    await colors.getByTestId("print-colors-show").click();
    await expect(colors.getByTestId("print-colors-details")).toBeVisible();
    await colors.screenshot({ path: join(rawOf(language), "layout-farger.png") });
    await page.getByTestId("print-sheet").first().screenshot({ path: join(rawOf(language), "layout-ark.png") });
    await context.close();
  }
});

test("6 förbered: startlistan efter lottningen", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  for (const language of LANGUAGES) {
    await nameRace(browser, baseURL!, language);
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/admin/${state().raceId}/manage`);
    const start = page.getByRole("navigation", { name: /^(Tävlingens delar|Parts of the event)$/ }).getByRole("button", { name: "Start", exact: true });
    await start.click();
    await expect(start).toHaveAttribute("aria-current", "step");
    const draw = page.getByRole("region", { name: /^(Lottning|Draw)$/ });
    await expect(draw).toBeVisible();
    // Klasserna i lottningen överst och startlistan under.
    await draw.getByRole("table").first().evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -170));
    await shot(page, language, "forbered");
    await context.close();
  }
});

/** Löparna som läses av i datorn (sant = missad kontroll) och i telefonen; olika per språk, så att ingen bricka läses två gånger. */
const READOUTS: Record<Language, { desktop: readonly [string, boolean?][]; phone: string }> = {
  sv: { desktop: [["Kalle Kompass"], ["Stina Stigfinnare"], ["Olle Punkthöjd"], ["Myra Mossberg"], ["Sten Brantlund"], ["Tuva Höjdkvist", true],
    ["Lo Kärrström"]], phone: "Elsa Hällmark" },
  en: { desktop: [["Björn Granlid"], ["Saga Sankmark"], ["Åke Åsrygg"], ["Vera Udde"], ["Nils Gropström"], ["Maja Sänka", true], ["Ture Stenmur"]],
    phone: "Ylva Bäckman" }
};

test("7 avläsning: övningsstationen i datorn och i telefonen", async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const read = async (page: Page, runners: readonly (readonly [string, boolean?])[]) => {
    await page.goto(`/admin/${state().raceId}/readout`);
    await page.waitForURL(`**/readout/index.html#${state().raceId}`);
    await expect(page.getByTestId("package-status")).toContainText("v", { timeout: 60_000 });
    await page.getByRole("button", { name: /^(Starta övningsstation|Start practice station)$/ }).click();
    await expect(page.getByTestId("station-status")).toContainText(/Övningsstation|Practice station/);
    const select = page.getByRole("combobox", { name: /^(Deltagare|Participant)$/ });
    for (const [runner, missing] of runners) {
      const label = (await select.locator("option").filter({ hasText: runner }).first().textContent())!;
      await select.selectOption({ label });
      await page.getByRole("button", { name: missing ? /^(Läs av: missad kontroll|Read out: missed control)$/
        : /^(Läs av: rätt stämplat|Read out: punched correctly)$/ }).click();
      await expect(page.getByTestId("verdict")).toContainText(new RegExp(`${label.split(" · ").at(-1)}(?!\\d)`), { timeout: 30_000 });
      await expect(page.getByTestId("verdict-sync")).toHaveText(/^(Sparad|Saved)\.$/, { timeout: 30_000 });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  for (const language of LANGUAGES) {
    await nameRace(browser, baseURL!, language);
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await read(page, READOUTS[language].desktop);
    await expect(page.getByText(/inte bekräftat av webbläsaren|not confirmed by the browser/)).toHaveCount(0);
    await shot(page, language, "avlasning");
    await context.close();
    const phone = await phoneOf(browser, baseURL!, language);
    await read(phone.page, [[READOUTS[language].phone]]);
    await shot(phone.page, language, "avlasning-mobil");
    await phone.context.close();
  }
});

test("8 resultat: resultatsidan och live i telefonen", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  for (const language of LANGUAGES) {
    await nameRace(browser, baseURL!, language);
    const { context, page } = await open(browser, baseURL!, DESKTOP, language, { visitor: true });
    await page.goto(`/results/${state().raceId}`);
    await expect(page.getByText("Kalle Kompass").first()).toBeVisible({ timeout: 60_000 });
    await shot(page, language, "resultat");
    await context.close();
    const phone = await phoneOf(browser, baseURL!, language, { visitor: true });
    await phone.page.goto(`/t/${state().shortCode}/live`);
    await expect(phone.page.getByText("Kalle Kompass").first()).toBeVisible({ timeout: 60_000 });
    await shot(phone.page, language, "resultat-mobil");
    await phone.context.close();
  }
});

test("9 arkiv: klubbarkivets träningar", async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  for (const language of LANGUAGES) {
    const { context, page } = await open(browser, baseURL!, DESKTOP, language);
    await page.goto(`/organizer/clubs/${state().clubId}`);
    const tab = page.getByRole("tab", { name: /^(Träningar|Trainings)$/ });
    await tab.click();
    await expect(page.getByTestId("archive-entries").getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
    // De små bilderna ritas i webbläsaren första gången arkivet visas.
    await expect(page.getByTestId("archive-entries").getByText(/Ingen bild än|No image yet/)).toHaveCount(0, { timeout: 120_000 });
    // Flikarna överst (kortet «Kom igång» ovanför hör till en ny klubb).
    await tab.evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -12));
    await shot(page, language, "arkiv");
    await context.close();
  }
});

test("sätt ihop bilderna", async () => {
  test.setTimeout(240_000);
  for (const language of LANGUAGES) {
    for (const name of ["grundkarta", "rita", "vagval", "gps", "layout", "forbered", "avlasning", "resultat", "arkiv"]) {
      expect(existsSync(join(rawOf(language), `${name}.png`)), `${language}/${name}`).toBe(true);
    }
    const out = join(root, "apps/web/public/bildspel", language === "sv" ? "" : language);
    mkdirSync(out, { recursive: true });
    const sizes = await composeSlides(rawOf(language), out);
    for (const [name, bytes] of Object.entries(sizes)) expect(bytes, `${language}/${name}`).toBeLessThan(200_000);
  }
});
