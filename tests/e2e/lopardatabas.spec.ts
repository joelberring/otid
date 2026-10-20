import { expect, test, type Page } from "@playwright/test";
import { FAKE_EVENTOR_API_KEY } from "./fake-eventor";
import { addCourseAndClass, addEntry, createRace, openEntryForm, openStep, registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 29: löpardatabas från Eventor. Klubbens löpare hämtas från den falska Eventor (påhittade löpare i Eventors
 * struktur). Ny deltagare föreslår Testa Testsson med bricka. På avläsningssidan, utan nät, läses Prova Provssons bricka:
 * namn och klubb fylls i ur databasen och H21 (Lång) förväljs eftersom banan passar. En okänd bricka på Långs kontroller
 * föreslår Anna Ek (anmäld utan bricka) och kopplas till henne; båda skickas när nätet är tillbaka.
 */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
}

async function shots(page: Page, name: string) {
  await reviewScreenshots(page, `step29-${name}`);
}

test("löpardatabas: hämta från Eventor, förslag i Ny deltagare och okänd bricka utan nät", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg29.${suffix}@exempel.se`, "Lisa Löpardatabas");
  const raceId = await createRace(owner, `Klubbkväll ${suffix}`, today(), "Tävling");
  const api = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["eventor", "runner-database", "readout-package"]) await warmRoute(owner, `${api}/${path}`);
  for (const path of ["eventor/test", "runner-database", "runner-database/search", "registration", "registration-candidates",
    "readout-registrations", "readouts"]) await warmRoute(owner, `${api}/${path}`, "POST");

  // Banor: H21 på Lång (31 32 33) och D10 på Kort (31 32). Anna är anmäld utan bricka, Bo med.
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addCourseAndClass(owner, "Kort", "D10", "31 32");
  await addEntry(owner, { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Skogsfalken", card: "" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Berg", club: "OK Skogsfalken", card: "8250001" });

  // Inställningar → Eventor: nyckeln och löpardatabasen.
  await openStep(owner, "Inställningar");
  const eventor = owner.getByRole("region", { name: "Eventor" });
  await eventor.getByLabel("Klubbens API-nyckel").fill(FAKE_EVENTOR_API_KEY);
  await eventor.getByRole("button", { name: "Spara nyckel" }).click();
  await expect(eventor.getByText("Ansluten som OK Skogsfalken")).toBeVisible();
  const runners = eventor.getByRole("region", { name: "Löpardatabasen" });
  // Löpardatabasen delas per klubb: ett omförsök kan redan ha en (den raderas i slutet av testet).
  await runners.getByRole("button", { name: "Uppdatera löpardatabasen från Eventor" }).click();
  await expect(runners.getByRole("status")).toContainText("Löpardatabasen är uppdaterad.");
  await expect(runners.getByTestId("runner-database-summary")).toContainText("5 löpare · 5 brickor · 6 klubbar");
  await expect(runners.getByTestId("runner-database-summary")).toContainText("Utan nät i avläsningen: 3 löpare från OK Skogsfalken.");
  await expect(runners.getByLabel("Ta med hela Sverige (stor hämtning)")).not.toBeChecked();
  await runners.scrollIntoViewIfNeeded();
  await shots(owner, "runner-database-settings");

  // Ny deltagare: förnamnet föreslår Testa Testsson; valet fyller i namn, klubb och bricka.
  await openStep(owner, "Anmälda");
  const entryForm = await openEntryForm(owner);
  await entryForm.getByRole("combobox", { name: "Klass" }).selectOption({ label: "D10" });
  await entryForm.getByLabel("Förnamn").fill("Tes");
  const suggestion = entryForm.getByRole("button", { name: "Välj Testa Testsson · OK Skogsfalken · 1975 · bricka 8100101" });
  await expect(suggestion).toBeVisible();
  await shots(owner, "new-participant");
  await suggestion.click();
  await expect(entryForm.getByRole("textbox", { name: "Efternamn" })).toHaveValue("Testsson");
  await expect(entryForm.getByLabel("Klubb")).toHaveValue("OK Skogsfalken");
  await expect(entryForm.getByLabel("Bricka (valfritt)")).toHaveValue("8100101");
  await entryForm.getByRole("button", { name: "Lägg till", exact: true }).click();
  await expect(entryForm.getByRole("status")).toContainText("Testa Testsson är anmäld i D10");

  // Avläsningen: paketet med löpardatabasen hämtas med nät, sedan försvinner nätet.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await waitForServiceWorker(owner);
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
  await owner.context().setOffline(true);
  await expect(owner.getByTestId("internet-status")).toContainText("Ej ansluten");
  const verdict = owner.getByTestId("verdict");

  // Prova Provssons bricka (8100102 finns i löpardatabasen, inte anmäld) på Långs kontroller.
  await owner.getByLabel("Deltagare").selectOption({ label: "Bo Berg · H21 · 8250001" });
  await owner.getByRole("button", { name: "Läs av: bricka ur löpardatabasen" }).click();
  await expect(verdict).toContainText("OKÄND BRICKA");
  const form = owner.getByTestId("register-form");
  await expect(form.getByTestId("register-runner")).toHaveText("Bricka 8100102 finns i löpardatabasen: Prova Provsson, OK Skogsfalken");
  await expect(form.getByTestId("register-class-fit")).toHaveText("✓ Passar H21 (Lång) och D10 (Kort) – alla kontroller stämplade");
  await expect(form.getByLabel("Klass")).toHaveValue(await form.getByRole("option", { name: "H21 – passar" }).getAttribute("value") ?? "");
  await expect(form.getByLabel("Förnamn")).toHaveValue("Prova");
  await expect(form.getByLabel("Efternamn")).toHaveValue("Provsson");
  await expect(form.getByLabel("Klubb (valfritt)")).toHaveValue("OK Skogsfalken");
  // Anna (utan bricka) och Bo (bricka men inte avläst) i de passande klasserna föreslås överst; Testa i D10 också.
  const entries = form.getByTestId("register-entries");
  await expect(entries.getByRole("button")).toHaveText(["Koppla brickan till Anna Ek", "Koppla brickan till Bo Berg",
    "Koppla brickan till Testa Testsson"]);
  await shots(owner, "unknown-card-prefill");
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(verdict).toContainText("GODKÄND");
  await expect(verdict).toContainText("Prova Provsson");
  await expect(verdict.getByTestId("registration-status")).toHaveText("Prova Provsson är anmäld i H21 här. Skickas när nätet finns.");

  // En okänd bricka på Långs kontroller: Anna Ek föreslås överst och kopplas.
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(verdict).toContainText("OKÄND BRICKA");
  await expect(form.getByTestId("register-runner")).toHaveCount(0);
  const annaLink = form.getByRole("button", { name: "Koppla brickan till Anna Ek" });
  await expect(annaLink).toBeVisible();
  await expect(form.getByTestId("register-entries")).toContainText("(H21, ingen bricka angiven)");
  await shots(owner, "unknown-card-entry-suggestion");
  await annaLink.click();
  await expect(verdict).toContainText("GODKÄND");
  await expect(verdict).toContainText("Anna Ek");
  await expect(verdict.getByTestId("registration-status")).toHaveText("Brickan kopplas till Anna Ek (H21) här. Skickas när nätet finns.");
  await expect(owner.getByTestId("register-form")).toHaveCount(0);
  await expect(owner.getByTestId("queue-status")).toHaveText("2 väntar");

  // Nätet tillbaka: kopplingen och anmälan skickas före avläsningarna; servern bedömer båda.
  await owner.context().setOffline(false);
  await expect(verdict.getByTestId("registration-status")).toHaveAttribute("data-state", "stored", { timeout: 30_000 });
  await expect(verdict.getByTestId("registration-status")).toHaveText("Brickan är kopplad till Anna Ek (H21).");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  await expect(verdict.getByRole("alert")).toHaveCount(0);

  // Arbetsytan: Anna har brickan och ett godkänt resultat, Prova är anmäld i H21.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Prova Provsson/ })).toContainText("8100102");
  await expect(owner.getByRole("row", { name: /Anna Ek/ })).toContainText("Godkänd");

  // Radera löpardatabasen (bekräftas).
  await openStep(owner, "Inställningar");
  await runners.getByRole("button", { name: "Radera löpardatabasen" }).click();
  await runners.getByRole("button", { name: "Ja, radera" }).click();
  await expect(runners.getByRole("status")).toContainText("Löpardatabasen är raderad.");
  await expect(runners.getByText("Ingen löpardatabas hämtad ännu.")).toBeVisible();
});
