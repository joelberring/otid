import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, daysFromToday, ongoingRaceTimeZone, openCourseForm, openStep, registerAccount, reviewScreenshots, sendReadout, today,
  unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 31 (del A): rättningar för hela tävlingen. Målklockan gick en timme fel, så Ada får mål före start och
 * blir felstämplad. Under Avläsning → Rättningar för hela tävlingen justeras målets tid för alla: förhandsbeskedet visar
 * att Ada blir godkänd, sparandet räknar om, deltagarkortet visar att tiden är justerad, och "Ta bort" räknar om tillbaka.
 */
const TIME_ZONE = ongoingRaceTimeZone();
const base = Math.floor(Date.now() / 1_000) * 1_000;
const ago = (minutes: number) => new Date(base - minutes * 60_000).toISOString();

/** Öppnar deltagarkortet och väntar tills resultatet visar `status` (listan läses in på nytt efter en rättning). */
async function openCard(owner: Page, name: string, status: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
    await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText(status, { timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  return card;
}

test("justera tid för en station räknar om alla och kan tas bort", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg31a.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Nattorientering ${suffix}`, today(new Date(), TIME_ZONE), "Tävling", TIME_ZONE);
  await addCourseAndClass(owner, "Lång", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Ada", familyName: "Testsson", club: "OK Test", card: "8131001" });
  await addEntry(owner, { className: "Öppen", givenName: "Bo", familyName: "Testsson", club: "OK Test", card: "8131002" });
  await addEntry(owner, { className: "Öppen", givenName: "Cia", familyName: "Testsson", club: "OK Test", card: "8131003" });
  // Målklockan går en timme efter: Ada startar för 40 minuter sedan men får mål "för 95 minuter sedan".
  await sendReadout(owner, raceId, { cardNumber: "8131001", startPunchedAt: ago(40), finishPunchedAt: ago(65 + 30),
    punches: [{ code: 31, punchedAt: ago(30) }, { code: 32, punchedAt: ago(15) }] });
  await sendReadout(owner, raceId, { cardNumber: "8131002", startPunchedAt: ago(50), finishPunchedAt: ago(10),
    punches: [{ code: 31, punchedAt: ago(40) }, { code: 32, punchedAt: ago(20) }] });
  // Cia hittade ingen enhet vid 32.
  await sendReadout(owner, raceId, { cardNumber: "8131003", startPunchedAt: ago(45), finishPunchedAt: ago(8),
    punches: [{ code: 31, punchedAt: ago(35) }] });

  for (const path of ["race-corrections", "race-corrections/preview"]) {
    await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, path.endsWith("preview") ? "POST" : "GET");
  }
  await owner.reload();
  await openStep(owner, "Avläsning");
  const panel = owner.getByRole("region", { name: "Rättningar för hela tävlingen" });
  await expect(panel.getByText("Inga rättningar.")).toBeVisible();
  await panel.getByText("Justera tid för en station").click();
  const timeForm = panel.locator("form").filter({ has: owner.getByText(/haft fel klocka/) });
  await timeForm.getByLabel("Station").selectOption({ label: "Mål" });
  await timeForm.getByLabel("Ändring").selectOption({ label: "Senare (+)" });
  await timeForm.getByLabel("Minuter").fill("60");
  await timeForm.getByLabel("Varför").fill("Målklockan gick en timme efter");
  await timeForm.getByRole("button", { name: "Visa vad som händer" }).click();
  const review = panel.getByRole("alert", { name: /Justera tid för en station: Mål: \+60 min/ });
  await expect(review).toContainText("3 löpare har läst ut.");
  await expect(review).toContainText("3 löpare får ny tid eller ny status.");
  await expect(review).toContainText("Ada Testsson (Öppen): Felstämplad → Godkänd");
  await reviewScreenshots(owner, "steg31-tidsjustering");
  await review.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(panel.getByRole("status")).toContainText("Sparat. 3 resultat räknades om.", { timeout: 30_000 });
  await expect(panel.getByText("Mål: +60 min")).toBeVisible();

  await openStep(owner, "Anmälda");
  const card = await openCard(owner, "Ada Testsson", "Godkänd");
  await expect(card.getByTestId("card-punches").getByRole("note")).toContainText("Tiden är justerad för hela tävlingen: Mål: +60 min.");

  // Ta bort: räknar om tillbaka, och justeringen står kvar bland de borttagna.
  await openStep(owner, "Avläsning");
  await panel.getByRole("button", { name: "Ta bort" }).click();
  const removal = panel.getByRole("alert", { name: "Ta bort: Mål: +60 min" });
  await expect(removal).toContainText("Ada Testsson (Öppen): Godkänd → Felstämplad");
  await removal.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(panel.getByText("Inga rättningar.")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("status").last()).toContainText("Sparat.");
  await expect(panel.getByText("Borttagna (1)")).toBeVisible();
  await openStep(owner, "Anmälda");
  await openCard(owner, "Ada Testsson", "Felstämplad");

  // Kontroll ur funktion: 32 krävs inte för någon; Cia blir godkänd och sträcktiderna visar "Ur funktion".
  await openStep(owner, "Avläsning");
  await panel.getByText("Kontroll ur funktion", { exact: true }).click();
  const outForm = panel.locator("form").filter({ has: owner.getByText(/krävs inte på någon bana/) });
  await outForm.getByLabel("Kontrollens kod").fill("32");
  await outForm.getByLabel("Varför").fill("Enheten saknades vid kontrollen");
  await outForm.getByRole("button", { name: "Visa vad som händer" }).click();
  const outReview = panel.getByRole("alert", { name: "Kontroll ur funktion: Kontroll 32 ur funktion" });
  await expect(outReview).toContainText("Cia Testsson (Öppen): Felstämplad → Godkänd");
  await reviewScreenshots(owner, "steg31-ur-funktion");
  await outReview.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(outForm.getByRole("status")).toContainText("Sparat. 3 resultat räknades om.", { timeout: 30_000 });
  await expect(panel.getByText("Kontroll 32 ur funktion · Enheten saknades vid kontrollen")).toBeVisible();
  await openStep(owner, "Anmälda");
  const cia = await openCard(owner, "Cia Testsson", "Godkänd");
  await expect(cia.getByRole("row", { name: /^2 32/ })).toContainText("Ur funktion");

  // Räkna om hela tävlingen (A5) under Resultat → Efterarbete.
  await openStep(owner, "Resultat");
  const followUp = owner.getByRole("region", { name: "Efterarbete" });
  await followUp.getByText("Räkna om hela tävlingen", { exact: true }).click();
  await followUp.getByRole("button", { name: "Visa vad som händer" }).click();
  const recalc = followUp.getByRole("alert", { name: "Räkna om hela tävlingen" });
  await expect(recalc).toContainText("3 löpare har läst ut.");
  await expect(recalc).toContainText("Ingen byter status.");
  await recalc.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(followUp.getByRole("status").filter({ hasText: "Sparat." })).toContainText("Sparat. 3 resultat räknades om.", { timeout: 30_000 });
});

test("flytta starttider för en klass räknar om de avlästa", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg31a3.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Startklocka ${suffix}`, today(new Date(), TIME_ZONE), "Tävling", TIME_ZONE);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-classes`, "POST");
  await openStep(owner, "Banor");
  const courseForm = await openCourseForm(owner);
  await courseForm.getByLabel("Bannamn").fill("Lång");
  await courseForm.getByLabel("Klassnamn").fill("H21");
  await courseForm.getByLabel("Startsätt").selectOption({ label: "Minutstart" });
  await courseForm.getByLabel("Kontrollföljd").fill("31 32");
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible({ timeout: 30_000 });
  // Lottad för 45 minuter sedan, men starten kom igång fem minuter sent.
  const minute = Math.floor(base / 60_000) * 60_000;
  const clock = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(ms));
  const drawn = minute - 45 * 60_000;
  await addEntry(owner, { className: "H21", givenName: "Dan", familyName: "Testsson", club: "OK Test", card: "8131004", startTime: clock(drawn) });
  const at = (ms: number) => new Date(ms).toISOString();
  await sendReadout(owner, raceId, { cardNumber: "8131004", startPunchedAt: at(drawn + 5 * 60_000), finishPunchedAt: at(drawn + 35 * 60_000),
    punches: [{ code: 31, punchedAt: at(drawn + 15 * 60_000) }, { code: 32, punchedAt: at(drawn + 25 * 60_000) }] });

  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/race-corrections/preview`, "POST");
  await owner.reload();
  await openStep(owner, "Start");
  await owner.getByText("Flytta starttider", { exact: true }).click();
  const shift = owner.locator("form").filter({ has: owner.getByText(/Alla tilldelade starttider/) });
  await shift.getByLabel("Klass").selectOption({ label: "H21" });
  await shift.getByLabel("Minuter").fill("5");
  await shift.getByLabel("Varför").fill("Starten kom igång sent");
  await shift.getByRole("button", { name: "Visa vad som händer" }).click();
  const review = shift.getByRole("alert", { name: "Flytta starttider: H21 +5 min" });
  await expect(review).toContainText("1 starttid flyttas.");
  await expect(review).toContainText(`Första start: ${clock(drawn)}:00 → ${clock(drawn + 5 * 60_000)}:00`);
  await expect(review).toContainText("1 löpare får ny tid eller ny status.");
  await reviewScreenshots(owner, "steg31-flytta-starttider");
  await review.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(shift.getByRole("status")).toContainText("Publicera startlistan igen", { timeout: 30_000 });
  await openStep(owner, "Anmälda");
  const card = await openCard(owner, "Dan Testsson", "Godkänd");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("30:00");

  // Oröjd bricka (A4): Eva har kvar förra veckans varv. Det räknas inte; kvällens varv är komplett och godkänt.
  await addEntry(owner, { className: "H21", givenName: "Eva", familyName: "Testsson", club: "OK Test", card: "8131005", startTime: clock(drawn) });
  const old = daysFromToday(-6);
  await sendReadout(owner, raceId, { cardNumber: "8131005", checkPunchedAt: at(drawn - 5 * 60_000), startPunchedAt: at(drawn + 5 * 60_000),
    finishPunchedAt: at(drawn + 40 * 60_000), punches: [{ code: 31, punchedAt: `${old}T16:10:00.000Z` }, { code: 32, punchedAt: `${old}T16:20:00.000Z` },
      { code: 31, punchedAt: at(drawn + 15 * 60_000) }, { code: 32, punchedAt: at(drawn + 30 * 60_000) }] });
  await owner.reload();
  await openStep(owner, "Anmälda");
  const eva = await openCard(owner, "Eva Testsson", "Godkänd");
  await expect(eva.getByTestId("card-punches").getByRole("note")).toContainText("2 gamla stämplingar räknades inte (brickan var inte tömd).");
});
