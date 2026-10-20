import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, daysFromToday, openStep, publishRace, registerAccount, reviewScreenshots, sectionButton,
  sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * Steg 4–5 (ADR-0168): en hel träningskväll med tio syntetiska löpare.
 * Skapa → banor/klasser → åtta förhandsanmälda → avläsning med
 * övningsstationen, delvis utan nät och med omladdning offline → två okända
 * brickor direktanmäls → kvar i skogen → felstämplad godkänns → publikt
 * resultat → IOF-export. Steg 8.5: arbetsytan nås via checklistan och
 * tävlingsdagens kontrollvy. Steg 12: tävlingstypen Träning (banor och klasser
 * på samma ställe, deltagare, ingen start- eller lottningsdel). Steg 27: ta bort deltagare, klass och bana; brickans
 * stämplingar i avläsningen och på deltagarkortet, även en bricka med stämplingar från ett tidigare lopp.
 */
const RUNNERS = [
  { givenName: "Anna", familyName: "Ek", className: "H21", card: "8001001" },
  { givenName: "Bo", familyName: "Lind", className: "D21", card: "8001002" },
  { givenName: "Cecilia", familyName: "Holm", className: "H21", card: "8001003" },
  { givenName: "David", familyName: "Berg", className: "D21", card: "8001004" },
  { givenName: "Elsa", familyName: "Sjö", className: "H21", card: "8001005" },
  { givenName: "Filip", familyName: "Strand", className: "D21", card: "8001006" },
  { givenName: "Greta", familyName: "Ås", className: "H21", card: "8001007" },
  { givenName: "Hugo", familyName: "Mo", className: "D21", card: "8001008" }
] as const;

async function readExercise(page: Page, runner: typeof RUNNERS[number], button: string, verdict: string) {
  await page.getByLabel("Deltagare").selectOption({ label: `${runner.givenName} ${runner.familyName} · ${runner.className} · ${runner.card}` });
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByTestId("verdict")).toContainText(verdict);
  await expect(page.getByTestId("verdict")).toContainText(`${runner.givenName} ${runner.familyName}`);
}

