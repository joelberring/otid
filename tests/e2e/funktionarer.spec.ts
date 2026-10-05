import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, addPerson, createRace, logIn, openStep, registerAccount, sectionButton, unique, warmRoute } from "./helpers";

/**
 * Steg 18 (ADR-0172 beslut 3): funktionärer. Ägaren lägger till ett befintligt konto som funktionär under
 * Inställningar → Personer med behörighet. Funktionären ser tävlingen i Mina tävlingar, får en arbetsyta med bara
 * Start och Avläsning, läser av med övningsstationen, direktanmäler en okänd bricka och ser kvar i skogen och
 * speakern, men når inte Banor eller resultatändring (inte i sidopanelen; servern svarar 403). Samma konto läser
 * av från en andra enhet samtidigt.
 */
const RUNNERS = [
  { givenName: "Anna", familyName: "Ek", className: "H21", card: "8101001" },
  { givenName: "Bo", familyName: "Lind", className: "H21", card: "8101002" },
  { givenName: "Cia", familyName: "Holm", className: "H21", card: "8101003" }
] as const;

async function openReadout(page: Page, raceId: string): Promise<void> {
  await page.goto(`/admin/${raceId}/readout`);
  await page.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(page.getByTestId("package-status")).toContainText("v");
  await page.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(page.getByTestId("station-status")).toContainText("Övningsstation");
}

