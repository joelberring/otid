import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, ongoingRaceTimeZone, openCourseForm, openStep, publishRace, registerAccount, today, unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 25: saknade tävlingsfunktioner. En tävling med minutstart (H21, banan Lång med längd och stigning) och
 * fri start med maxtid (Öppen). Anna startar 2:12 efter sin lottade tid: varning i avläsningen och i deltagarkortet,
 * tiden räknas från den lottade starten. Cia har hyrbricka. Utan nät läses en okänd bricka av och löparen
 * direktanmäls på avläsningssidan; beskedet blir GODKÄND direkt och syns i arbetsytan när nätet är tillbaka.
 * Bo springer över maxtiden. Dan läser aldrig ut och markeras som ej start med en bekräftelse.
 */
/** Stockholm, eller en tidszon där klockan inte är nära midnatt (starterna ligger upp till 45 minuter bakåt). */
const TIME_ZONE = ongoingRaceTimeZone();
const zoned = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, ...options }).format(date);
const clockSeconds = (date: Date) => zoned(date, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Skärmbilder för granskning när E2E_SCREENSHOT_DIR är satt (1280 och 390 px). */
async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/step25-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function readExercise(page: Page, label: string, button: string, verdict: string) {
  await page.getByLabel("Deltagare").selectOption({ label });
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByTestId("verdict")).toContainText(verdict);
}

async function openCard(owner: Page, name: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return card;
}

