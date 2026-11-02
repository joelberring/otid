import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, publishRaceViaApi, registerAccount, reviewScreenshots,
  sendReadout, today, unique } from "./helpers";

/**
 * ADR-0187: arrangörens säkerhetskopia och återställning. En tävling med avläsningar laddas ner från Inställningar
 * ("Ladda ner säkerhetskopia", med besked om personuppgifter och tiden för senaste nedladdningen) och återställs av ett
 * annat konto från Mina tävlingar: förhandsvisningen visar antal, datum och formatversion, och den nya tävlingen har samma
 * resultat och sträcktider. En fil som inte är en säkerhetskopia avvisas med ett begripligt besked. Påhittade namn.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

async function publicList(page: Page, raceId: string): Promise<string> {
  const response = await page.request.get(`/api/public/races/${raceId}/results`);
  expect(response.status()).toBe(200);
  const list = await response.json() as Record<string, unknown>;
  return JSON.stringify({ ...list, raceId: undefined }).replace(UUID, "<id>");
}

async function splitsTable(page: Page, raceId: string): Promise<string> {
  await page.goto(`/results/${raceId}/splits?class=H21`);
  const table = page.getByRole("table").first();
  await expect(table).toContainText("Ada");
  return (await table.innerText()).replace(/\s+/g, " ");
}

test("ladda ner säkerhetskopia och återställ den som en ny tävling med samma resultat", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kopia.${suffix}@exempel.se`, "Sara Säker");
  const raceId = await createRace(owner, `Säker tävling ${suffix}`, today(), "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Snabb", club: "OK Test", card: "7390001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Miss", club: "OK Test", card: "7390002" });
  await addEntry(owner, { className: "H21", givenName: "Cia", familyName: "Jämn", club: "OK Test", card: "7390003" });
  await publishRace(owner);
  const start = Date.now() - 60 * 60_000;
  const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  await sendReadout(owner, raceId, { cardNumber: "7390001", startPunchedAt: at(0), finishPunchedAt: at(30),
    punches: [{ code: 31, punchedAt: at(10) }, { code: 32, punchedAt: at(20) }, { code: 33, punchedAt: at(25) }] });
  await sendReadout(owner, raceId, { cardNumber: "7390002", startPunchedAt: at(1), finishPunchedAt: at(33),
    punches: [{ code: 31, punchedAt: at(12) }, { code: 33, punchedAt: at(27) }] });
  await sendReadout(owner, raceId, { cardNumber: "7390003", startPunchedAt: at(2), finishPunchedAt: at(34),
    punches: [{ code: 31, punchedAt: at(13) }, { code: 32, punchedAt: at(21) }, { code: 33, punchedAt: at(29) }] });

  // Inställningar → Säkerhetskopia: när den bör tas, personuppgifterna och knappen.
  await owner.reload();
  await openStep(owner, "Inställningar");
  const section = owner.getByRole("region", { name: "Säkerhetskopia" });
  await expect(section).toContainText("Ta en kopia efter lottningen,");
  await expect(section).toContainText("Filen innehåller personuppgifter.");
  await expect(section.getByTestId("backup-last")).toHaveText("Ingen säkerhetskopia har laddats ner ännu.");
  const downloading = owner.waitForEvent("download");
  await section.getByRole("button", { name: "Ladda ner säkerhetskopia" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^otid-sakerhetskopia-torsdag-\d{4}-\d{2}-\d{2}-\d{8}-\d{4}\.zip$/);
  const file = await download.path();
  await expect(section.getByRole("status")).toHaveText("Säkerhetskopian är nedladdad.");
  await expect(section.getByTestId("backup-last")).toContainText("Senast nedladdad");
  await section.scrollIntoViewIfNeeded();
  await reviewScreenshots(owner, "aterstallning-nedladdning");

  // Ett annat konto (som på en ny server) återställer från Mina tävlingar.
  const restorer = await registerAccount(browser, `ny.${suffix}@exempel.se`, "Nils Ny");
  await restorer.goto("/organizer");
  await restorer.getByRole("button", { name: "Återställ tävling från säkerhetskopia" }).click();
  const dialog = restorer.getByRole("dialog", { name: "Återställ tävling från säkerhetskopia" });
  // Fel fil först: ett begripligt besked.
  await dialog.getByLabel("Säkerhetskopia").setInputFiles({ name: "inte-en-kopia.zip", mimeType: "application/zip", buffer: Buffer.from("hej") });
  await dialog.getByRole("button", { name: "Kontrollera filen" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Filen är inte en säkerhetskopia från O-Tid.");
  await dialog.getByLabel("Säkerhetskopia").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip",
    buffer: await readFile(file) });
  await dialog.getByRole("button", { name: "Kontrollera filen" }).click();
  const preview = dialog.getByTestId("restore-preview");
  await expect(preview).toContainText(`Säker tävling ${suffix}`);
  await expect(preview).toContainText(today());
  await expect(preview).toContainText("1 klass · 3 deltagare · 3 avläsningar");
  await expect(preview).toContainText("formatversion 2");
  await expect(preview).toContainText(`kopia.${suffix}@exempel.se`);
  await expect(preview).toContainText("Filen innehåller personuppgifter.");
  await reviewScreenshots(restorer, "aterstallning-forhandsvisning");
  await preview.getByRole("button", { name: "Skapa tävlingen" }).click();
  await expect(dialog.getByRole("status")).toContainText("Tävlingen är återställd.");
  await dialog.getByRole("button", { name: "Öppna tävlingen" }).click();
  await restorer.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const copyId = restorer.url().split("/").at(-2)!;
  expect(copyId).not.toBe(raceId);
  await expect(restorer.getByRole("heading", { name: `Säker tävling ${suffix}` })).toBeVisible();
  await reviewScreenshots(restorer, "aterstallning-ny-tavling");

  // Samma resultat och sträcktider (den nya tävlingen publiceras först, den är opublicerad efter återställningen).
  await publishRaceViaApi(restorer, copyId);
  expect(await publicList(restorer, copyId)).toBe(await publicList(owner, raceId));
  const visitor = await browser.newPage();
  const splits = await splitsTable(visitor, raceId);
  expect(splits).toContain("Ada Snabb");
  expect(await splitsTable(visitor, copyId)).toBe(splits);
  await visitor.close();
});