async function readRunner(page: Page, runner: typeof RUNNERS[number]): Promise<void> {
  await page.getByLabel("Deltagare").selectOption({ label: `${runner.givenName} ${runner.familyName} · ${runner.className} · ${runner.card}` });
  await page.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(page.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(page.getByTestId("verdict")).toContainText(`${runner.givenName} ${runner.familyName}`);
}

test("admin lägger till funktionär som läser av från två enheter men inte når banor", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Olle Ägare");
  const raceId = await createRace(owner, `Klubbtävling ${suffix}`, "2026-10-08", "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  for (const runner of RUNNERS) await addEntry(owner, { ...runner, club: "OK Test" });

  // Funktionären har ett eget konto men ser ingenting förrän ägaren lägger till det.
  const staffEmail = `funk.${suffix}@exempel.se`;
  const staff = await registerAccount(browser, staffEmail, "Frida Funktionär");
  await expect(staff.getByText("Inga tävlingar ännu")).toBeVisible();

  // En adress utan konto avvisas med besked; ingen inbjudan skickas.
  await openStep(owner, "Inställningar");
  const people = owner.getByRole("region", { name: "Personer med behörighet" });
  await people.getByRole("form", { name: "Lägg till person" }).getByLabel("E-postadress").fill(`ingen.${suffix}@exempel.se`);
  await people.getByRole("button", { name: "Lägg till" }).click();
  await expect(people.getByRole("alert")).toContainText("Be personen skapa ett konto med den adressen först");
  await addPerson(owner, staffEmail, "Funktionär");
  const staffRow = people.getByRole("listitem").filter({ hasText: staffEmail });
  await expect(staffRow).toContainText("Funktionär");
  await expect(people.getByRole("listitem").filter({ hasText: `agare.${suffix}@exempel.se` })).toContainText("Ägare");

  // Mina tävlingar visar tävlingen med rollen Funktionär; arbetsytan har bara Start och Avläsning.
  await staff.reload();
  await expect(staff.getByText(`Klubbtävling ${suffix}`)).toBeVisible();
  await expect(staff.getByText("Funktionär", { exact: true })).toBeVisible();
  await staff.getByRole("button", { name: "Öppna arbetsytan" }).click();
  await staff.waitForURL(/manage$/);
  await expect(sectionButton(staff, "Avläsning")).toHaveAttribute("aria-current", "step");
  await expect(sectionButton(staff, "Start")).toBeVisible();
  for (const hidden of ["Banor", "Klasser", "Anmälda", "Resultat", "Inställningar"] as const) {
    await expect(sectionButton(staff, hidden)).toHaveCount(0);
  }
  await expect(staff.locator("header").getByText("Funktionär", { exact: true })).toBeVisible();
  await openStep(staff, "Start");
  await expect(staff.getByRole("table", { name: "H21" })).toContainText("Anna Ek");
  await expect(staff.getByRole("button", { name: "Publicera startlistan" })).toHaveCount(0);
  await expect(staff.getByText("Exportera", { exact: true })).toHaveCount(0);

  // Servern nekar allt annat: banor, deltagare, behörigheter och import (direkt adress).
  for (const path of ["courses", "participants", "people", "finalization-candidates"]) {
    const response = await staff.request.get(`/api/admin/races/${raceId}/administrator/${path}`);
    expect(response.status(), path).toBe(403);
  }
  await staff.goto(`/admin/${raceId}/imports`);
  await expect(staff.getByText("Behörighet saknas")).toBeVisible();

  // Avläsning med övningsstationen: Anna och en okänd bricka.
  await openReadout(staff, raceId);
  await readRunner(staff, RUNNERS[0]);
  await staff.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(staff.getByTestId("verdict")).toContainText("OKÄND BRICKA");
  await expect(staff.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Samma konto på en andra enhet: egen inloggning, läser av Bo samtidigt.
  const second = await (await browser.newContext()).newPage();
  await logIn(second, staffEmail);
  await expect(second.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  await openReadout(second, raceId);
  await readRunner(second, RUNNERS[1]);
  await expect(second.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  await readRunner(staff, RUNNERS[0]);
  await expect(staff.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Kontrollvyn: den okända brickan direktanmäls (funktionären kan inte koppla till en anmäld löpare).
  await warmRoute(staff, `/api/admin/races/${raceId}/administrator/unknown-readout-resolution`);
  await staff.goto(`/admin/${raceId}/manage`);
  await openStep(staff, "Avläsning");
  const control = staff.getByRole("region", { name: "Tävlingsdagens kontrollvy" });
  const unknownCards = control.getByRole("region", { name: /Okända brickor/ });
  await expect(unknownCards.getByRole("heading")).toContainText("1");
  await expect(unknownCards.getByLabel("Koppla till")).toHaveCount(0);
  const classSelect = unknownCards.getByLabel("Klass för ny deltagare");
  await classSelect.selectOption(await classSelect.locator("option", { hasText: "H21" }).getAttribute("value"));
  await unknownCards.getByLabel("Förnamn").fill("Dan");
  await unknownCards.getByLabel("Efternamn").fill("Direkt");
  await unknownCards.getByRole("button", { name: "Granska koppling" }).click();
  await unknownCards.getByRole("button", { name: "Bekräfta koppling och bedömning" }).click();
  await expect(unknownCards).toContainText("Det finns inga olösta okända avläsningar");

  // Speakern: Anna och Bo i mål, Cia kvar i skogen.
  const [speaker] = await Promise.all([staff.context().waitForEvent("page"), staff.getByRole("link", { name: /Öppna speaker/ }).click()]);
  await speaker.waitForURL(`**/admin/${raceId}/speaker`);
  await expect(speaker.getByRole("region", { name: "Senast i mål" })).toContainText("Bo Lind");
  await expect(speaker.getByRole("region", { name: "Kvar i skogen" })).toContainText("Cia Holm");

  // Kvar i skogen: Cia har inte läst av. Funktionären registrerar att hon kommit tillbaka.
  await control.getByRole("button", { name: "Uppdatera" }).click();
  await expect(staff.getByTestId("in-forest-count")).toHaveText("1");
  await expect(control.getByRole("region", { name: /Kvar i skogen/ })).toContainText("Cia Holm");
  await staff.getByText("Kvar i skogen – hela listan").click();
  await staff.getByRole("button", { name: "Välj Cia Holm" }).click();
  await staff.getByText("Vald deltagare för återkomst: Cia Holm").click();
  await staff.getByRole("button", { name: "Granska manuell återkomst" }).click();
  await staff.getByRole("button", { name: "Bekräfta manuell återkomst" }).click();
  await expect(staff.getByText("Manuell återkomst är registrerad.")).toBeVisible();

  // Ägaren tar bort funktionären: åtkomsten upphör direkt på båda enheterna.
  await owner.reload();
  await openStep(owner, "Inställningar");
  await expect(staffRow).toBeVisible();
  owner.once("dialog", dialog => void dialog.accept());
  await staffRow.getByRole("button", { name: "Ta bort behörigheten för Frida Funktionär" }).click();
  await expect(people.getByText("Frida Funktionär har inte längre behörighet.")).toBeVisible({ timeout: 30_000 });
  await expect(staffRow).toHaveCount(0);
  for (const page of [staff, second]) {
    const response = await page.request.get(`/api/admin/races/${raceId}/administrator/forest-watch`);
    expect(response.status()).toBe(401);
  }
});
