import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, daysFromToday, openStep, registerAccount, unique, warmCourseSetting } from "./helpers";

const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const CLASSES = ["D10", "D12", "D14", "D16", "D21", "H10", "H12", "H14", "H16", "H21"] as const;

/** Påhittad banfil: en bana per klass, klasserna i par med samma första kontroll. */
function courseData(): string {
  const controls = Array.from({ length: 20 }, (_, index) => 31 + index);
  const courses = CLASSES.map((name, index) => {
    const codes = [31 + Math.floor(index / 2), ...controls.slice(10 + (index % 5), 14 + (index % 5))];
    return `<Course><Id>bana-${name}</Id><Name>Bana ${name}</Name>
      <CourseControl type="Start"><Control>S</Control></CourseControl>
      ${codes.map(code => `<CourseControl type="Control"><Control>${code}</Control></CourseControl>`).join("")}
      <CourseControl type="Finish"><Control>M</Control></CourseControl></Course>`;
  }).join("");
  const assignments = CLASSES.map(name =>
    `<ClassCourseAssignment><ClassId>klass-${name}</ClassId><ClassName>${name}</ClassName><CourseName>Bana ${name}</CourseName></ClassCourseAssignment>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="2026-10-01T08:00:00Z" creator="O-Tid test">
  <Event><Name>Påhittad tävling</Name></Event><RaceCourseData>
  <Control type="Start"><Id>S</Id></Control>${controls.map(code => `<Control><Id>${code}</Id></Control>`).join("")}
  <Control type="Finish"><Id>M</Id></Control>${courses}${assignments}</RaceCourseData></CourseData>`;
}

/** Påhittade anmälda: `perClass` per klass, fyra klubbar. */
function entryList(perClass: number): string {
  const given = ["Alva", "Bo", "Cia", "Dan", "Eja", "Fia", "Gus", "Hed", "Ida", "Jon", "Kim", "Liv"];
  const clubs = ["OK Påhitt", "IK Exempel", "SK Test", "OK Prov"];
  let card = 7_100_000;
  const entries = CLASSES.flatMap(name => Array.from({ length: perClass }, (_, index) => {
    const id = `${name}-${index}`;
    return `<PersonEntry><Id>anm-${id}</Id><Person><Id>p-${id}</Id><Name><Family>Testsson${index}</Family><Given>${given[index % given.length]}</Given></Name></Person>
      <Organisation><Name>${clubs[index % clubs.length]}</Name></Organisation>
      <ControlCard punchingSystem="SPORTident">${card++}</ControlCard><Class><Id>klass-${name}</Id><Name>${name}</Name></Class></PersonEntry>`;
  })).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="2026-10-01T08:00:00Z" creator="O-Tid test">
  <Event><Name>Påhittad tävling</Name></Event>${entries}</EntryList>`;
}

async function importXml(page: Page, name: string, xml: string, summary: string | RegExp) {
  await page.getByLabel("IOF XML 3.0").setInputFiles({ name, mimeType: "application/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: "Importera", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Filen är inläst" })).toContainText(summary);
}

/**
 * Användarflödena efter granskningen (ADR-0188). Tio klasser och 300 påhittade löpare läses in från IOF XML. Skärmbilder
 * i dator och 390 px när E2E_UX_SHOTS pekar på en katalog.
 */
const shots = process.env.E2E_UX_SHOTS;
/** Bara ett område (till exempel förhandsvisningen), i dator och 390 px. */
async function shotOf(page: Page, locator: Locator, name: string) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    await locator.screenshot({ path: `${shots}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Hela sidan i dator och 390 px, överst först. */
async function shotPage(page: Page, name: string) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${shots}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

/** Tävling med tio klasser och 300 löpare, inläst från IOF XML. */
async function raceWithClasses(page: Page, eventName: string, date = daysFromToday(30)) {
  const raceId = await createRace(page, eventName, date);
  await page.goto(`/admin/${raceId}/imports`);
  await importXml(page, "banor.xml", courseData(), "10 banor och 10 klasser");
  await importXml(page, "anmalda.xml", entryList(30), "300 deltagare");
  await page.goto(`/admin/${raceId}/manage`);
  return raceId;
}

/**
 * ADR-0188 beslut 1–2: tio klasser lottas med de gemensamma inställningarna och en avvikelse; förhandsvisningen har en rad
 * per klass och löparna bakom ett klick. Första start finns på ett ställe: Inställningar visar den och länkar till lottningen.
 */
test("lotta tio klasser med gemensamma inställningar och en kompakt förhandsvisning", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `ux.lotta.${suffix}@exempel.se`, "Ulla Uxsson");
  await raceWithClasses(owner, `UX lottning ${suffix}`);
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill("10:00");
  const common = draw.getByRole("group", { name: "Gemensamt för klasserna" });
  await common.getByLabel("Startsätt för klasserna").selectOption({ label: "Minutstart" });
  await common.getByLabel("Intervall (min) för klasserna").fill("2");
  await common.getByLabel("Vakanser för klasserna", { exact: true }).fill("2");
  await common.getByRole("button", { name: "Använd för alla" }).click();
  await expect(common.getByRole("status")).toHaveText("Inställningarna gäller nu 10 klasser.");
  await expect(draw.getByLabel("Lotta alla klasser")).toBeChecked();
  for (const name of CLASSES) {
    await expect(draw.getByLabel(`Startsätt ${name}`)).toHaveValue("MINUTE");
    await expect(draw.getByLabel(`Vakanser ${name}`, { exact: true })).toHaveValue("2");
  }
  // Avvikelse i en klass: H21 går med 3 minuter.
  await draw.getByLabel("Intervall (min) H21").fill("3");
  // Bara de ikryssade: D10 och D12 börjar 11:00.
  await draw.getByLabel("Lotta alla klasser").uncheck();
  await draw.getByLabel("Lotta D10").check();
  await draw.getByLabel("Lotta D12").check();
  await common.getByLabel("Klassernas första start (valfritt)").fill("11:00");
  await common.getByRole("button", { name: "Använd för valda (2)" }).click();
  await expect(draw.getByRole("rowheader", { name: /^D10/ })).toContainText("Första start 11:00");
  await expect(draw.getByLabel("Intervall (min) H21")).toHaveValue("3");
  await draw.getByLabel("Lotta alla klasser").check();
  await shotOf(owner, draw, "efter-lottning");

  await draw.getByRole("button", { name: "Visa lottning" }).click();
  const preview = owner.getByRole("region", { name: "Så blir startlistan" });
  await expect(preview).toBeVisible();
  const h21 = preview.locator("summary", { hasText: /^H21/ });
  await expect(h21).toContainText("Minutstart");
  await expect(h21).toContainText("30 + 2 vakanta");
  await expect(preview.locator("summary", { hasText: /^D10/ })).toContainText("11:00–");
  await expect(preview.getByRole("region", { name: "H21", exact: true })).toBeHidden();
  const box = await preview.boundingBox();
  expect(box!.height).toBeLessThan(1_500);
  await shotOf(owner, preview, "efter-lottning-forhandsvisning");
  await h21.click();
  const details = preview.getByRole("region", { name: "H21", exact: true });
  await expect(details.getByRole("row")).toHaveCount(33);
  await expect(details).toContainText("3 min mellan starterna");
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(draw.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();

  // Första start på ett ställe: Inställningar visar den som lottningen sparade och länkar dit.
  await openStep(owner, "Inställningar");
  const info = owner.getByRole("group", { name: "Information till löparna" });
  await expect(info.getByText("10:00", { exact: true })).toBeVisible();
  await info.getByRole("button", { name: "Ändra i Lottning" }).click();
  await expect(owner.getByLabel("Första start (klockslag)")).toHaveValue("10:00");

  // ADR-0188 beslut 3: tävlingen skjuts upp en vecka efter lottningen; starttiderna följer med efter en bekräftelse.
  await openStep(owner, "Inställningar");
  const later = daysFromToday(37);
  await owner.getByLabel("Datum", { exact: true }).fill(later);
  await owner.getByRole("button", { name: "Spara inställningar" }).click();
  const move = owner.getByRole("status", { name: "Flytta tävlingen" });
  await expect(move).toContainText("300 löpare med starttid 10:00–");
  await expect(move).toContainText("Lottningen för 10 klasser följer med");
  await expect(move).toContainText(`Efter flytten: ${later} 10:00–`);
  if (shots) await move.screenshot({ path: `${shots}/efter-datumflytt-1280.png` });
  await move.getByRole("button", { name: "Flytta tävlingen och starttiderna" }).click();
  await expect(owner.getByText(`Tävlingen är flyttad till ${later} med samma starttider.`)).toBeVisible();
  await openStep(owner, "Start");
  await expect(owner.getByRole("region", { name: "Startlistan" }).getByRole("row", { name: /Alva Testsson0/ }).first()).toContainText(/\d\d:\d\d/);
});

/** Sidan går inte utanför skärmen i sidled. */
async function fitsWidth(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/**
 * ADR-0188: på 390 px blir Banor och Klasser kort (namnet överst, uppgifterna med etikett, knapparna under) och ingen del
 * av arbetsytan går utanför skärmen.
 */
test("arbetsytan går inte utanför skärmen på 390 px", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `ux.mobil.${suffix}@exempel.se`, "Mo Mobil");
  await raceWithClasses(owner, `UX mobil ${suffix}`);
  await owner.setViewportSize({ width: 390, height: 844 });
  await openStep(owner, "Banor");
  const courses = owner.getByRole("region", { name: "Banor" });
  await expect(courses.getByRole("rowheader", { name: "Bana H21" })).toBeVisible();
  await fitsWidth(owner);
  await shotPage(owner, "efter-banor");
  await openStep(owner, "Klasser");
  await expect(owner.getByRole("rowheader", { name: "H21" })).toBeVisible();
  await fitsWidth(owner);
  await shotPage(owner, "efter-klasser");
  for (const step of ["Anmälda", "Start", "Publicera", "Avläsning", "Resultat", "Inställningar"] as const) {
    await openStep(owner, step);
    await owner.waitForTimeout(500);
    await fitsWidth(owner);
  }
});

