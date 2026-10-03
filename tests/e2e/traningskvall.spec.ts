import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, registerAccount, unique } from "./helpers";

/**
 * Steg 4–5 (ADR-0168): en hel träningskväll med tio syntetiska löpare.
 * Skapa → banor/klasser → åtta förhandsanmälda → avläsning med
 * övningsstationen, delvis utan nät och med omladdning offline → två okända
 * brickor direktanmäls → kvar i skogen → felstämplad godkänns → publikt
 * resultat → IOF-export.
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
  const owner = await registerAccount(browser, `kvall.${suffix}`, "Kim Klubb");
  const raceId = await createRace(owner, `Träningskväll ${suffix}`);
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

  // De två okända brickorna direktanmäls i Hantera tävling.
  await owner.goto(`/admin/${raceId}/manage`);
  await owner.getByRole("button", { name: "Under tävlingen", exact: true }).first().click();
  await owner.getByText("Lös okänd brickavläsning").click();
  for (const [givenName, familyName] of [["Ida", "Direkt"], ["Jonas", "Direkt"]]) {
    await expect(owner.getByLabel("Koppla till")).toBeVisible();
    await owner.getByLabel("Koppla till").selectOption("NEW_ENTRY");
    const classSelect = owner.getByLabel("Klass för ny deltagare");
    await classSelect.selectOption(await classSelect.locator("option", { hasText: "H21" }).getAttribute("value"));
    const panel = owner.locator(`#unknown-readout-${raceId}`);
    await panel.getByLabel("Förnamn").fill(givenName!);
    await panel.getByLabel("Efternamn").fill(familyName!);
    await owner.getByRole("button", { name: "Granska koppling" }).click();
    await owner.getByRole("button", { name: "Bekräfta koppling och bedömning" }).click();
    await expect(owner.getByRole("button", { name: "Bekräfta koppling och bedömning" })).toBeHidden();
    const load = owner.getByRole("button", { name: "Hämta okända avläsningar" });
    if (await load.isVisible()) await load.click();
  }

  // Kvar i skogen: Greta och Hugo har inte lästs av.
  await owner.getByRole("button", { name: "Uppdatera avvikelser" }).click();
  await expect(owner.getByTestId("in-forest-count")).toContainText("2");

  // Rättning: David missade en kontroll men godkänns manuellt.
  await owner.getByRole("button", { name: "Deltagare", exact: true }).first().click();
  await owner.getByRole("button", { name: /David Berg/ }).first().click();
  await owner.getByText("Resultatbeslut och historik").click();
  // Direktanmälningarna gav en ny tävlingsversion, så resultatet räknas om först.
  await owner.getByRole("button", { name: "Omräkning", exact: true }).click();
  await owner.getByRole("button", { name: "Granska omräkning" }).click();
  await owner.getByRole("button", { name: "Bekräfta omräkning" }).click();
  await expect(owner.getByText("Omräkningen är sparad.")).toBeVisible();
  await owner.getByRole("button", { name: "Manuellt godkännande" }).click();
  await owner.getByRole("button", { name: "Uppdatera godkännandeunderlag" }).click();
  await owner.getByRole("button", { name: "Granska godkännande" }).click();
  await owner.getByRole("button", { name: "Bekräfta godkännande" }).click();
  await expect(owner.getByText("Godkännandet är sparat.")).toBeVisible();

  // Publikt resultat utan inloggning.
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    return ["Ek", "Lind", "Holm", "Berg", "Sjö", "Strand", "Ida", "Jonas"].every((name) => html.includes(name)) &&
      html.includes("Godkänd manuellt av arrangör") && !html.includes("Felstämplad") && !html.includes("Greta");
  }, { timeout: 30_000 }).toBe(true);

  // IOF XML-export av resultatlistan.
  await owner.getByRole("button", { name: "Efter tävlingen", exact: true }).first().click();
  await owner.getByText("Resultatexport · IOF 3.0").click();
  const [download] = await Promise.all([
    owner.waitForEvent("download"),
    owner.getByRole("button", { name: "Ladda ner aktuell IOF-resultatlista" }).click()
  ]);
  const xml = await readFile(await download.path(), "utf8");
  expect(xml).toContain("<ResultList");
  for (const name of ["Ek", "Berg", "Direkt"]) expect(xml).toContain(`<Family>${name}</Family>`);
  expect(xml).not.toContain("<Family>Mo</Family>");
});
