import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, daysFromToday, openEntryForm, openStep, publishRace, readExercise, registerAccount, unique } from "./helpers";

/** Tävlingsdagen i tävlingens tidszon, 30 dagar fram: tävlingen är inte igång när testet körs. */
const raceDate = daysFromToday(30);

/**
 * PLAN.md steg 9: tre klasser lottas på en gång (H21 och D21 har samma första kontroll),
 * förhandsvisningen ser ut som startlistan med vakanta tider, startlistan publiceras med
 * tiderna och en efteranmäld får den vakanta tiden utan att arrangören väljer tid.
 * PLAN.md steg 22: tävlingen ligger en månad fram; dubbelt klassnamn avvisas, ingen är kvar i
 * skogen före tävlingsdagen och övningsstationen läser den efteranmälde som godkänd mot hens fasta start.
 */
test("lotta tre klasser, publicera startlistan och placera en efteranmäld på vakant tid", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `lotta.${suffix}@exempel.se`, "Lo Lottare");
  const raceId = await createRace(owner, `Lottning ${suffix}`, raceDate);
  // Besökarna ska se tävlingen (ADR-0172 beslut 4).
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  // Dubbelt klassnamn avvisas med ett begripligt besked (PLAN.md steg 22).
  // Formuläret "Ny bana" står kvar efter sparandet, tömt (PLAN.md steg 24).
  const courseForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: /^Spara bana( och klass)?$/ }) });
  await expect(courseForm.getByLabel("Bannamn")).toHaveValue("");
  await courseForm.getByLabel("Bannamn").fill("Lång igen");
  await courseForm.getByLabel("Klassnamn").fill("h21");
  await courseForm.getByLabel("Kontrollföljd").fill("31 32");
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByText("Det finns redan en bana som heter Lång igen eller en klass som heter h21 i tävlingen.")).toBeVisible();
  await addCourseAndClass(owner, "Mellan", "D21", "31 34 33");
  await addCourseAndClass(owner, "Kort", "H16", "45 33");
  const clubs = ["OK Ek", "OK Ek", "IFK Lidingö", "Tullinge SK"];
  let card = 8_100_000;
  for (const className of ["H21", "D21", "H16"]) {
    for (const [index, club] of clubs.entries()) {
      await addEntry(owner, { className, givenName: `${className}${"ABCD"[index]}`, familyName: "Löpare", club, card: String(card++) });
    }
  }

  // Start: lottad minutstart för alla tre, första start 10:00, en vakans per klass.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill("10:00");
  for (const className of ["H21", "D21", "H16"]) {
    await draw.getByLabel(`Startsätt ${className}`).selectOption({ label: "Minutstart" });
    await expect(draw.getByLabel(`Lotta ${className}`)).toBeChecked();
    await expect(draw.getByLabel(`Intervall (min) ${className}`)).toHaveValue("2");
    await draw.getByLabel(`Vakanser ${className}`).fill("1");
  }
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  const preview = owner.getByRole("region", { name: "Så blir startlistan" });
  await expect(preview).toBeVisible();
  // ADR-0188 beslut 1: en rad per klass; löparna syns efter ett klick (här alla på en gång).
  await preview.getByRole("button", { name: "Visa alla löpare" }).click();
  await expect(preview.getByText(/H21 har samma första kontroll och startar varannan minut|D21 och H21 har samma första kontroll och startar varannan minut/))
    .toBeVisible();
  for (const className of ["H21", "D21", "H16"]) {
    const section = preview.getByRole("region", { name: className, exact: true });
    await expect(section.getByRole("row")).toHaveCount(6);
    await expect(section.getByText("Vakant", { exact: true })).toHaveCount(1);
  }
  await expect(preview.getByRole("region", { name: "H16", exact: true }).getByRole("row").nth(1)).toContainText("10:00:00");
  const vacantH21 = (await preview.getByRole("region", { name: "H21", exact: true }).getByRole("row", { name: /Vakant/ })
    .getByRole("cell").first().textContent())!.trim();
  expect(vacantH21).toMatch(/^10:\d\d:00$/);
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();

  // Startlistan publiceras och visar de lottade tiderna utan inloggning.
  await owner.getByRole("button", { name: "Publicera startlistan" }).click();
  await expect(owner.getByText("Startlistan är publicerad.")).toBeVisible();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/starts/${raceId}`);
  await expect(visitor.getByText("H16A Löpare").or(visitor.getByText("H16B Löpare")).first()).toBeVisible();
  await expect(visitor.getByRole("cell", { name: "10:00", exact: true }).first()).toBeVisible();

  // Efteranmäld i H21 får den vakanta tiden; arrangören anger ingen tid. Beskedet står i formuläret, inget extra steg.
  await openStep(owner, "Anmälda");
  const entryForm = await openEntryForm(owner);
  await entryForm.getByRole("combobox", { name: "Klass" }).selectOption({ label: "H21" });
  await expect(entryForm.getByText("Klassen är lottad.", { exact: false })).toBeVisible();
  await expect(entryForm.getByLabel("Starttid (klockslag)")).toHaveCount(0);
  await entryForm.getByLabel("Förnamn").fill("Sen");
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill("Anmäld");
  await entryForm.getByLabel("Klubb").fill("OK Ek");
  await entryForm.getByLabel("Bricka (valfritt)").fill(String(card++));
  await entryForm.getByRole("button", { name: "Lägg till", exact: true }).click();
  await expect(entryForm.getByRole("status")).toContainText(`Sen Anmäld är anmäld i H21 med start ${vacantH21.slice(0, 5)}`);
  await openStep(owner, "Start");
  await expect(owner.getByRole("row", { name: /Sen Anmäld/ })).toContainText(vacantH21.slice(0, 5));

  // Före tävlingsdagen är ingen kvar i skogen, varken i toppbalken eller i kontrollvyn (PLAN.md steg 22).
  await expect(owner.getByText("0 kvar i skogen")).toBeVisible();
  await openStep(owner, "Avläsning");
  await expect(owner.getByTestId("in-forest-count")).toHaveText("0");
  await expect(owner.getByTestId("in-forest-not-started")).toBeVisible();

  // Övningsstationen på en kommande tävling: den efteranmälde läses mot sin fasta starttid och blir godkänd.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
  await readExercise(owner, `Sen Anmäld · H21 · ${card - 1}`);
  await expect(owner.getByTestId("verdict")).toContainText("Sen Anmäld");
  await expect(owner.getByTestId("verdict")).toContainText("30:00");
});

/**
 * Ägaren 2026-11-08: masstart direkt på klassen (nattcup). Klassen får minutstart, sedan masstart kl. 19:00 i klassens rad: alla
 * anmälda får tiden, och en efteranmäld får samma tid.
 */
test("masstart direkt på klassen", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `masstart.${suffix}@exempel.se`, "Mia Masstart");
  await createRace(owner, `Nattcup ${suffix}`, raceDate);
  await addCourseAndClass(owner, "Natt", "Natt lång", "31 32 33");
  await addEntry(owner, { className: "Natt lång", givenName: "Ada", familyName: "Natt", club: "OK Ek", card: "8300001" });
  await addEntry(owner, { className: "Natt lång", givenName: "Bo", familyName: "Natt", club: "OK Ek", card: "8300002" });

  await openStep(owner, "Klasser");
  const row = owner.getByRole("row", { name: /Natt lång/ });
  await row.getByRole("button", { name: "Redigera Natt lång" }).click();
  const editor = owner.getByRole("form", { name: "Redigera Natt lång" });
  await expect(editor.getByTestId("class-mass-start")).toHaveCount(0);
  await editor.getByLabel("Startsätt").selectOption({ label: "Minutstart" });
  const classRow = owner.getByRole("row", { name: /^Natt lång Natt/ });
  // Ett nytt startsätt kan först visa vad som händer; då sparar nästa tryck.
  await expect.poll(async () => {
    if ((await classRow.textContent())?.includes("Minutstart")) return true;
    const save = editor.getByRole("button", { name: "Spara ändringen" });
    if (await save.isVisible()) await save.click({ timeout: 2_000 }).catch(() => undefined);
    return false;
  }, { timeout: 30_000, intervals: [1_000] }).toBe(true);

  await classRow.getByRole("button", { name: "Redigera Natt lång" }).click();
  const massStart = owner.getByTestId("class-mass-start");
  await massStart.getByTestId("class-mass-start-time").fill("19:00");
  await massStart.getByTestId("class-mass-start-save").click();
  await expect(massStart.getByRole("status")).toHaveText("Masstart kl. 19:00 är satt för klassen.", { timeout: 20_000 });

  // Alla anmälda och en efteranmäld har 19:00.
  await addEntry(owner, { className: "Natt lång", givenName: "Cia", familyName: "Natt", club: "OK Ek", card: "8300003" });
  await openStep(owner, "Anmälda");
  for (const name of ["Ada Natt", "Bo Natt", "Cia Natt"]) await expect(owner.getByRole("row", { name: new RegExp(name) }).first()).toContainText("19:00");
});
