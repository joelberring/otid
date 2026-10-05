import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 16 (ADR-0171): sträcktidsanalys och vägval. Tre löpare lottas med fem minuter mellan starterna och
 * läses av med övningsstationen (den som startar sist missar en kontroll), så att sträckan Start–31 har olika tider.
 * Admin laddar upp kartan, georefererar den och laddar upp två GPX-rutter. Publikt: från resultatlistan till
 * analysen, sortering på en sträcka och vägval på kartan med en annan löpare att jämföra med.
 */
const TIME_ZONE = "Europe/Stockholm";
const RUNNERS = [
  { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Ek", card: "8401001" },
  { className: "H21", givenName: "Bo", familyName: "Lind", club: "IFK Lidingö", card: "8401002" },
  { className: "H21", givenName: "Cia", familyName: "Holm", club: "OK Ek", card: "8401003" }
] as const;
const fixtures = new URL("../../fixtures/", import.meta.url);
/** Fixturkartans punkter (800 × 600 px, norr uppåt) och deras koordinater. */
const TIE_POINTS = [
  { x: "100", y: "100", coordinate: "59.308333, 18.0935" },
  { x: "700", y: "100", coordinate: "59.308333, 18.1145" },
  { x: "100", y: "500", coordinate: "59.301667, 18.0935" }
];

const zoned = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, ...options }).format(date);
const clock = (date: Date) => zoned(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fullName = (runner: (typeof RUNNERS)[number]) => `${runner.givenName} ${runner.familyName}`;

/** Skärmbilder för granskning när E2E_SCREENSHOT_DIR är satt (1280 och 390 px). */
async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/step16-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Sidan rullar aldrig i sidled på 390 px; bara tabellen gör det inne i sin ram. */
async function noPageScroll(page: Page) {
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Fixturens GPX har tider från 2026-01-01 00:00 och löparens start 300 s in; flyttas så att starten blir `startMs`. */
async function shiftedGpx(name: string, startMs: number): Promise<Buffer> {
  const source = await readFile(new URL(`routes/${name}.gpx`, fixtures), "utf8");
  const offset = startMs - 300_000 - Date.UTC(2026, 0, 1);
  return Buffer.from(source.replace(/<time>([^<]+)<\/time>/g, (_match, time: string) =>
    `<time>${new Date(Date.parse(time) + offset).toISOString()}</time>`));
}

test("sträcktidsanalys: från resultatlistan, sortering på en sträcka och vägval på kartan", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const firstStart = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 40 * 60_000);
  const raceDate = zoned(firstStart, { year: "numeric", month: "2-digit", day: "2-digit" });
  const owner = await registerAccount(browser, `stracka.${suffix}@exempel.se`, "Sara Sträcka");
  const raceId = await createRace(owner, `Sträckor ${suffix}`, raceDate, "Tävling");
  // Besökarna ska se tävlingen (ADR-0172 beslut 4).
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  for (const runner of RUNNERS) await addEntry(owner, runner);
  for (const path of ["map", "map/image"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`);
  for (const path of ["map/georeference", "routes"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, "POST");

  // Lottning: fem minuter mellan starterna, med första start 40 minuter bakåt.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill(clock(firstStart));
  await draw.getByLabel("Startsätt H21").selectOption({ label: "Lottad minutstart" });
  await draw.getByLabel("Intervall (min) H21").fill("5");
  await draw.getByLabel("Vakanser H21").fill("0");
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  await owner.getByRole("region", { name: "Så blir startlistan" }).getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();
  // Startordningen: den som startar sist missar en kontroll och får därför den kortaste sträckan Start–31.
  // Listan ritas om när lottningen sparats: vänta tills alla tre har en starttid.
  const h21 = owner.locator("section:not([hidden]) > [data-list]").getByRole("region", { name: "H21", exact: true });
  for (const runner of RUNNERS) await expect(h21.getByRole("row", { name: new RegExp(fullName(runner)) })).toContainText(/\d\d:\d\d/);
  const startRows = await h21.getByRole("row").allTextContents();
  const order = startRows.flatMap(row => RUNNERS.filter(runner => row.includes(fullName(runner)))
    .map(runner => ({ runner, time: /\b\d\d:\d\d\b/.exec(row)?.[0] ?? "" })))
    .sort((a, b) => a.time.localeCompare(b.time)).map(row => row.runner);
  expect(order).toHaveLength(3);
  const [early, middle, late] = order as [(typeof RUNNERS)[number], (typeof RUNNERS)[number], (typeof RUNNERS)[number]];

  // Avläsning med övningsstationen: kortet startar 30 minuter före avläsningen med kontrollerna jämnt fördelade.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  const cardStart = new Map<string, number>();
  for (const runner of [early, middle, late]) {
    await owner.getByLabel("Deltagare").selectOption({ label: `${fullName(runner)} · H21 · ${runner.card}` });
    cardStart.set(runner.card, Date.now() - 30 * 60_000);
    await owner.getByRole("button", { name: runner === late ? "Läs av: missad kontroll" : "Läs av: rätt stämplat" }).click();
    await expect(owner.getByTestId("verdict")).toContainText(runner === late ? "FELSTÄMPLAD" : "GODKÄND");
  }
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Admin: Resultat → Karta och vägval. Kartbild, tre punkter och två rutter.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Resultat");
  const section = owner.getByRole("region", { name: "Karta och vägval" });
  await section.getByLabel("Kartbild (PNG eller JPEG, högst 30 MB)").setInputFiles(new URL("maps/strackanalys.png", fixtures).pathname);
  await section.getByRole("button", { name: "Ladda upp karta" }).click();
  await expect(section.getByText("Kartan är uppladdad.", { exact: false })).toBeVisible();
  await expect(section.getByText("Inte georefererad än")).toBeVisible();
  await expect(section.getByRole("img", { name: /Kartan\. Klicka/ })).toBeVisible();
  for (const [index, point] of TIE_POINTS.entries()) {
    await section.getByLabel(`Punkt ${index + 1} x (px)`).fill(point.x);
    await section.getByLabel(`Punkt ${index + 1} y (px)`).fill(point.y);
    await section.getByLabel(`Punkt ${index + 1} Koordinat (lat, lon)`).fill(point.coordinate);
  }
  await section.getByRole("button", { name: "Spara georeferens" }).click();
  await expect(section.getByText("Georeferensen är sparad.", { exact: false })).toBeVisible();
  await expect(section.getByText("Georefererad", { exact: true })).toBeVisible();
  for (const [runner, file] of [[middle, "anna"], [early, "bo"]] as const) {
    await section.getByRole("combobox", { name: "Löpare", exact: true }).selectOption({ label: `${fullName(runner)} · H21` });
    await section.getByLabel("GPX-fil").setInputFiles({ name: `${file}.gpx`, mimeType: "application/gpx+xml",
      buffer: await shiftedGpx(file, cardStart.get(runner.card)!) });
    await section.getByRole("button", { name: "Ladda upp rutt" }).click();
    await expect(section.getByText(`Rutten för ${fullName(runner)} är sparad och täcker 4 av 4 sträckor.`)).toBeVisible();
  }
  await expect(section.getByRole("table", { name: "Uppladdade rutter" }).getByRole("row")).toHaveCount(3);
  await expect(owner.getByRole("table", { name: "H21" })).toBeVisible({ timeout: 30_000 });
  await screenshots(owner, "admin-karta-och-vagval");

  // Publikt: resultatlistan med sträcktider länkar till analysen för klassen.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const toolbar = visitor.getByRole("toolbar", { name: "Listans verktyg" });
  await toolbar.getByRole("button", { name: "Med sträcktider", exact: true }).click();
  await visitor.getByRole("link", { name: "Sträcktidsanalys för H21" }).click();
  await visitor.waitForURL(`**/results/${raceId}/splits?class=H21`);
  await expect(visitor.getByRole("heading", { name: "Sträcktidsanalys", level: 1 })).toBeVisible();
  const table = visitor.getByRole("table", { name: "H21" });
  const bodyRows = table.locator("tbody tr");
  // Resultatordning: de godkända efter tid (den som startade först har längst tid), den felstämplade under.
  await expect(bodyRows).toHaveCount(3);
  await expect(bodyRows.nth(0)).toContainText(fullName(middle));
  await expect(bodyRows.nth(1)).toContainText(fullName(early));
  await expect(bodyRows.nth(2)).toContainText(fullName(late));
  await expect(bodyRows.nth(2)).toContainText("Felstämplad");
  // Missad kontroll 32: tiden saknas där och sträckan 32–33 är okänd.
  await expect(bodyRows.nth(2).locator("td").nth(3)).toContainText("–");
  await expect(table.locator("td[data-best]").first()).toContainText("★");

  // Sortera på Start–31: den felstämplade startade sist och har kortast sträcka, sedan i startordning baklänges.
  await table.getByRole("button", { name: "Sortera på sträcka Start–31" }).click();
  await expect(table.getByRole("columnheader", { name: "Sortera på sträcka Start–31" })).toHaveAttribute("aria-sort", "ascending");
  await expect(visitor.getByText("Sorterad på sträcka Start–31.")).toBeVisible();
  await expect(bodyRows.nth(0)).toContainText(fullName(late));
  await expect(bodyRows.nth(1)).toContainText(fullName(middle));
  await expect(bodyRows.nth(2)).toContainText(fullName(early));
  await screenshots(visitor, "stracktidsanalys-sorterad");
  await noPageScroll(visitor);

  // Tidsförlust mot bästa sträcka.
  await visitor.getByRole("button", { name: "Tidsförlust" }).click();
  await expect(visitor.getByRole("table", { name: "H21" }).getByRole("columnheader", { name: "Förlust" })).toBeVisible();
  await visitor.getByRole("button", { name: "Sträcktider" }).click();

  // Vägval: länken finns bara där en rutt finns (inte för den felstämplade) och öppnar kartan för sträckan 31–32.
  await expect(bodyRows.filter({ hasText: fullName(late) }).getByRole("link", { name: /^Vägval för/ })).toHaveCount(0);
  await bodyRows.filter({ hasText: fullName(middle) }).getByRole("link", { name: `Vägval för ${fullName(middle)} på sträcka 31–32` }).click();
  await visitor.waitForURL(`**/results/${raceId}/routes?**`);
  await expect(visitor.getByRole("heading", { name: "Vägval 31–32", level: 1 })).toBeVisible();
  await expect(visitor.getByTestId("selected-route").locator("polyline").first()).toHaveAttribute("points", /\d/);
  const runners = visitor.getByRole("region", { name: "Löpare på sträckan" });
  await expect(runners.getByRole("listitem")).toHaveCount(2);
  await expect(runners.getByRole("listitem").first()).toContainText(fullName(middle));
  await expect(runners.getByRole("link", { name: fullName(early) })).toBeVisible();
  // Kartbilden laddas och syns bakom rutten.
  await expect.poll(() => visitor.evaluate(async () => {
    const image = document.querySelector("[data-testid=route-map] image");
    const href = image?.getAttribute("href");
    return href ? (await fetch(href)).status : 0;
  })).toBe(200);
  await visitor.getByRole("button", { name: "Zooma in" }).click();
  await visitor.getByRole("button", { name: "Hela sträckan" }).click();
  await screenshots(visitor, "vagval");
  await noPageScroll(visitor);

  // Tillbaka till analysen för klassen.
  await visitor.getByRole("link", { name: "Till sträcktidsanalysen" }).click();
  await visitor.waitForURL(`**/results/${raceId}/splits?class=H21`);
});
