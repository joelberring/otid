import { expect, test, type Browser, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, expectSaved, ongoingRaceTimeZone, openStep, publishRace, raceStartedAgo, readExercise,
  registerAccount, unique, warmRoute } from "./helpers";

/**
 * Användartestet 2026-11-12: ägarens skarpa tävling (Stockholm by Night, 9 december) från början till slut. En bana med två
 * gafflingar byggs i Gaffla banan (31 40 [41|42] 50 60 [61 62|63|64] 70 100, sex varianter) som fulgaffling, tolv anmälda
 * får varsin variant jämnt fördelad och klassen lottas med masstart.
 *
 * Testet är delat i två, så att det är stabilt oavsett klockslag (ongoingRaceTimeZone, raceStartedAgo):
 * - "före start": masstarten ligger 30 minuter fram. Den publika startlistan har inga varianter, speakern säger "Inte startat"
 *   och en strykning och en efteranmälan ändrar ingen annans variant; den efteranmälda får masstartens tid.
 * - "tävlingskvällen": masstarten var för 40 minuter sedan. Avläsning (godkänd och felstämplad), en rättad kod i ett
 *   alternativ (64 → 65), okänd bricka med förslag, direktanmälan och koppling till en löpare med resultat, avläsning utan nät
 *   med omladdning, och speakerns "Senast i mål" som inte flyttas av omräkningen.
 */
const CLASS = "Natt lång";
const COURSE = "Natt";
const VARIANTS = ["AC", "AD", "AE", "BC", "BD", "BE"] as const;
const GIVEN = ["Ada", "Bo", "Cia", "Dan", "Eva", "Fia", "Gun", "Hans", "Ida", "Jon", "Kim", "Lo"] as const;
const runnerName = (given: string) => `${given} Natt`;

/** Ägarens upplägg fram till lottningen: bana, gaffling som fulgaffling, tolv anmälda och lottning med masstart. */
async function nightRace(browser: Browser, label: string, minutesAgo: number) {
  const timeZone = ongoingRaceTimeZone();
  const massStart = raceStartedAgo(minutesAgo, timeZone);
  const clock = massStart.clock(0);
  const suffix = unique();
  const owner = await registerAccount(browser, `natt.${label}.${suffix}@exempel.se`, "Nora Natt");
  const raceId = await createRace(owner, `Stockholm by Night ${suffix}`, massStart.date, "Tävling", timeZone);
  await publishRace(owner);
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmRoute(owner, `${admin}/courses`);
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit-preview`, "POST");
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit`, "POST");
  await addCourseAndClass(owner, COURSE, CLASS, "31 40 50 60 70 100");

  // 1. Gaffla banan: valet av gafflingssätt finns innan första sparandet och varningen följer valet direkt.
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: `Gaffla banan ${COURSE}` }).click();
  const editor = owner.getByRole("form", { name: `Gafflingar på ${COURSE}` });
  await expect(editor.getByTestId("forking-edit-mode")).toHaveValue("BALANCED");
  await editor.getByRole("button", { name: "Sträckan 40–50" }).click();
  await editor.getByRole("button", { name: "Lägg till gaffling på 40–50" }).click();
  await editor.getByRole("textbox", { name: "Alternativ A" }).fill("41");
  await editor.getByRole("textbox", { name: "Alternativ B" }).fill("42");
  await editor.getByRole("button", { name: "Sträckan 60–70" }).click();
  await editor.getByRole("button", { name: "Lägg till gaffling på 60–70" }).click();
  await editor.getByRole("textbox", { name: "Alternativ C" }).fill("61 62");
  await editor.getByRole("textbox", { name: "Alternativ D" }).fill("63");
  await editor.getByRole("group", { name: "Gaffling 2 (C, D)" }).getByRole("button", { name: "Lägg till alternativ" }).click();
  await editor.getByRole("textbox", { name: "Alternativ E" }).fill("64");
  const generated = editor.getByRole("region", { name: "Varianterna som banan ger" });
  await expect(generated).toContainText("6 varianter");
  await expect(generated).toContainText("AC 31 40 41 50 60 61 62 70 100");
  await expect(generated).toContainText("BE 31 40 42 50 60 64 70 100");
  await expect(generated).toContainText("Varianterna har inte samma sträckor");
  await editor.getByTestId("forking-edit-mode").selectOption("UNEQUAL");
  await expect(generated).not.toContainText("Varianterna har inte samma sträckor");
  await expect(generated).toContainText("alternativen är inte utjämnade");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible({ timeout: 30_000 });
  const course = owner.getByRole("row", { name: new RegExp(`^${COURSE} .*Gafflad`) });
  await expect(course).toContainText("Gafflad (6 varianter)");
  await expect(course.getByLabel("Gafflingssätt")).toHaveValue("UNEQUAL");
  await expect(course).not.toContainText("Varianterna har inte samma sträckor");
  // Inga anmälda än: inget "Klar för start" och inga varianter som "används inte".
  await expect(course.getByTestId("forking-readiness")).toHaveText("Inga anmälda än. Banan har 6 varianter.");

  // 2. Tolv anmälda får varsin variant, två per variant.
  for (const [index, given] of GIVEN.entries()) {
    await addEntry(owner, { className: CLASS, givenName: given, familyName: "Natt", club: "OK Natt", card: String(8_610_001 + index) });
  }
  await openStep(owner, "Banor");
  await expect(owner.getByRole("row", { name: new RegExp(`^${COURSE} .*Gafflad`) }).getByTestId("forking-readiness"))
    .toHaveText("Klar för start: alla 6 varianter har löpare och fördelningen är jämn.");

  // Lottning med masstart: alla i klassen startar samtidigt.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: new RegExp(CLASS) })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill(clock);
  await draw.getByLabel(`Startsätt ${CLASS}`).selectOption({ label: "Masstart" });
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  const preview = owner.getByRole("region", { name: "Så blir startlistan" });
  await expect(preview).toContainText("Masstart");
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();
  await owner.getByRole("button", { name: "Publicera startlistan" }).click();
  await expect(owner.getByText("Startlistan är publicerad.")).toBeVisible();
  const variants = await startListVariants(owner, GIVEN.map(runnerName), clock);
  for (const code of VARIANTS) expect([...variants.values()].filter(value => value === code), `variant ${code}`).toHaveLength(2);
  return { owner, raceId, clock, variants };
}

