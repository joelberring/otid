import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, openCourseForm, openStep, registerAccount, unique, warmRoute } from "./helpers";

/** Etikettens överkant per fält i raden: fälten på samma rad ska börja på samma höjd. */
async function labelTops(form: Locator, labels: readonly string[]): Promise<number[]> {
  return Promise.all(labels.map(async label => {
    const box = await form.locator("label").filter({ hasText: label }).first().boundingBox();
    if (!box) throw new Error(`Fältet ${label} syns inte`);
    return Math.round(box.y);
  }));
}

async function formShots(page: Page, form: Locator, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Ingen vågrät rullning på 390 px.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (directory) await form.screenshot({ path: `${directory}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

// Steg 55: "varför måste man välja klass när man skapar banor?" Klassnamnet är valfritt; klassen kan läggas till under Klasser.
test("en bana utan klass sparas och får sedan en klass under Klasser", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg55.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Bana utan klass ${suffix}`);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-classes`, "POST");
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/classes`, "POST");
  await openStep(owner, "Banor");
  const form = await openCourseForm(owner);
  await expect(form.getByText("Skriv kontrollerna i ordning. Fyll i ett klassnamn om du vill skapa en klass som springer banan direkt.")).toBeVisible();
  await expect(form.getByLabel("Klassnamn (valfritt)")).toHaveValue("");
  // Startsättet gäller klassen och visas först när ett klassnamn finns.
  await expect(form.getByLabel("Startsätt")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Spara bana", exact: true })).toBeVisible();
  await form.getByLabel("Klassnamn (valfritt)").fill("H21");
  await expect(form.getByLabel("Startsätt")).toHaveValue("PUNCH");
  await expect(form.getByRole("button", { name: "Spara bana och klass" })).toBeVisible();
  // Fälten på samma rad börjar på samma höjd, även när ett fel visas under ett av dem.
  const [course, raceClass] = await labelTops(form, ["Bannamn", "Klassnamn (valfritt)"]);
  expect(raceClass).toBe(course);
  await form.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(form.getByText("Skriv banans namn.")).toBeVisible();
  const [withError, classWithError] = await labelTops(form, ["Bannamn", "Klassnamn (valfritt)"]);
  expect(classWithError).toBe(withError);
  await form.getByLabel("Klassnamn (valfritt)").fill("");
  await expect(form.getByLabel("Startsätt")).toHaveCount(0);
  await form.getByLabel("Bannamn").fill("Sprintslinga");
  await form.getByLabel("Kontrollföljd").fill("31 32 33");
  await expect(form.getByText("Skriv banans namn.")).toHaveCount(0);
  await formShots(owner, form, "ny-bana");

  await form.getByRole("button", { name: "Spara bana", exact: true }).click();
  await expect(owner.getByText("Banan är sparad.")).toBeVisible({ timeout: 30_000 });
  const row = owner.getByRole("row", { name: /Sprintslinga/ });
  await expect(row).toContainText("31 32 33");
  await expect(form.getByLabel("Bannamn")).toHaveValue("");

  // Klassen läggs till på banan under Klasser.
  await openStep(owner, "Klasser");
  await owner.getByRole("button", { name: "Ny klass" }).click();
  const classForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Spara klass" }) });
  await classForm.getByLabel("Nytt klassnamn").fill("Öppen");
  await classForm.getByRole("combobox", { name: "Bana", exact: true }).selectOption({ label: "Sprintslinga" });
  await classForm.getByRole("button", { name: "Spara klass" }).click();
  await expect(owner.getByText("Klassen är sparad.")).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByRole("row", { name: /Öppen/ })).toContainText("Sprintslinga");
  await openStep(owner, "Banor");
  await expect(owner.getByRole("row", { name: /Sprintslinga/ })).toContainText("Öppen");
});
