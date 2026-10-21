import { expect, test, type Locator, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, reviewScreenshots, sectionButton,
  sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * Steg 38 (efter en skarp tävling): avsluta tävlingen. En felstämplad löpare bekräftas ("Bekräfta felstämplad", kan
 * ångras) och är inte längre att titta på; den som bröt behåller sina sträcktider fram till sista stämplade kontrollen;
 * "Resultaten är klara" säger vem som stoppar och öppnar deltagarkortet, och går sedan igenom. Påhittade namn.
 */
async function openCard(owner: Page, name: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return card;
}

async function decide(card: Locator, option: string, consequence: string, reason?: string) {
  await card.getByLabel("Ändra status").selectOption({ label: option });
  await expect(card.getByRole("alert")).toContainText(consequence);
  if (reason !== undefined) await card.getByLabel("Orsak (valfritt)").fill(reason);
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
}

test("avsluta tävlingen: bekräfta felstämplad, brutit med sträcktider och Resultaten är klara", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg38.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Klubbtävling ${suffix}`, today(), "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Snabb", club: "OK Test", card: "7380001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Miss", club: "OK Test", card: "7380002" });
  await addEntry(owner, { className: "H21", givenName: "Cia", familyName: "Bryt", club: "OK Test", card: "7380003" });
  await addEntry(owner, { className: "H21", givenName: "Dan", familyName: "Borta", club: "OK Test", card: "7380004" });
  await publishRace(owner);

  const start = Date.now() - 60 * 60_000;
  const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  // Ada godkänd; Bo missade 32; Cia bröt efter 31 och stämplade inte mål.
  await sendReadout(owner, raceId, { cardNumber: "7380001", startPunchedAt: at(0), finishPunchedAt: at(30),
    punches: [{ code: 31, punchedAt: at(10) }, { code: 32, punchedAt: at(20) }, { code: 33, punchedAt: at(25) }] });
  await sendReadout(owner, raceId, { cardNumber: "7380002", startPunchedAt: at(1), finishPunchedAt: at(33),
    punches: [{ code: 31, punchedAt: at(12) }, { code: 33, punchedAt: at(27) }] });
  await sendReadout(owner, raceId, { cardNumber: "7380003", startPunchedAt: at(2), punches: [{ code: 31, punchedAt: at(14) }] });
  await owner.reload();
  await expect(sectionButton(owner, "Resultat")).toHaveAccessibleDescription(/2 felstämplade att titta på/);

  // Brutit: Cia behåller sträcktiden vid 31, utan tid och placering.
  await openStep(owner, "Anmälda");
  const card = await openCard(owner, "Cia Bryt");
  await decide(card, "Brutit", "Löparen visas som brutit");
  await expect(owner.getByText("Avbrutit lopp är sparat.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Ej fullföljt");
  const ciaSplits = card.getByRole("region", { name: "Sträcktider", exact: true }).first();
  await expect(ciaSplits.getByRole("row", { name: /^1 31 / })).toContainText("12:00");
  await expect(sectionButton(owner, "Resultat")).toHaveAccessibleDescription(/1 felstämplad att titta på/);

  // Bekräfta felstämplad (med orsak): Bo står kvar som felstämplad men är inte längre att titta på.
  await openCard(owner, "Bo Miss");
  await decide(card, "Bekräfta felstämplad", "Löparen står kvar som felstämplad med sina sträcktider", "Missade 32, kontrollerat");
  await expect(owner.getByText("Felstämplingen är bekräftad. Löparen står kvar som felstämplad.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämpling bekräftad");
  await expect(card.getByTestId("decision-note")).toHaveText("Orsak: Missade 32, kontrollerat");
  await expect(sectionButton(owner, "Resultat")).not.toHaveAccessibleDescription(/att titta på/);
  await reviewScreenshots(owner, "step38-mispunch-confirmed");
  // Ångra och bekräfta igen.
  await decide(card, "Ta bort bekräftelsen", "Bekräftelsen tas bort.");
  await expect(owner.getByText("Bekräftelsen är borttagen. Löparen är felstämplad att titta på igen.")).toBeVisible();
  await expect(sectionButton(owner, "Resultat")).toHaveAccessibleDescription(/1 felstämplad att titta på/);
  await decide(card, "Bekräfta felstämplad", "Löparen står kvar som felstämplad");
  await expect(card.getByRole("region", { name: "Historik", exact: true })).toContainText("Felstämpling bekräftad: Felstämplad");
  await expect(card.getByRole("region", { name: "Historik", exact: true })).toContainText("Bekräftelsen borttagen: Felstämplad");

  // Resultaten är klara: Dan har inget resultat. Beskedet säger vem och vad man gör, och "Öppna" visar hans kort.
  for (const path of ["results-official", "remaining-runners", "result-finalizations"]) {
    await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`);
  }
  await openStep(owner, "Resultat");
  const done = owner.getByRole("region", { name: "Resultaten är klara" });
  await expect(done).toContainText("Listorna visas som Preliminära resultat.");
  await expect(done.getByTestId("unconfirmed-mispunched")).toHaveCount(0);
  await done.getByRole("button", { name: "Resultaten är klara", exact: true }).click();
  await expect(done.getByRole("alert")).toContainText("Det här måste ordnas först:");
  await expect(done.getByRole("alert")).toContainText("H21: Dan Borta har inget resultat och kan vara kvar i skogen.");
  await reviewScreenshots(owner, "step38-results-blocked");
  await done.getByRole("button", { name: "Öppna deltagarkortet för Dan Borta" }).click();
  await expect(card.getByRole("heading", { name: "Dan Borta" })).toBeVisible();
  await decide(card, "Ej start", "Löparen visas som ej startande");
  await expect(owner.getByText("Ej start är sparat.")).toBeVisible();

  await openStep(owner, "Resultat");
  await done.getByRole("button", { name: "Resultaten är klara", exact: true }).click();
  await expect(done.getByRole("status").filter({ hasText: "Resultaten är klara. Listorna visar Officiella resultat." })).toBeVisible();

  // Resultatlistan med sträcktider: Cia (Ej fullföljt) har sin tid vid 31 men ingen placering.
  const results = owner.locator(`#workflow-${raceId}-results [data-list]`);
  const resultBar = results.getByRole("toolbar", { name: "Listans verktyg" });
  await resultBar.getByRole("button", { name: "Med sträcktider", exact: true }).click();
  const cia = results.getByRole("table", { name: "H21" }).getByRole("row", { name: /Cia Bryt/ });
  await expect(cia).toContainText("Ej fullföljt");
  await expect(cia).toContainText("12:00");
  await expect(cia.getByRole("cell").first()).toHaveText("");
  await reviewScreenshots(owner, "step38-results-official");
});