/** Varianten per löpare i arbetsytans startlista (Start), och att alla har masstartens tid. */
async function startListVariants(owner: Page, names: readonly string[], clock: string): Promise<Map<string, string>> {
  await openStep(owner, "Start");
  const list = owner.locator("section:not([hidden]) > [data-list]").getByRole("region", { name: CLASS, exact: true });
  const out = new Map<string, string>();
  for (const name of names) {
    const row = list.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText(clock);
    const cells = await row.getByRole("cell").allTextContents();
    const code = cells.map(cell => cell.trim()).find(cell => /^[AB][CDE]$/.test(cell));
    expect(code, `variant för ${name}`).toBeDefined();
    out.set(name, code!);
  }
  return out;
}

/** Avläsningssidan med övningsstationen, med tjänstearbetaren igång (för omladdning utan nät). */
async function openReadout(owner: Page, raceId: string) {
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
}

const exerciseLabel = (given: string) => `${runnerName(given)} · ${CLASS} · ${8_610_001 + GIVEN.indexOf(given as typeof GIVEN[number])}`;

/** Speakerns "Senast i mål": namnen uppifrån (senast först). */
async function latestFinishers(owner: Page, raceId: string, count: number): Promise<string[]> {
  await owner.goto(`/admin/${raceId}/speaker`);
  const latest = owner.getByRole("region", { name: "Senast i mål" });
  await expect(latest.getByRole("row")).toHaveCount(count, { timeout: 30_000 });
  return (await latest.getByRole("row").allTextContents()).map(text => text.replace(/\s+/g, " "));
}

