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
 * Ägaren 2026-11-08: masstart direkt på klassen (nattcup). Klassen får masstart kl. 19:00 i klassens rad: alla
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
  // Ägaren 2026-11-15: masstart är ett eget val i startsättet, med tiden under och samma spara-knapp, också från fri start.
  const classRow = owner.getByRole("row", { name: /^Natt lång Natt/ });
  await expect(classRow).toContainText("Fri start");
  await editor.getByLabel("Startsätt").selectOption({ label: "Masstart" });
  await editor.getByTestId("class-mass-start-time").fill("19:00");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(editor.getByTestId("class-mass-start-saved")).toContainText("Masstart kl. 19:00 är satt för klassen.", { timeout: 20_000 });
  // Klasstabellen säger masstart, inte minutstart.
  await expect(classRow).toContainText("Masstart 19:00", { timeout: 20_000 });

  // Alla anmälda och en efteranmäld har 19:00.
  await addEntry(owner, { className: "Natt lång", givenName: "Cia", familyName: "Natt", club: "OK Ek", card: "8300003" });
  await openStep(owner, "Anmälda");
  for (const name of ["Ada Natt", "Bo Natt", "Cia Natt"]) await expect(owner.getByRole("row", { name: new RegExp(name) }).first()).toContainText("19:00");
});

/**
 * Samtidiga masstarter på samma bana, vågtabell i Start → Lottning och snabb flytt av masstart på tävlingsdagen.
 */
test("samtidiga masstarter på samma bana, masstartsvågor i lottningen och snabb flytt på tävlingsdagen", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `vagor.${suffix}@exempel.se`, "Vera Våg");
  await createRace(owner, `Nattcup vågor ${suffix}`, raceDate);
  // Två banor med två klasser vardera (samma kontroller på delad bana!).
  await addCourseAndClass(owner, "Bana A", "Superion dam", "31 32 33");
  await addCourseAndClass(owner, "Bana B", "Hyperion dam", "41 42 43");
  // Lägg till en andra klass på varje befintlig bana via Klasser → Ny klass.
  await openStep(owner, "Klasser");
  for (const [courseName, className] of [["Bana A", "Superion herr"], ["Bana B", "Hyperion herr"]] as const) {
    await owner.getByRole("button", { name: "Ny klass" }).click();
    const form = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Spara klass" }) });
    await form.getByLabel("Nytt klassnamn").fill(className);
    await form.getByLabel("Bana").selectOption({ label: courseName });
    await form.getByRole("button", { name: "Spara klass" }).click();
    await expect(owner.getByRole("row", { name: new RegExp(`^${className}`) })).toBeVisible();
  }
  let card = 8_400_000;
  for (const className of ["Superion dam", "Superion herr", "Hyperion dam", "Hyperion herr"]) {
    await addEntry(owner, { className, givenName: "L1", familyName: className.replace(" ", ""), club: "OK Ek", card: String(card++) });
    await addEntry(owner, { className, givenName: "L2", familyName: className.replace(" ", ""), club: "IFK", card: String(card++) });
  }

  // 1. Sätt Hyperion dam och Hyperion herr (samma Bana B!) till 19:10 via Klasser → Redigera (även med 19.10).
  await openStep(owner, "Klasser");
  for (const [className, inputClock] of [["Hyperion dam", "19:10"], ["Hyperion herr", "19.10"]] as const) {
    await owner.getByRole("row", { name: new RegExp(`^${className}`) }).getByRole("button", { name: `Redigera ${className}` }).click();
    const editor = owner.getByRole("form", { name: `Redigera ${className}` });
    await editor.getByLabel("Startsätt").selectOption({ label: "Masstart" });
    await editor.getByTestId("class-mass-start-time").fill(inputClock);
    await editor.getByRole("button", { name: "Spara ändringen" }).click();
    await expect(editor.getByTestId("class-mass-start-saved")).toContainText("Masstart kl. 19:10 är satt för klassen.", { timeout: 20_000 });
    await editor.getByRole("button", { name: "Avbryt" }).click();
    await expect(owner.getByRole("row", { name: new RegExp(`^${className}`) })).toContainText("Masstart 19:10");
  }

  // 2. Sätt Superion dam och Superion herr till 19:00 direkt i Start → Lottning utan att röra 19:10-vågen!
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /Superion dam/ })).toBeVisible();
  await expect(draw.getByLabel("Masstart kl. Hyperion dam")).toHaveValue("19:10");
  await expect(draw.getByLabel("Masstart kl. Hyperion herr")).toHaveValue("19:10");
  for (const [className, clock] of [["Superion dam", "19:00"], ["Superion herr", "1900"]] as const) {
    await draw.getByLabel(`Startsätt ${className}`).selectOption({ label: "Masstart" });
    await draw.getByLabel(`Masstart kl. ${className}`).fill(clock);
  }
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  const preview = owner.getByRole("region", { name: "Så blir startlistan" });
  await expect(preview).toBeVisible();
  await expect(preview.locator("summary", { hasText: /^Superion dam/ })).toContainText("19:00");
  await expect(preview.locator("summary", { hasText: /^Superion herr/ })).toContainText("19:00");
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(draw.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();

  // 3. Två vågor visas i Masstartstider: 19:00 och 19:10. Skjut upp 19:10-vågen till 19:14 i ett svep!
  const waves = draw.getByTestId("mass-start-waves");
  await expect(waves.getByTestId("mass-wave-row")).toHaveCount(2);
  await expect(waves).toContainText("19:00");
  await expect(waves).toContainText("Superion dam, Superion herr");
  await expect(waves).toContainText("19:10");
  await expect(waves).toContainText("Hyperion dam, Hyperion herr");

  await waves.getByRole("button", { name: "Flytta masstart 19:10" }).click();
  const shiftEditor = waves.getByTestId("mass-wave-editor");
  await shiftEditor.getByTestId("mass-wave-clock").fill("1914");
  await shiftEditor.getByRole("button", { name: "Flytta till 19:14" }).click();
  const confirm = owner.getByTestId("mass-wave-confirm");
  await expect(confirm).toContainText("Hyperion dam och Hyperion herr");
  await expect(confirm).toContainText("19:10 till 19:14 (+4 min)");
  await confirm.getByRole("button", { name: "Flytta och spara" }).click();
  await expect(draw.getByText("Masstarten flyttad från 19:10 till 19:14 för Hyperion dam och Hyperion herr.")).toBeVisible();
  await expect(waves).toContainText("19:14");
  await expect(draw.getByLabel("Masstart kl. Hyperion dam")).toHaveValue("19:14");
  await expect(draw.getByLabel("Masstart kl. Hyperion herr")).toHaveValue("19:14");
  await expect(draw.getByLabel("Masstart kl. Superion dam")).toHaveValue("19:00");

  // Efteranmäld i Hyperion herr får automatiskt 19:14, och Inställningar visar fortfarande 19:00 som första start.
  await addEntry(owner, { className: "Hyperion herr", givenName: "Sen", familyName: "Hyperion", club: "OK Ek", card: String(card++) });
  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Sen Hyperion/ }).first()).toContainText("19:14");
  await expect(owner.getByRole("row", { name: /L1 Superiondam/ }).first()).toContainText("19:00");
  await openStep(owner, "Inställningar");
  await expect(owner.getByRole("group", { name: "Information till löparna" }).getByText("19:00", { exact: true })).toBeVisible();
});
