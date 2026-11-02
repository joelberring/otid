import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, daysFromToday, openStep, registerAccount, unique } from "./helpers";

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
 * Användarflödena efter granskningen (ADR-0187). Tio klasser och 300 påhittade löpare läses in från IOF XML. Skärmbilder
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
 * ADR-0187 beslut 1–2: tio klasser lottas med de gemensamma inställningarna och en avvikelse; förhandsvisningen har en rad
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
});
