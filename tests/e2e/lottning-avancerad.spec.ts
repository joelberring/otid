import { expect, test, type Locator, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, daysFromToday, openStep, registerAccount, unique } from "./helpers";

/** Tävlingsdagen i tävlingens tidszon, 30 dagar fram: tävlingen är inte igång när testet körs. */
const raceDate = daysFromToday(30);

/** Startsätt Minutstart för klassen och "Visa lottning"; förhandsvisningen returneras. */
async function previewDraw(owner: Page, draw: Locator, className: string) {
  await draw.getByLabel(`Startsätt ${className}`).selectOption({ label: "Minutstart" });
  await expect(draw.getByLabel(`Lotta ${className}`)).toBeChecked();
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  const preview = owner.getByRole("region", { name: "Så blir startlistan" });
  await expect(preview).toBeVisible();
  return preview;
}

/** Löparnas tider i en klass i förhandsvisningen: namn → klockslag (HH:MM:SS). */
async function times(section: Locator): Promise<Record<string, string>> {
  const rows = await section.getByRole("row").allInnerTexts();
  return Object.fromEntries(rows.slice(1).map(row => row.split("\t").map(cell => cell.trim()))
    .map((cells): [string, string] => [cells[1]!.split(" · ")[0]!, cells[0]!]));
}

/**
 * PLAN.md steg 26: avancerad lottning. En klass lottas; en klass som läggs till efteråt lottas för sig och
 * hamnar runt den första klassens tider, som inte rörs; en tredje klass startar 30 minuter efter första
 * start med en seedad löpare sist, och förhandsvisningen varnar när sista start inte räcker. Inställningarna
 * finns kvar nästa gång.
 */
test("lotta en klass, lotta en efteranmäld klass för sig och en klass med senare start och seedad sist", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `avancerad.${suffix}@exempel.se`, "Ava Lottare");
  await createRace(owner, `Avancerad lottning ${suffix}`, raceDate);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  let card = 8_300_000;
  for (const name of ["A", "B", "C"]) {
    await addEntry(owner, { className: "H21", givenName: `H21${name}`, familyName: "Löpare", club: `Klubb ${name}`, card: String(card++) });
  }

  // 1. Lotta H21 i det enkla läget.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill("10:00");
  let preview = await previewDraw(owner, draw, "H21");
  const h21 = await times(preview.getByRole("region", { name: "H21", exact: true }));
  expect(Object.values(h21).sort()).toEqual(["10:00:00", "10:02:00", "10:04:00"]);
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(draw.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();

  // 2. D21 läggs till efteråt (samma första kontroll) och lottas för sig: H21 behåller sina tider.
  await addCourseAndClass(owner, "Mellan", "D21", "31 34 33");
  for (const name of ["A", "B", "C"]) {
    await addEntry(owner, { className: "D21", givenName: `D21${name}`, familyName: "Löpare", club: `Klubb ${name}`, card: String(card++) });
  }
  await openStep(owner, "Start");
  await expect(draw.getByRole("row", { name: /D21/ })).toBeVisible();
  await expect(draw.getByLabel("Lotta H21")).not.toBeChecked();
  await expect(draw.getByRole("row", { name: /H21/ })).toContainText("Har starttider");
  preview = await previewDraw(owner, draw, "D21");
  await expect(preview.getByText("Behåller sina tider: H21 (3 starter 10:00–10:04).")).toBeVisible();
  const d21 = await times(preview.getByRole("region", { name: "D21", exact: true }));
  expect(Object.values(d21).sort()).toEqual(["10:01:00", "10:03:00", "10:05:00"]);
  const timeline = preview.getByRole("table", { name: "Minut för minut" });
  await expect(timeline.getByRole("row", { name: /^10:00/ })).toContainText("H21");
  await expect(timeline.getByRole("row", { name: /^10:00/ })).not.toContainText("Ny");
  await expect(timeline.getByRole("row", { name: /^10:01/ })).toContainText("D21Ny");
  await expect(preview.getByRole("button", { name: "Spara lottningen" })).toBeVisible();
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(draw.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();
  const startList = owner.getByRole("region", { name: "Startlistan" });
  for (const [name, time] of [...Object.entries(h21), ...Object.entries(d21)]) {
    await expect(startList.getByRole("row", { name: new RegExp(name) }).first()).toContainText(time.slice(0, 5));
  }

  // 3. H16 startar 30 minuter efter första start, med H16D seedad sist; sista start 10:33 räcker inte.
  await addCourseAndClass(owner, "Kort", "H16", "45 33");
  for (const name of ["A", "B", "C", "D"]) {
    await addEntry(owner, { className: "H16", givenName: `H16${name}`, familyName: "Löpare", club: `Klubb ${name}`, card: String(card++) });
  }
  await openStep(owner, "Start");
  await expect(draw.getByRole("row", { name: /H16/ })).toBeVisible();
  await draw.getByLabel("Startsätt H16").selectOption({ label: "Minutstart" });
  await draw.locator("summary", { hasText: "Avancerat" }).click();
  const rules = draw.getByRole("region", { name: "Regler för hela starten" });
  await rules.getByLabel("Sista start (klockslag, valfritt)").fill("10:33");
  const order = draw.getByRole("region", { name: "Startordning och senare start" });
  await order.getByLabel("Första start H16").selectOption({ label: "Minuter efter första start" });
  await order.getByLabel("Tid för första start H16").fill("30");
  const seeding = draw.getByRole("region", { name: "Seedning" });
  await seeding.getByLabel("Visa löpare i klassen").selectOption({ label: "H16" });
  await seeding.getByLabel("Seedning H16D Löpare").fill("1");
  await expect(seeding.getByText("1 seedad")).toBeVisible();
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  preview = owner.getByRole("region", { name: "Så blir startlistan" });
  const h16 = preview.getByRole("region", { name: "H16", exact: true });
  await expect(h16.getByRole("row").nth(1)).toContainText("10:30:00");
  await expect(h16.getByRole("row").last()).toContainText("H16D Löpare · seedad 1");
  await expect(h16.getByRole("row").last()).toContainText("10:36:00");
  await expect(preview.getByRole("alert")).toContainText(
    "Startfönstret räcker inte: H16 får starter efter sista start 10:33 (från 10:34). Sista start behöver vara 10:36");
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(draw.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();
  await expect(startList.getByRole("row", { name: /H16D Löpare/ }).first()).toContainText("10:36");
  for (const [name, time] of Object.entries(h21)) await expect(startList.getByRole("row", { name: new RegExp(name) }).first()).toContainText(time.slice(0, 5));

  // Inställningarna finns kvar: Avancerat öppnas av sig självt med senare start, sista start och seedningen.
  await owner.reload();
  await openStep(owner, "Start");
  await expect(order.getByLabel("Tid för första start H16")).toHaveValue("30");
  await expect(rules.getByLabel("Sista start (klockslag, valfritt)")).toHaveValue("10:33");
  await seeding.getByLabel("Visa löpare i klassen").selectOption({ label: "H16" });
  await expect(seeding.getByLabel("Seedning H16D Löpare")).toHaveValue("1");
});
