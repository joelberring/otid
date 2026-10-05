import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 13 (ADR-0170 beslut 3): start- och resultatlistor med samma verktygsrad i arbetsytan och på de
 * publika sidorna. En tävling med två startfållor (första kontroll 31 och 45), en lottad minutstart som redan
 * har startat och en klass med fri start. Varje vy visas, sök och klassfilter fungerar, utskriftsläget visar bara
 * listan och CSV och IOF XML laddas ner. Fem löpare läses av med övningsstationen för resultatlistorna.
 */
const TIME_ZONE = "Europe/Stockholm";
const RUNNERS = [
  { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Ek", card: "8301001" },
  { className: "H21", givenName: "Bo", familyName: "Lind", club: "IFK Lidingö", card: "8301002" },
  { className: "H21", givenName: "Cia", familyName: "Holm", club: "OK Ek", card: "8301003" },
  { className: "D21", givenName: "Dora", familyName: "Berg", club: "Tullinge SK", card: "8301004" },
  { className: "D21", givenName: "Eva", familyName: "Sjö", club: "OK Ek", card: "8301005" },
  { className: "H16", givenName: "Filip", familyName: "Ås", club: "IFK Lidingö", card: "8301006" },
  { className: "H16", givenName: "Gun", familyName: "Mo", club: "Tullinge SK", card: "8301007" },
  { className: "Öppen", givenName: "Hugo", familyName: "Al", club: "OK Ek", card: "8301008" }
] as const;

const zoned = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, ...options }).format(date);
const clock = (date: Date) => zoned(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clockSeconds = (date: Date) => zoned(date, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Skärmbilder för granskning när E2E_SCREENSHOT_DIR är satt (1280 och 390 px). */
async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/step13-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Utskriften som PDF (A4) när E2E_SCREENSHOT_DIR är satt. */
async function printPdf(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.pdf({ path: `${directory}/step13-${name}-print.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
}

async function download(page: Page, toolbar: Locator, item: "CSV (Excel)" | "IOF XML"): Promise<string> {
  await toolbar.getByText("Exportera", { exact: true }).click();
  const [file] = await Promise.all([page.waitForEvent("download"),
    item === "IOF XML" ? toolbar.getByText("IOF XML", { exact: true }).click() : toolbar.getByRole("button", { name: item }).click()]);
  return readFile(await file.path(), "utf8");
}

async function view(toolbar: Locator, name: string) {
  await toolbar.getByRole("button", { name, exact: true }).click();
  await expect(toolbar.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("start- och resultatlistor: vyer, sök, utskrift och export i arbetsytan och publikt", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  // Lottningens första start 25 minuter bakåt. Övningsstationens bricka stämplar första kontrollen ungefär 22 minuter
  // före avläsningen, så de som startar sist stämplar den före sin starttid: sträcktiden är då okänd, inget annat ändras.
  const firstStart = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 25 * 60_000);
  const raceDate = zoned(firstStart, { year: "numeric", month: "2-digit", day: "2-digit" });
  const owner = await registerAccount(browser, `listor.${suffix}`, "Lisa Lista");
  const raceId = await createRace(owner, `Listor ${suffix}`, raceDate, "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addCourseAndClass(owner, "Mellan", "D21", "31 34 33");
  await addCourseAndClass(owner, "Kort", "H16", "45 33");
  await addCourseAndClass(owner, "Inskolning", "Öppen", "45 46");
  for (const runner of RUNNERS) await addEntry(owner, runner);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/start-list-export`);

  // Lottning: H21, D21 och H16 får lottad minutstart med en vakans var. Öppen har kvar fri start.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill(clock(firstStart));
  for (const className of ["H21", "D21", "H16"]) {
    await draw.getByLabel(`Startsätt ${className}`).selectOption({ label: "Lottad minutstart" });
    await draw.getByLabel(`Vakanser ${className}`).fill("1");
  }
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  await owner.getByRole("region", { name: "Så blir startlistan" }).getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();

  // Start per klass: klassrubrik med bana, startsätt och antal; tid, namn, klubb och bricka per rad; vakant tid.
  const list = owner.locator("section:not([hidden]) > [data-list]");
  const toolbar = list.getByRole("toolbar", { name: "Listans verktyg" });
  await expect(toolbar.getByRole("button", { name: "Per klass" })).toHaveAttribute("aria-pressed", "true");
  const h21 = list.getByRole("region", { name: "H21", exact: true });
  await expect(h21).toContainText("Bana Lång · Minutstart · 3 löpare · 1 vakant tid");
  await expect(h21.getByRole("row", { name: /Anna Ek/ })).toContainText("8301001");
  await expect(h21.getByRole("row", { name: /Anna Ek/ })).toContainText(/\d\d:\d\d/);
  await expect(h21.getByRole("row", { name: "Vakant" })).toHaveCount(1);
  await expect(list.getByRole("region", { name: "Öppen", exact: true })).toContainText("Bana Inskolning · Fri start · 1 löpare");
  await expect(toolbar).toContainText("8 löpare");
  await screenshots(owner, "admin-start-per-klass");

  // Per starttid: två startfållor (första kontroll 31 och 45), minut för minut, med vakanta tider och fri start för sig.
  await view(toolbar, "Per starttid");
  const lane31 = list.getByRole("region", { name: "Startfålla · första kontroll 31" });
  const lane45 = list.getByRole("region", { name: "Startfålla · första kontroll 45" });
  await expect(lane31).toContainText("5 löpare");
  await expect(lane45).toContainText("2 löpare");
  await expect(lane31.getByRole("row", { name: /Vakant/ })).toHaveCount(2);
  await expect(lane31.getByRole("cell", { name: clock(firstStart), exact: true })).toBeVisible();
  await expect(list.getByRole("region", { name: "Fri start" })).toContainText("Öppen (1 löpare)");
  await screenshots(owner, "admin-start-per-starttid");

  // Per klubb, sök och klassfilter.
  await view(toolbar, "Per klubb");
  await expect(list.getByRole("region", { name: "OK Ek" })).toContainText("4 löpare");
  await toolbar.getByLabel("Sök").fill("Tullinge");
  await expect(toolbar).toContainText("2 löpare");
  await expect(list.getByRole("region", { name: "OK Ek" })).toHaveCount(0);
  await expect(list.getByRole("region", { name: "Tullinge SK" })).toContainText("Dora Berg");
  await toolbar.getByLabel("Sök").fill("");
  await toolbar.getByLabel("Klass").selectOption("H16");
  await expect(toolbar).toContainText("2 löpare");
  await toolbar.getByLabel("Klass").selectOption("");

  // Utskrift: bara listan med egen rubrik; sidopanel, toppbalk, verktygsrad, lottning och publicering syns inte.
  await owner.emulateMedia({ media: "print" });
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" })).toBeHidden();
  await expect(toolbar).toBeHidden();
  await expect(owner.getByRole("region", { name: "Lottning" })).toBeHidden();
  await expect(list.getByRole("heading", { name: "Startlista per klubb" })).toBeVisible();
  await expect(list.getByRole("region", { name: "OK Ek" })).toBeVisible();
  await printPdf(owner, "admin-start-per-klubb");
  await owner.emulateMedia({ media: "screen" });
  await expect(toolbar).toBeVisible();

  // Export: CSV (BOM, semikolon, svenska rubriker, bricka i arbetsytan) och IOF XML för startlistan som den är nu.
  const csv = await download(owner, toolbar, "CSV (Excel)");
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain("Klubb;Namn;Klass;Starttid;Bricka\r\n");
  expect(csv).toContain(";Dora Berg;D21;");
  expect(csv).toContain("8301004");
  const startXml = await download(owner, toolbar, "IOF XML");
  expect(startXml).toContain("<StartList");
  expect(startXml).toContain("<Family>Holm</Family>");
  expect(startXml).toContain("<StartTime>");
  expect(startXml).not.toContain("8301003");

  // Publicering: en åtgärd. Den publika listan har samma vyer, men aldrig bricka.
  await view(toolbar, "Per klass");
  await owner.getByRole("button", { name: "Publicera startlistan" }).click();
  await expect(owner.getByText("Startlistan är publicerad.")).toBeVisible();
  await expect(owner.getByText(/Publicerad kl\. \d\d:\d\d\. Den publika listan är aktuell\./)).toBeVisible();
  const visitor = await (await browser.newContext()).newPage();
  // Klockan sätts till första startminuten: den minuten markeras som "Nu" i listan per starttid.
  await visitor.clock.setFixedTime(new Date(firstStart.getTime() + 20_000));
  await visitor.goto(`/starts/${raceId}`);
  const publicToolbar = visitor.getByRole("toolbar", { name: "Listans verktyg" });
  await expect(visitor.getByRole("region", { name: "H21", exact: true }).getByRole("row", { name: /Anna Ek/ })).toBeVisible();
  await expect(visitor.getByRole("columnheader", { name: "Bricka" })).toHaveCount(0);
  await expect(visitor.getByText("8301001")).toHaveCount(0);
  await view(publicToolbar, "Per starttid");
  // Båda startfållorna har en start den minuten.
  const now = visitor.locator("tbody[data-current]");
  await expect(now).toHaveCount(2);
  for (const lane of [0, 1]) {
    await expect(now.nth(lane)).toContainText(clock(firstStart));
    await expect(now.nth(lane)).toContainText("Nu");
  }
  await screenshots(visitor, "publik-start-per-starttid");
  const publicCsv = await download(visitor, publicToolbar, "CSV (Excel)");
  expect(publicCsv).toContain("Starttid;Startfålla;Klass;Namn;Klubb\r\n");
  expect(publicCsv).not.toContain("8301001");
  const publicStartXml = await download(visitor, publicToolbar, "IOF XML");
  expect(publicStartXml).toContain("<Family>Ek</Family>");

  // Avläsning: tre i H21 (Cia missar en kontroll) och två i D21.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  for (const runner of RUNNERS.slice(0, 5)) {
    await owner.getByLabel("Deltagare").selectOption({ label: `${runner.givenName} ${runner.familyName} · ${runner.className} · ${runner.card}` });
    const missing = runner.givenName === "Cia";
    await owner.getByRole("button", { name: missing ? "Läs av: missad kontroll" : "Läs av: rätt stämplat" }).click();
    await expect(owner.getByTestId("verdict")).toContainText(missing ? "FELSTÄMPLAD" : "GODKÄND");
  }
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Stämpling före starten (fel klocka eller tjuvstart): Filip får starttid 15 minuter bakåt, men brickan stämplar 45
  // ungefär 20 minuter före avläsningen. Han blir godkänd, sträcktiden vid 45 är okänd och deltagarkortet säger det.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: /Filip Ås/ }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name: "Filip Ås" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await card.getByRole("button", { name: "Ändra starttid" }).click();
  await card.getByLabel("Starttid (klockslag)").fill(clockSeconds(new Date(Date.now() - 15 * 60_000)));
  await card.getByRole("button", { name: "Granska starttid" }).click();
  await card.getByRole("button", { name: "Bekräfta starttid" }).click();
  await expect(owner.getByText("Starttiden är sparad.")).toBeVisible();
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await owner.getByLabel("Deltagare").selectOption({ label: "Filip Ås · H16 · 8301006" });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  await expect(async () => {
    await owner.getByRole("row", { name: /Filip Ås/ }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name: "Filip Ås" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card.getByRole("note")).toContainText("Stämplad utan giltig tid: 45");

  // Resultat per klass: placering, tid, efter och status; den felstämplade saknar placering.
  await warmRoute(owner, `/api/public/races/${raceId}/results`);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/result-export`);
  await openStep(owner, "Resultat");
  const results = owner.locator(`#workflow-${raceId}-results [data-list]`);
  const resultBar = results.getByRole("toolbar", { name: "Listans verktyg" });
  const h21Results = results.getByRole("table", { name: "H21" });
  await expect(h21Results.getByRole("row")).toHaveCount(4);
  await expect(h21Results.getByRole("row").nth(1).getByRole("cell").first()).toHaveText("1");
  await expect(h21Results.getByRole("row", { name: /Cia Holm/ })).toContainText("Felstämplad");
  await expect(h21Results.getByRole("row", { name: /Cia Holm/ })).toContainText("Saknar 32");
  await expect(h21Results.getByRole("row", { name: /Cia Holm/ }).getByRole("cell").first()).toHaveText("");
  await expect(owner.getByRole("heading", { name: "Efterarbete" })).toBeVisible();
  await screenshots(owner, "admin-resultat-per-klass");

  // Med sträcktider: sträcka för sträcka med placering och bästa sträcka.
  await view(resultBar, "Med sträcktider");
  const splits = results.getByRole("table", { name: "H21" });
  for (const header of ["31", "32", "33", "Mål"]) await expect(splits.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
  // H16: ingen har en tid vid 45 (stämplad före starten), så kolumnen finns inte; Filip är godkänd med sin löptid.
  const h16Splits = results.getByRole("table", { name: "H16" });
  await expect(h16Splits.getByRole("columnheader", { name: "45", exact: true })).toHaveCount(0);
  await expect(h16Splits.getByRole("columnheader", { name: "33", exact: true })).toBeVisible();
  await expect(h16Splits.getByRole("row", { name: /Filip Ås/ })).toContainText(/\d+:\d\d/);
  await expect(splits.getByText("(bästa sträcka)").first()).toBeAttached();
  await screenshots(owner, "admin-resultat-med-stracktider");
  const splitCsv = await download(owner, resultBar, "CSV (Excel)");
  expect(splitCsv.startsWith("\uFEFF")).toBe(true);
  expect(splitCsv).toContain("Klass;Variant;Placering;Namn;Klubb;Sluttid;Status;Kontroll;Sträcktid;Sträckplacering;Totaltid\r\n");
  expect(splitCsv).toMatch(/H21;;1;[^;]+;[^;]+;\d+:\d\d;Godkänd;31;/);
  expect(splitCsv).toMatch(/H16;;1;Filip Ås;IFK Lidingö;\d+:\d\d;Godkänd;33;/);

  // Per klubb med sammanfattning och utskrift utan efterarbete.
  await view(resultBar, "Per klubb");
  await expect(results.getByRole("region", { name: "OK Ek" })).toContainText("3 löpare · 2 godkända");
  await screenshots(owner, "admin-resultat-per-klubb");
  await owner.emulateMedia({ media: "print" });
  await expect(resultBar).toBeHidden();
  await expect(owner.getByRole("heading", { name: "Efterarbete" })).toBeHidden();
  await expect(results.getByRole("heading", { name: "Resultatlista per klubb" })).toBeVisible();
  await printPdf(owner, "admin-resultat-per-klubb");
  await owner.emulateMedia({ media: "screen" });
  const resultXml = await download(owner, resultBar, "IOF XML");
  expect(resultXml).toContain("<ResultList");
  expect(resultXml).toContain("<Family>Lind</Family>");

  // Publika resultat: samma tre vyer, ingen följ- eller ruttknapp, namnen länkar till löparens resultat.
  await visitor.clock.setFixedTime(new Date());
  await visitor.goto(`/results/${raceId}`);
  const publicResults = visitor.getByRole("toolbar", { name: "Listans verktyg" });
  await expect(visitor.getByRole("table", { name: "D21" }).getByRole("row")).toHaveCount(3);
  await expect(visitor.getByRole("link", { name: "Anna Ek" })).toHaveAttribute("href", new RegExp(`/results/${raceId}/participants/`));
  await expect(visitor.getByText("Följ resultat")).toHaveCount(0);
  await expect(visitor.getByText("Välj rutt för jämförelse")).toHaveCount(0);
  await publicResults.getByLabel("Sök").fill("Lidingö");
  await expect(publicResults).toContainText("2 löpare");
  await publicResults.getByLabel("Sök").fill("");
  await screenshots(visitor, "publika-resultat");
  await view(publicResults, "Med sträcktider");
  await expect(visitor.getByRole("table", { name: "D21" }).getByRole("columnheader", { name: "34", exact: true })).toBeVisible();
  await screenshots(visitor, "publika-resultat-med-stracktider");
  await visitor.emulateMedia({ media: "print" });
  await expect(publicResults).toBeHidden();
  await expect(visitor.getByRole("navigation", { name: "Publik navigering" })).toBeHidden();
  await expect(visitor.getByRole("heading", { name: "Resultatlista med sträcktider" })).toBeVisible();
  await printPdf(visitor, "publika-resultat-med-stracktider");
  await visitor.emulateMedia({ media: "screen" });
  const publicResultCsv = await download(visitor, publicResults, "CSV (Excel)");
  expect(publicResultCsv).toContain(";Dora Berg;");
  const publicResultXml = await download(visitor, publicResults, "IOF XML");
  expect(publicResultXml).toContain("<ResultList");
  expect(publicResultXml).toContain("<Family>Sjö</Family>");
  // Sidorna hämtar resultat av sig själva; stäng dem så att de inte belastar servern under senare flöden.
  await visitor.context().close();
  await owner.context().close();
});