test("sen start, hyrbricka, direktanmälan utan nät, maxtid och kvar i skogen", async ({ browser, request }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg25.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Klubbtävling ${suffix}`, today(new Date(), TIME_ZONE), "Tävling", TIME_ZONE);
  await publishRace(owner);

  // Banor och klasser: H21 med minutstart på Lång, Öppen med fri start på Kort.
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-classes`, "POST");
  await openStep(owner, "Banor");
  const courseForm = await openCourseForm(owner);
  await courseForm.getByLabel("Bannamn").fill("Lång");
  await courseForm.getByLabel("Klassnamn").fill("H21");
  await courseForm.getByLabel("Startsätt").selectOption({ label: "Minutstart" });
  await courseForm.getByLabel("Kontrollföljd").fill("31 32 33");
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible({ timeout: 30_000 });
  await addCourseAndClass(owner, "Kort", "Öppen", "31 33");

  // Banans längd och stigning i Banor; något annat än hela meter ger ett svenskt fel vid fältet.
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/courses/00000000-0000-4000-8000-000000000000/details`, "POST");
  await owner.getByRole("button", { name: "Längd och stigning för Lång" }).click();
  const details = owner.getByRole("form", { name: "Längd och stigning för Lång" });
  await details.getByLabel("Längd (meter)").fill("4,2 km");
  await details.getByRole("button", { name: "Spara" }).click();
  await expect(details.getByText("Längd: skriv hela meter, till exempel 4200, eller lämna tomt.")).toBeVisible();
  await details.getByLabel("Längd (meter)").fill("4200");
  await details.getByLabel("Stigning (meter)").fill("120");
  await details.getByRole("button", { name: "Spara" }).click();
  await expect(owner.getByText("Längd och stigning är sparade.")).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByRole("row", { name: /^Lång/ })).toContainText("4,2 km · 120 m");

  // Maxtid 20 minuter för Öppen i Klasser. Utvecklingsservern kompilerar ändringens rutt i förväg (gav ibland inget svar
  // inom 30 s vid första anropet).
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/classes/00000000-0000-4000-8000-000000000000/edit`, "POST");
  await openStep(owner, "Klasser");
  await owner.getByRole("row", { name: /Öppen/ }).getByRole("button", { name: "Redigera Öppen" }).click();
  const classEditor = owner.getByRole("form", { name: "Redigera Öppen" });
  await classEditor.getByLabel("Maxtid (minuter)").fill("0");
  await classEditor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(classEditor.getByText("Maxtid: skriv hela minuter (1–1440) eller lämna tomt.")).toBeVisible();
  await classEditor.getByLabel("Maxtid (minuter)").fill("20");
  // Ingen har läst ut: ändringen sparas direkt, utan granskningssteg.
  await classEditor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Klassen är ändrad.")).toBeVisible({ timeout: 30_000 });
  await owner.getByRole("button", { name: "Redigera Öppen" }).click();
  await expect(classEditor.getByLabel("Maxtid (minuter)")).toHaveValue("20");
  await classEditor.getByRole("button", { name: "Avbryt" }).click();

  // Anmälda: Anna lottad för 45 minuter sedan, Cia i H21 utan lottad tid (hyrbricka), Bo och Dan i Öppen.
  await addEntry(owner, { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Ek", card: "8250001",
    startTime: clockSeconds(new Date(Date.now() - 45 * 60_000)) });
  await addEntry(owner, { className: "H21", givenName: "Cia", familyName: "Holm", club: "OK Ek", card: "8250003" });
  await addEntry(owner, { className: "Öppen", givenName: "Bo", familyName: "Lind", club: "IFK Lidingö", card: "8250002" });
  await addEntry(owner, { className: "Öppen", givenName: "Dan", familyName: "Berg", club: "Tullinge SK", card: "8250004" });
  const ciaCard = await openCard(owner, "Cia Holm");
  await ciaCard.getByRole("button", { name: "Ändra bricka" }).click();
  await ciaCard.getByRole("button", { name: "Markera som hyrbricka" }).click();
  await expect(owner.getByText("Brickans hyrstatus är sparad.")).toBeVisible({ timeout: 30_000 });

  // Avläsningen med övningsstationen.
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
  const verdict = owner.getByTestId("verdict");

  // Sen start: godkänd med varning; tiden räknas från den lottade starten (45 minuter sedan).
  await readExercise(owner, "Anna Ek · H21 · 8250001", "Läs av: sen start", "GODKÄND");
  await expect(verdict.getByTestId("verdict-start-punch")).toHaveAttribute("data-kind", "LATE");
  await expect(verdict.getByTestId("verdict-start-punch")).toHaveText(/^! Startstämpling [\d:]+, lottad [\d:]+ – 2:12 sen$/);
  await expect(verdict.locator(".time")).toHaveText(/^4[45]:\d\d$/);
  await screenshots(owner, "sen-start");

  // Hyrbricka utan lottad tid: starten tas från stämplingen och beskedet säger åt funktionären att samla in brickan.
  await readExercise(owner, "Cia Holm · H21 · 8250003", "Läs av: rätt stämplat", "GODKÄND");
  await expect(verdict.getByTestId("verdict-rental")).toHaveText("▲ HYRBRICKA – samla in");
  await expect(verdict.getByTestId("verdict-start-punch")).toHaveAttribute("data-kind", "FROM_PUNCH");
  await screenshots(owner, "hyrbricka");

  // Över maxtiden (30 minuter mot 20).
  await readExercise(owner, "Bo Lind · Öppen · 8250002", "Läs av: rätt stämplat", "MAXTID ÖVERSKRIDEN");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Utan nät: en okänd bricka som springer H21:s bana. Anmälan sker här och beskedet bedöms om direkt.
  await owner.context().setOffline(true);
  await expect(owner.getByTestId("internet-status")).toContainText("Ej ansluten");
  await owner.getByLabel("Deltagare").selectOption({ label: "Anna Ek · H21 · 8250001" });
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(verdict).toContainText("OKÄND BRICKA");
  const form = owner.getByTestId("register-form");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Lägg till" }).click();
  // Klassen vars bana passar stämplingarna är förvald (PLAN.md steg 29); namnen saknas.
  for (const error of ["Skriv förnamnet.", "Skriv efternamnet."]) await expect(form.getByText(error)).toBeVisible();
  await expect(form.getByText("Välj klass.")).toHaveCount(0);
  await expect(form.getByLabel("Förnamn")).toBeFocused();
  await expect(form.getByLabel("Klass").locator("option:checked")).toHaveText("H21 – passar");
  await form.getByLabel("Förnamn").fill("Nils");
  await form.getByLabel("Efternamn").fill("Ny");
  await screenshots(owner, "direktanmalan-offline");
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(verdict).toContainText("GODKÄND");
  await expect(verdict).toContainText("Nils Ny");
  await expect(verdict.getByTestId("registration-status")).toHaveAttribute("data-state", "pending");
  await expect(verdict.getByTestId("registration-status")).toHaveText("Nils Ny är anmäld i H21 här. Skickas när nätet finns.");
  await expect(owner.getByTestId("register-form")).toHaveCount(0);
  await expect(owner.getByTestId("queue-status")).toHaveText("1 väntar");

  // Nätet tillbaka: anmälan skickas först, sedan avläsningen; servern bedömer den mot Nils.
  await owner.context().setOffline(false);
  await expect(verdict.getByTestId("registration-status")).toHaveAttribute("data-state", "stored", { timeout: 30_000 });
  await expect(verdict.getByTestId("registration-status")).toHaveText("Nils Ny är anmäld i H21.");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  await expect(verdict.getByRole("alert")).toHaveCount(0);

  // Arbetsytan: Nils finns med sin bricka och ett godkänt resultat; Annas kort visar den sena starten.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  const nils = await openCard(owner, "Nils Ny");
  await expect(nils.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");
  const anna = await openCard(owner, "Anna Ek");
  await expect(anna.getByTestId("start-punch-note")).toContainText(/Startstämpling [\d:]+, lottad [\d:]+ – 2:12 sen/);

  // Resultat: Anna märkt "Sen start", Bo utan placering med "Maxtid överskriden", listan preliminär.
  for (const path of ["results", "relay-results", "radio"]) await warmRoute(owner, `/api/public/races/${raceId}/${path}`);
  await openStep(owner, "Resultat");
  const h21 = owner.getByRole("table", { name: "H21" });
  await expect(h21.getByRole("row", { name: /Anna Ek/ })).toContainText("Sen start");
  const open = owner.getByRole("table", { name: "Öppen" });
  await expect(open.getByRole("row", { name: /Bo Lind/ })).toContainText("Maxtid överskriden");
  await expect(owner.getByText("Preliminära resultat").filter({ visible: true }).first()).toBeVisible();
  await expect(owner.getByText("Bana Lång · 4,2 km · 120 m").filter({ visible: true }).first()).toBeVisible();
  await screenshots(owner, "resultat-maxtid");

  // Kvar i skogen: förhandsvisning, en bekräftelse; en gång till finns inget att markera.
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/remaining-runners`);
  await owner.getByText("Markera alla kvar i skogen som ej start").click();
  const remaining = owner.getByTestId("remaining-runners");
  await remaining.getByRole("button", { name: "Visa vilka som berörs" }).click();
  const preview = remaining.getByRole("region", { name: "Markera alla kvar i skogen som ej start" });
  await expect(preview.getByRole("heading", { name: "1 löpare blir ej start" })).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText("Dan Berg · Öppen · Tullinge SK");
  await screenshots(owner, "kvar-i-skogen");
  await preview.getByRole("button", { name: "Markera 1 som ej start" }).click();
  await expect(remaining.getByRole("status")).toContainText("Klart: 1 löpare är ej start.", { timeout: 30_000 });
  await remaining.getByRole("button", { name: "Visa vilka som berörs" }).click();
  await expect(remaining.getByText("Ingen saknar avläsning. Inget att markera.")).toBeVisible({ timeout: 30_000 });
  await expect(open.getByRole("row", { name: /Dan Berg/ })).toContainText("Ej start");

  // Den publika listan: preliminär, Bo med maxtid överskriden, men ingen startvarning.
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    return html.includes("Nils") && html.includes("Maxtid överskriden") && html.includes("Preliminära resultat") &&
      !html.includes("Sen start") && !html.includes("lottad");
  }, { timeout: 60_000 }).toBe(true);
});
