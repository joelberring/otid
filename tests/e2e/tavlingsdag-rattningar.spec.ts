import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, ongoingRaceTimeZone, openStep, registerAccount, reviewScreenshots, sendReadout, today,
  unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 31 (del A): rättningar för hela tävlingen. Målklockan gick en timme fel, så Ada får mål före start och
 * blir felstämplad. Under Avläsning → Rättningar för hela tävlingen justeras målets tid för alla: förhandsbeskedet visar
 * att Ada blir godkänd, sparandet räknar om, deltagarkortet visar att tiden är justerad, och "Ta bort" räknar om tillbaka.
 */
const TIME_ZONE = ongoingRaceTimeZone();
const base = Math.floor(Date.now() / 1_000) * 1_000;
const ago = (minutes: number) => new Date(base - minutes * 60_000).toISOString();

async function openCard(owner: Page, name: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
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
  // Målklockan går en timme efter: Ada startar för 40 minuter sedan men får mål "för 95 minuter sedan".
  await sendReadout(owner, raceId, { cardNumber: "8131001", startPunchedAt: ago(40), finishPunchedAt: ago(65 + 30),
    punches: [{ code: 31, punchedAt: ago(30) }, { code: 32, punchedAt: ago(15) }] });
  await sendReadout(owner, raceId, { cardNumber: "8131002", startPunchedAt: ago(50), finishPunchedAt: ago(10),
    punches: [{ code: 31, punchedAt: ago(40) }, { code: 32, punchedAt: ago(20) }] });

  for (const path of ["race-corrections", "race-corrections/preview"]) {
    await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, path.endsWith("preview") ? "POST" : "GET");
  }
  await owner.reload();
  await openStep(owner, "Avläsning");
  const panel = owner.getByRole("region", { name: "Rättningar för hela tävlingen" });
  await expect(panel.getByText("Inga rättningar.")).toBeVisible();
  await panel.getByText("Justera tid för en station").click();
  await panel.getByLabel("Station").selectOption({ label: "Mål" });
  await panel.getByLabel("Ändring").selectOption({ label: "Senare (+)" });
  await panel.getByLabel("Minuter").fill("60");
  await panel.getByLabel("Varför").fill("Målklockan gick en timme efter");
  await panel.getByRole("button", { name: "Visa vad som händer" }).click();
  const review = panel.getByRole("alert", { name: /Justera tid för en station: Mål: \+60 min/ });
  await expect(review).toContainText("2 löpare har läst ut.");
  await expect(review).toContainText("2 löpare får ny tid eller ny status.");
  await expect(review).toContainText("Ada Testsson (Öppen): Felstämplad → Godkänd");
  await reviewScreenshots(owner, "steg31-tidsjustering");
  await review.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(panel.getByRole("status")).toContainText("Sparat. 2 resultat räknades om.", { timeout: 30_000 });
  await expect(panel.getByText("Mål: +60 min")).toBeVisible();

  await openStep(owner, "Anmälda");
  const card = await openCard(owner, "Ada Testsson");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");
  await expect(card.getByTestId("card-punches").getByRole("note")).toContainText("Tiden är justerad för hela tävlingen: Mål: +60 min.");

  // Ta bort: räknar om tillbaka, och justeringen står kvar bland de borttagna.
  await openStep(owner, "Avläsning");
  await panel.getByRole("button", { name: "Ta bort" }).click();
  const removal = panel.getByRole("alert", { name: "Ta bort: Mål: +60 min" });
  await expect(removal).toContainText("Ada Testsson (Öppen): Godkänd → Felstämplad");
  await removal.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(panel.getByText("Inga rättningar.")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("Borttagna (1)")).toBeVisible();
  await openStep(owner, "Anmälda");
  const again = await openCard(owner, "Ada Testsson");
  await expect(again.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
});
