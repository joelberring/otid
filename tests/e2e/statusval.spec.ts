import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, reviewScreenshots, sendReadout, today,
  unique } from "./helpers";

/**
 * Steg 35 (önskemål efter en skarp klubbtävling): fler statusval än brutit och ej start. Från Kvar i skogen öppnar
 * arrangören deltagarkortet för den som sprang utan bricka och väljer "Deltog utan tid"; en annan springer utom tävlan
 * (behåller tiden) och en tredje diskvalificeras med orsak. Resultatlistan visar dem utan placering och "Deltog" sist.
 * "Ta bort deltog utan tid" ger tillbaka bedömningen (här: inget resultat).
 */
async function decide(owner: Page, option: string, saved: string, reason?: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await card.getByLabel("Ändra status").selectOption({ label: option });
  if (reason !== undefined) await card.getByLabel("Orsak (valfritt)").fill(reason);
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(owner.getByText(saved)).toBeVisible();
  return card;
}

async function openCard(owner: Page, name: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return card;
}

test("fler statusval: deltog utan tid, utom tävlan och disk med och utan avläsning", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg35.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Klubbtävling ${suffix}`, today(), "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Snabb", club: "OK Test", card: "7350001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Utanbricka", club: "OK Test", card: "7350002" });
  await addEntry(owner, { className: "H21", givenName: "Cia", familyName: "Gäst", club: "OK Test", card: "7350003" });
  await addEntry(owner, { className: "H21", givenName: "Dan", familyName: "Genväg", club: "OK Test", card: "7350004" });
  await publishRace(owner);

  const at = (time: string) => `${today()}T${time}.000Z`;
  for (const [card, start, minutes] of [["7350001", "16:00", 30], ["7350003", "16:01", 25], ["7350004", "16:02", 20]] as const) {
    const startAt = Date.parse(at(`${start}:00`));
    const iso = (offset: number) => new Date(startAt + offset * 60_000).toISOString();
    await sendReadout(owner, raceId, { cardNumber: card, startPunchedAt: iso(0), finishPunchedAt: iso(minutes),
      punches: [{ code: 31, punchedAt: iso(minutes / 3) }, { code: 32, punchedAt: iso((2 * minutes) / 3) }] });
  }
  await owner.reload();

  // Kvar i skogen: Bo sprang utan bricka. "Öppna" ger hans deltagarkort, där alla val finns även utan avläsning.
  await openStep(owner, "Avläsning");
  const control = owner.getByRole("region", { name: "Tävlingsdagens kontrollvy" });
  await control.getByRole("button", { name: "Uppdatera" }).click();
  await expect(owner.getByTestId("in-forest-count")).toHaveText("1");
  const forest = control.getByRole("region", { name: /Kvar i skogen/ });
  await reviewScreenshots(owner, "step35-in-forest");
  await forest.getByRole("button", { name: "Öppna Bo Utanbricka" }).click();
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(card.getByRole("heading", { name: "Bo Utanbricka" })).toBeVisible();
  await expect(card.getByLabel("Ändra status").locator("option")).toHaveText(["Välj …", "Ej start", "Brutit", "Diskvalificera",
    "Utom tävlan", "Deltog utan tid", "Räkna om från avläsningen"]);
  await card.getByLabel("Ändra status").selectOption({ label: "Deltog utan tid" });
  await expect(card.getByText("Löparen visas som Deltog, sist i klassen, utan tid och placering.", { exact: false })).toBeVisible();
  await reviewScreenshots(owner, "step35-status-choice");
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(owner.getByText("Deltog utan tid är sparat.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Deltog");
  await expect(card.getByRole("region", { name: "Historik" })).toContainText("Deltog utan tid");

  // Utom tävlan behåller tiden; disk med orsak (syns bara i arbetsytan).
  await openStep(owner, "Anmälda");
  await openCard(owner, "Cia Gäst");
  await decide(owner, "Utom tävlan", "Utom tävlan är sparat.");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Utom tävlan");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("25:00");
  await openCard(owner, "Dan Genväg");
  await decide(owner, "Diskvalificera", "Diskvalificeringen är sparad.", "Genade över tomten");
  await expect(card.getByTestId("dsq-reason")).toHaveText("Orsak: Genade över tomten");
  await reviewScreenshots(owner, "step35-card-decided");

  // Kvar i skogen är tomt: ett beslut räknas som i mål.
  await openStep(owner, "Avläsning");
  await control.getByRole("button", { name: "Uppdatera" }).click();
  await expect(owner.getByTestId("in-forest-count")).toHaveText("0");

  // Publikt: placering bara för Ada; Deltog sist, utan tid.
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    const order = ["Snabb", "Genväg", "Gäst", "Utanbricka"].map(name => html.indexOf(name));
    return order.every(index => index > 0) && order.every((index, i) => i === 0 || index > order[i - 1]!) &&
      html.includes("Utom tävlan") && html.includes("Deltog") && !html.includes("Genade");
  }, { timeout: 30_000 }).toBe(true);
  const visitor = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await visitor.goto(`/results/${raceId}`);
  await expect(visitor.getByText("Deltog", { exact: true })).toBeVisible();
  await reviewScreenshots(visitor, "step35-public-results");
  await visitor.close();

  // Tillbaka till bedömningen: Bo har ingen avläsning och får inget resultat; han är kvar i skogen igen.
  await openStep(owner, "Anmälda");
  await openCard(owner, "Bo Utanbricka");
  await card.getByLabel("Ändra status").selectOption({ label: "Ta bort deltog utan tid" });
  await expect(card.getByText("Beslutet tas bort. Löparen har ingen avläsning och får inget resultat.")).toBeVisible();
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(owner.getByText("Beslutet om deltog utan tid är återtaget.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).not.toContainText("Deltog");
});