test("träningskväll från tävling till IOF-export", async ({ browser, request }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kvall.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Träningskväll ${suffix}`, today(), "Träning");
  // Besökarna ska se tävlingen (ADR-0172 beslut 4).
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33 34");
  await addCourseAndClass(owner, "Kort", "D21", "31 33");
  for (const runner of RUNNERS) await addEntry(owner, { ...runner, club: "OK Test" });

  // PLAN.md steg 27: en felanmäld deltagare tas bort (har inte läst ut), en klass och en bana utan något på dem likaså.
  await addEntry(owner, { className: "D21", givenName: "Kalle", familyName: "Fel", club: "OK Test", card: "8001099" });
  await addCourseAndClass(owner, "Prov", "P10", "31 32");
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/entries/00000000-0000-4000-8000-000000000000/removal`, "POST");
  await openStep(owner, "Deltagare");
  const entryCard = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: /Kalle Fel/ }).getByRole("cell").nth(1).click();
    await expect(entryCard.getByRole("heading", { name: "Kalle Fel" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(entryCard.getByRole("region", { name: "Resultat", exact: true })).toContainText("Inte avläst ännu");
  await entryCard.getByRole("button", { name: "Ta bort deltagare" }).click();
  const entryRemoval = entryCard.getByTestId("removal-review");
  await expect(entryRemoval).toContainText("Kalle Fel tas bort ur tävlingen. Brickan och en lottad starttid blir lediga.");
  await reviewScreenshots(owner, "step27-delete-entry");
  await entryRemoval.getByRole("button", { name: "Ta bort", exact: true }).click();
  const roster = owner.getByRole("region", { name: "Deltagare", exact: true });
  await expect(roster.getByRole("status").filter({ hasText: "Kalle Fel är borttagen." })).toBeVisible();
  await expect(owner.getByRole("row", { name: /Kalle Fel/ })).toHaveCount(0);

  await openStep(owner, "Banor & klasser");
  const classes = owner.getByRole("region", { name: "Klasser" });
  await classes.getByRole("button", { name: "Ta bort klassen H21" }).click();
  await expect(classes.getByRole("alert")).toHaveText(/Klassen har 4 anmälda\. Flytta dem till en annan klass eller ta bort dem först\./);
  await classes.getByRole("button", { name: "Ta bort klassen P10" }).click();
  const classRemoval = classes.getByTestId("removal-review");
  await expect(classRemoval).toContainText("Klassen P10 tas bort.");
  await reviewScreenshots(owner, "step27-delete-class");
  await classRemoval.getByRole("button", { name: "Ta bort klass" }).click();
  await expect(classes.getByRole("status").filter({ hasText: "Klassen P10 är borttagen." })).toBeVisible();
  const courses = owner.getByRole("region", { name: "Banor", exact: true });
  await courses.getByRole("button", { name: "Ta bort banan Lång" }).click();
  await expect(courses.getByRole("alert")).toContainText("Banan används av H21. Byt bana på klassen först.");
  await courses.getByRole("button", { name: "Ta bort banan Prov" }).click();
  await courses.getByTestId("removal-review").getByRole("button", { name: "Ta bort bana" }).click();
  await expect(courses.getByRole("status").filter({ hasText: "Banan Prov är borttagen." })).toBeVisible();
  await expect(courses.getByRole("rowheader", { name: "Prov", exact: true })).toHaveCount(0);

  // Avläsning: öppnas via adminadressen och fungerar sedan utan nät.
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

  // Tre med nät.
  for (const runner of RUNNERS.slice(0, 3)) await readExercise(owner, runner, "Läs av: rätt stämplat", "GODKÄND");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar");
  await expect(owner.getByTestId("verdict").getByRole("list", { name: "Sträcktider" })).toContainText("31");

  // Nätet försvinner: två till, en av dem felstämplad, och en okänd bricka.
  await owner.context().setOffline(true);
  await expect(owner.getByTestId("internet-status")).toContainText("Ej ansluten");
  await readExercise(owner, RUNNERS[3], "Läs av: missad kontroll", "FELSTÄMPLAD");
  // Steg 27: beskedet visar brickans stämplingar i ordning med klockslag.
  await expect(owner.getByTestId("verdict-punches").getByRole("list", { name: "Brickans stämplingar i ordning" })).toContainText("31");
  await readExercise(owner, RUNNERS[4], "Läs av: rätt stämplat", "GODKÄND");
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("OKÄND BRICKA");
  await expect(owner.getByTestId("queue-status")).toHaveText("3 väntar");

  // Omladdning utan nät: sidan startar och kön finns kvar.
  await owner.reload();
  await expect(owner.getByTestId("queue-status")).toHaveText("3 väntar");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await readExercise(owner, RUNNERS[5], "Läs av: rätt stämplat", "GODKÄND");
  // Den andra okända brickan springer också H21:s bana.
  await owner.getByLabel("Deltagare").selectOption({ label: `${RUNNERS[4].givenName} ${RUNNERS[4].familyName} · H21 · ${RUNNERS[4].card}` });
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(owner.getByTestId("queue-status")).toHaveText("5 väntar");

  // Nätet tillbaka: kön töms.
  await owner.context().setOffline(false);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Råloggen för felsökning med riktig station: trafik och råramar, utan namn.
  const [rawLog] = await Promise.all([owner.waitForEvent("download"), owner.getByRole("button", { name: "Ladda ner felsökningslogg" }).click()]);
  const log = JSON.parse(await readFile(await rawLog.path(), "utf8")) as { traffic: unknown[]; readouts: { frames: string[] }[] };
  expect(log.readouts).toHaveLength(8);
  expect(log.readouts.every((readout) => readout.frames.length > 0)).toBe(true);
  expect(log.traffic.length).toBeGreaterThan(0);
  expect(JSON.stringify(log)).not.toContain("Ek");

  // Sidopanelen visar läget direkt: åtta avlästa, två kvar i skogen, två okända brickor och en felstämplad.
  await owner.goto(`/admin/${raceId}/manage`);
  await expect(sectionButton(owner, "Banor & klasser")).toHaveAccessibleDescription(/2 banor · 2 klasser/);
  await expect(sectionButton(owner, "Deltagare")).toHaveAccessibleDescription(/8 deltagare/);
  await expect(sectionButton(owner, "Start")).toHaveCount(0);
  await expect(sectionButton(owner, "Avläsning")).toHaveAccessibleDescription(/2 okända brickor/);
  await expect(sectionButton(owner, "Resultat")).toHaveAccessibleDescription(/1 felstämplad att titta på/);

  // Tävlingsdagens kontrollvy: de två okända brickorna direktanmäls direkt i vyn.
  await openStep(owner, "Avläsning");
  const control = owner.getByRole("region", { name: "Tävlingsdagens kontrollvy" });
  await expect(control.getByRole("link", { name: "Öppna avläsningen" })).toHaveAttribute("href", `/admin/${raceId}/readout`);
  await expect(control.getByRole("region", { name: /Senaste avläsningar/ })).toContainText("Strand");
  const unknownCards = control.getByRole("region", { name: /Okända brickor/ });
  await expect(unknownCards.getByRole("heading")).toContainText("2");
  for (const [givenName, familyName] of [["Ida", "Direkt"], ["Jonas", "Direkt"]]) {
    await expect(unknownCards.getByLabel("Koppla till")).toBeVisible();
    await unknownCards.getByLabel("Koppla till").selectOption("NEW_ENTRY");
    const classSelect = unknownCards.getByLabel("Klass för ny deltagare");
    await classSelect.selectOption(await classSelect.locator("option", { hasText: "H21" }).getAttribute("value"));
    await unknownCards.getByLabel("Förnamn").fill(givenName!);
    await unknownCards.getByLabel("Efternamn").fill(familyName!);
    await unknownCards.getByRole("button", { name: "Granska koppling" }).click();
    await unknownCards.getByRole("button", { name: "Bekräfta koppling och bedömning" }).click();
    await expect(unknownCards.getByRole("button", { name: "Bekräfta koppling och bedömning" })).toBeHidden();
  }
  await expect(unknownCards).toContainText("Det finns inga olösta okända avläsningar");

  // Kvar i skogen: Greta och Hugo har inte lästs av.
  await control.getByRole("button", { name: "Uppdatera" }).click();
  await expect(owner.getByTestId("in-forest-count")).toHaveText("2");
  const forest = control.getByRole("region", { name: /Kvar i skogen/ });
  await expect(forest).toContainText("Greta Ås");
  await expect(forest).toContainText("Hugo Mo");
  await expect(sectionButton(owner, "Avläsning")).toHaveAccessibleDescription(/2 kvar/);

  // Rättning: David missade en kontroll. "Öppna" i kontrollvyn visar hans deltagarkort; godkänns manuellt med
  // ett val i "Ändra status" och en bekräftelse (ingen manuell omräkning, ADR-0169).
  const mispunched = control.getByRole("region", { name: /Felstämplade att titta på/ });
  await mispunched.getByRole("button", { name: "Öppna David Berg" }).click();
  await expect(sectionButton(owner, "Deltagare")).toHaveAttribute("aria-current", "step");
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(card.getByRole("heading", { name: "David Berg" })).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  // Steg 27: alla stämplingar från avläsningen, med den saknade kontrollen i ord.
  const davidPunches = card.getByTestId("card-punches");
  await expect(davidPunches).toContainText("Brickans stämplingar");
  await expect(davidPunches.getByRole("note")).toContainText("Saknade kontroller: 33.");
  await expect(davidPunches.getByRole("row", { name: /^1 31 / })).toContainText("på banan");
  await card.getByLabel("Ändra status").selectOption({ label: "Godkänn manuellt" });
  // Steg 31: godkännandet kräver orsak.
  await card.getByLabel("Orsak (krävs)").fill("Stationen registrerade inte");
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(owner.getByText("Godkännandet är sparat.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");
  await expect(sectionButton(owner, "Resultat")).not.toHaveAccessibleDescription(/felstämplad/);

  // Publikt resultat utan inloggning.
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    return ["Ek", "Lind", "Holm", "Berg", "Sjö", "Strand", "Ida", "Jonas"].every((name) => html.includes(name)) &&
      html.includes("Godkänd manuellt av arrangör") && !html.includes("Felstämplad") && !html.includes("Greta");
  }, { timeout: 30_000 }).toBe(true);

  // IOF XML-export av resultatlistan.
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/result-export`);
  // Resultatsteget läser resultatlistan och kartan; första kompileringen i dev-servern kan ta längre än väntetiden.
  for (const list of ["results", "relay-results", "radio"]) await warmRoute(owner, `/api/public/races/${raceId}/${list}`);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/map`);
  await openStep(owner, "Resultat");
  const toolbar = owner.getByRole("toolbar", { name: "Listans verktyg" });
  await expect(owner.getByRole("table", { name: "H21" })).toBeVisible();
  // Ingen karta uppladdad: ett vanligt tomt läge i Karta och vägval, inget felbesked.
  const mapSection = owner.getByRole("region", { name: "Karta och vägval" });
  await expect(mapSection.getByText(/^Ingen karta uppladdad än/)).toBeVisible();
  await expect(mapSection.getByRole("alert")).toHaveCount(0);
  await toolbar.getByText("Exportera").click();
  const [download] = await Promise.all([
    owner.waitForEvent("download"),
    toolbar.getByRole("button", { name: "IOF XML" }).click()
  ]);
  const xml = await readFile(await download.path(), "utf8");
  expect(xml).toContain("<ResultList");
  for (const name of ["Ek", "Berg", "Direkt"]) expect(xml).toContain(`<Family>${name}</Family>`);
  expect(xml).not.toContain("<Family>Mo</Family>");

  // Steg 27 (piloten): en bricka som inte tömts, med stämplingar från ett lopp i förra veckan och utan startstämpling.
  // Deltagarkortet visar alla stämplingar, märkta "utanför tävlingsdagen", och förklarar varför.
  await addEntry(owner, { className: "H21", givenName: "Olle", familyName: "Gammal", club: "OK Test", card: "8001010" });
  const old = daysFromToday(-5);
  await sendReadout(owner, raceId, { cardNumber: "8001010", checkPunchedAt: `${old}T15:55:00.000Z`, finishPunchedAt: `${old}T16:50:00.000Z`,
    punches: [{ code: 114, punchedAt: `${old}T16:05:00.000Z` }, { code: 81, punchedAt: `${old}T16:12:00.000Z` },
      { code: 31, punchedAt: `${old}T16:20:00.000Z` }, { code: 100, punchedAt: `${old}T16:41:00.000Z` }] });
  await owner.reload();
  await openStep(owner, "Deltagare");
  await expect(async () => {
    await owner.getByRole("row", { name: /Olle Gammal/ }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name: "Olle Gammal" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  const oldPunches = card.getByTestId("card-punches");
  await expect(oldPunches.getByRole("note")).toContainText(/^Stämplingarna är från \S+ \d+ \S+, inte från tävlingsdagen \(\S+ \d+ \S+\)\./);
  await expect(oldPunches.getByRole("note")).toContainText("Brickan har ingen startstämpling.");
  await expect(oldPunches.getByRole("row", { name: /^1 114 / })).toContainText("utanför tävlingsdagen");
  await expect(oldPunches.getByRole("row")).toHaveCount(5);
  await expect(oldPunches.getByRole("term").filter({ hasText: "Start" }).locator("xpath=following-sibling::dd")).toHaveText("saknas");
  await card.getByTestId("card-punches").scrollIntoViewIfNeeded();
  await reviewScreenshots(owner, "step27-participant-old-punches");
  // Stryk: Olle har läst ut, så han stryks i stället för att tas bort och försvinner ur listorna.
  await card.getByRole("button", { name: "Stryk" }).click();
  await card.getByTestId("removal-review").getByRole("button", { name: "Stryk deltagaren" }).click();
  await expect(owner.getByRole("region", { name: "Deltagare", exact: true }).getByRole("status")
    .filter({ hasText: "Olle Gammal är struken." })).toBeVisible();
  await expect(owner.getByRole("row", { name: /Olle Gammal/ })).toHaveCount(0);
});
