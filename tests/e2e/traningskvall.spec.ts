import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, sectionButton, unique, warmRoute } from "./helpers";

/**
 * Steg 4–5 (ADR-0168): en hel träningskväll med tio syntetiska löpare.
 * Skapa → banor/klasser → åtta förhandsanmälda → avläsning med
 * övningsstationen, delvis utan nät och med omladdning offline → två okända
 * brickor direktanmäls → kvar i skogen → felstämplad godkänns → publikt
 * resultat → IOF-export. Steg 8.5: arbetsytan nås via checklistan och
 * tävlingsdagens kontrollvy. Steg 12: tävlingstypen Träning (banor och klasser
 * på samma ställe, deltagare, ingen start- eller lottningsdel).
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
  const raceId = await createRace(owner, `Träningskväll ${suffix}`, "2026-10-08", "Träning");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33 34");
  await addCourseAndClass(owner, "Kort", "D21", "31 33");
  for (const runner of RUNNERS) await addEntry(owner, { ...runner, club: "OK Test" });

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
  const [rawLog] = await Promise.all([owner.waitForEvent("download"), owner.getByRole("button", { name: "Ladda ner rålogg" }).click()]);
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
  await card.getByLabel("Ändra status").selectOption({ label: "Godkänn manuellt" });
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
  await openStep(owner, "Resultat");
  const toolbar = owner.getByRole("toolbar", { name: "Listans verktyg" });
  await expect(owner.getByRole("table", { name: "H21" })).toBeVisible();
  await toolbar.getByText("Exportera").click();
  const [download] = await Promise.all([
    owner.waitForEvent("download"),
    toolbar.getByRole("button", { name: "IOF XML" }).click()
  ]);
  const xml = await readFile(await download.path(), "utf8");
  expect(xml).toContain("<ResultList");
  for (const name of ["Ek", "Berg", "Direkt"]) expect(xml).toContain(`<Family>${name}</Family>`);
  expect(xml).not.toContain("<Family>Mo</Family>");
});