test("natt med gaffling och masstart, före start: publik startlista utan varianter, strykning och efteranmälan", async ({ browser }) => {
  test.setTimeout(420_000);
  const { owner, raceId, clock, variants } = await nightRace(browser, "fore", -30);

  // Den publika startlistan före masstarten: namn och tid, men ingen variant.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/starts/${raceId}`);
  await expect(visitor.getByText(runnerName("Ada"))).toBeVisible();
  await expect(visitor.getByRole("cell", { name: clock, exact: true }).first()).toBeVisible();
  await expect(visitor.getByTestId("public-variants-hidden")).toBeVisible();
  await expect(visitor.getByRole("cell", { name: /^[AB][CDE]$/ })).toHaveCount(0);
  await visitor.close();

  // 3. Lo stryks och Max efteranmäls: de andras varianter är oförändrade, Max får masstartens tid och Los lediga variant.
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/entries/00000000-0000-4000-8000-000000000000/removal`, "POST");
  await openStep(owner, "Anmälda");
  const entryCard = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: /Lo Natt/ }).getByRole("cell").nth(1).click();
    await expect(entryCard.getByRole("heading", { name: "Lo Natt" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await entryCard.getByRole("button", { name: "Ta bort deltagare" }).click();
  await entryCard.getByTestId("removal-review").getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect(owner.getByText("Lo Natt är borttagen.")).toBeVisible();
  await addEntry(owner, { className: CLASS, givenName: "Max", familyName: "Natt", club: "OK Natt", card: "8610099" });
  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Max Natt/ }).first()).toContainText(clock);
  const kept = GIVEN.filter(given => given !== "Lo").map(runnerName);
  const after = await startListVariants(owner, [...kept, "Max Natt"], clock);
  for (const name of kept) expect(after.get(name), name).toBe(variants.get(name));
  expect(after.get("Max Natt")).toBe(variants.get("Lo Natt"));

  // 8. Speakern före masstarten: ingen kvar i skogen, alla "Inte startat".
  await owner.goto(`/admin/${raceId}/speaker`);
  await expect(owner.getByTestId("speaker-awaiting-start")).toHaveText("Inte startat: 12", { timeout: 30_000 });
  await expect(owner.getByRole("region", { name: "Kvar i skogen" })).toContainText("Ingen är kvar i skogen.");
  await expect(owner.getByRole("region", { name: "Senast i mål" })).toContainText("Ingen har gått i mål ännu.");
});

test("natt med gaffling och masstart, tävlingskvällen: avläsning, rättad kod, okänd bricka, utan nät och speakern", async ({ browser }) => {
  test.setTimeout(480_000);
  const { owner, raceId, clock, variants } = await nightRace(browser, "kvall", 40);
  const withVariant = (wanted: RegExp, except: readonly string[] = []) =>
    GIVEN.find(given => wanted.test(variants.get(runnerName(given))!) && !except.includes(given))!;
  // Den godkända springer ett alternativ med 64 (rättas i steg 5); den felstämplade inte.
  const ok = withVariant(/E$/), mispunched = withVariant(/C$/);

  // 4. Avläsning med övningsstationen: en godkänd, en felstämplad.
  await openReadout(owner, raceId);
  await readExercise(owner, exerciseLabel(ok));
  await expect(owner.getByTestId("verdict-variant")).toHaveText(`Variant ${variants.get(runnerName(ok))}`);
  await readExercise(owner, exerciseLabel(mispunched), { button: "Läs av: missad kontroll" });
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // 5. Kontroll 64 i alternativ E rättas till 65: alla behåller sin variantkod och beskedet säger vilka varianter som ändras.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: `Redigera gafflingar på ${COURSE}` }).click();
  const editor = owner.getByRole("form", { name: `Gafflingar på ${COURSE}` });
  await expect(editor.getByTestId("forking-edit-mode")).toHaveValue("UNEQUAL");
  await editor.getByRole("textbox", { name: "Alternativ E" }).fill("65");
  await editor.getByRole("button", { name: "Visa vad som händer" }).click();
  await expect(editor.getByTestId("forking-changed")).toContainText("Varianterna AE, BE får ändrade kontroller. Löparna behåller sin kod");
  await expect(editor).toContainText(`${runnerName(ok)} · ${CLASS} · Godkänd → Felstämplad`);
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  // Båda avlästa räknas om mot banans nya version; bara den godkända byter status (beskedet ovan).
  await expect(owner.getByText("Gafflingarna är sparade. 2 resultat räknades om.")).toBeVisible({ timeout: 30_000 });
  const corrected = await startListVariants(owner, GIVEN.map(runnerName), clock);
  for (const [name, code] of variants) expect(corrected.get(name), name).toBe(code);

  // 8. Speakern: omräkningen flyttar inte den godkända (nu felstämplad) upp i "Senast i mål".
  const latest = await latestFinishers(owner, raceId, 2);
  expect(latest[0]).toContain(runnerName(mispunched));
  expect(latest[1]).toContain(runnerName(ok));
  expect(latest[1]).toContain("Felstämplad");

  // 6. Okänd bricka på en löpares variant: förslaget säger varianten och visar rätt löpare först.
  // Brickan stämplas på BD; den av BD-löparna som står först i bokstavsordning ska stå först i förslaget.
  const unknownFor = GIVEN.filter(given => variants.get(runnerName(given)) === "BD")
    .sort((left, right) => runnerName(left).localeCompare(runnerName(right), "sv"))[0]!;
  await openReadout(owner, raceId);
  await owner.getByLabel("Deltagare").selectOption({ label: exerciseLabel(unknownFor) });
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("OKÄND BRICKA");
  const form = owner.getByTestId("register-form");
  await expect(form.getByTestId("register-class-fit")).toContainText(`${CLASS} (${COURSE}), variant BD`);
  const first = form.getByTestId("register-entries").getByRole("listitem").first();
  await expect(first).toContainText(`Koppla brickan till ${runnerName(unknownFor)}`);
  await expect(first.getByTestId("register-entry-variant")).toHaveAttribute("data-same", "yes");
  await expect(first.getByTestId("register-entry-variant")).toContainText("tilldelad BD");

  // Direktanmälan: den nya löparen får masstartens tid och blir godkänd mot den.
  const classOption = await form.getByLabel("Klass").locator("option", { hasText: CLASS }).getAttribute("value");
  await form.getByLabel("Klass").selectOption(classOption ?? "");
  await form.getByLabel("Förnamn").fill("Ny");
  await form.getByLabel("Efternamn").fill("Nattlöpare");
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(owner.getByTestId("registration-status")).toHaveText(`Ny Nattlöpare är anmäld i ${CLASS}.`, { timeout: 30_000 });
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("verdict")).toContainText("Ny Nattlöpare");

  // En okänd bricka till, på den godkändas bana (kopplas i kontrollvyn nedan).
  await owner.getByLabel("Deltagare").selectOption({ label: exerciseLabel(ok) });
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("OKÄND BRICKA");
  await expectSaved(owner);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // 7. Utan nät: en avläsning, omladdning, nätet tillbaka och kön töms.
  const offline = withVariant(/./, [ok, mispunched, unknownFor]);
  await owner.context().setOffline(true);
  await expect(owner.getByTestId("internet-status")).toContainText("Ej ansluten");
  await readExercise(owner, exerciseLabel(offline), { saved: false });
  await expect(owner.getByTestId("queue-status")).toHaveText("1 väntar");
  await owner.reload();
  await expect(owner.getByTestId("queue-status")).toHaveText("1 väntar");
  await owner.context().setOffline(false);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Direktanmälan i arbetsytan: masstartens tid.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Ny Nattlöpare/ }).first()).toContainText(clock);

  // 6. Kopplingen till en löpare med resultat kräver medgivande.
  await openStep(owner, "Avläsning");
  const unknownCards = owner.getByRole("region", { name: "Tävlingsdagens kontrollvy" }).getByRole("region", { name: /Okända brickor/ });
  await expect(unknownCards.getByRole("heading")).toContainText("1", { timeout: 30_000 });
  await unknownCards.getByLabel("Koppla till").selectOption("EXISTING_ENTRY");
  const entry = unknownCards.locator("label", { hasText: /^Deltagare/ }).locator("select");
  await entry.selectOption(await entry.locator("option", { hasText: `Natt, ${ok} ·` }).getAttribute("value"));
  await unknownCards.getByRole("button", { name: "Granska koppling" }).click();
  await expect(unknownCards.getByTestId("unknown-link-replaces")).toBeVisible();
  const replace = unknownCards.getByRole("button", { name: "Ersätt resultatet och koppla" });
  await expect(replace).toBeDisabled();
  await unknownCards.getByLabel("Ja, ersätt resultatet med den här avläsningen").check();
  await replace.click();
  await expect(unknownCards).toContainText("Det finns inga olösta okända avläsningar", { timeout: 30_000 });

  // 8. Speakern: ankomstordningen står kvar, också efter omräkningen och kopplingen.
  const final = await latestFinishers(owner, raceId, 4);
  expect(final[0]).toContain(runnerName(offline));
  expect(final[1]).toContain("Ny Nattlöpare");
  expect(final[2]).toContain(runnerName(mispunched));
  expect(final[3]).toContain(runnerName(ok));
});