/**
 * ADR-0188: banläggningen. På datorn har lådans flikar hela namn och fältlägets Kollad och Notis här syns inte utanför
 * fältläget; på telefonen syns de vanligaste flikarna med namn och resten under Mer, och Sparat och Ångra finns en gång.
 */
test("banläggningen: hela fliknamn, fältknappar bara i fältet och inga dubbletter i mobilen", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `ux.bana.${suffix}@exempel.se`, "Bo Bana");
  const raceId = await createRace(owner, `UX banläggning ${suffix}`, daysFromToday(30));
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible();
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.reload();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
  // Hela namn, inget avkortat.
  for (const name of ["Banor", "Beskrivning", "Vald", "Objekt", "Utskrift", "Varningar", "Notiser", "Kollat", "Förslag", "Inställningar"]) {
    const tab = owner.getByRole("tab", { name: new RegExp(`^${name}`) });
    await expect(tab).toBeVisible();
    expect(await tab.evaluate(element => element.scrollWidth <= element.clientWidth + 1), name).toBe(true);
  }
  await owner.getByTestId("course-setting-view").selectOption({ label: "Lång" });
  await owner.getByText("kontroll 31", { exact: true }).click();
  await expect(owner.getByTestId("course-setting-inspect")).toHaveCount(0);
  await expect(owner.getByTestId("course-setting-note-here-button")).toHaveCount(0);
  if (shots) await owner.screenshot({ path: `${shots}/efter-banlaggning-1280.png` });

  const phone = await (await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true })).newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
  await phone.getByTestId("course-setting-field-course").selectOption({ label: "Lång" });
  await expect(phone.locator("[role=status]:visible", { hasText: /^Sparat$/ })).toHaveCount(1);
  await phone.getByTestId("course-setting-field-more").click();
  await expect(phone.getByRole("button", { name: "Ångra" })).toHaveCount(1);
  await expect(phone.getByRole("tab", { name: "Inställningar" })).toBeHidden();
  await phone.getByTestId("course-setting-tab-more").click();
  await expect(phone.getByRole("menuitem", { name: /Inställningar/ })).toBeVisible();
  if (shots) await phone.screenshot({ path: `${shots}/efter-banlaggning-390.png` });
  await phone.getByRole("menuitem", { name: /Inställningar/ }).click();
  await expect(phone.getByRole("tab", { name: "Inställningar" })).toBeVisible();
  await fitsWidth(phone);
});
