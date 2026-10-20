import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, reviewScreenshots, sendReadout, TIME_ZONE, today, unique } from "./helpers";

/**
 * Steg 31 (tävlingsdagens nödlägen för en löpare): i deltagarkortet anger arrangören tid manuellt för en löpare som glömde
 * stämpla mål och för en som tappade brickan (ingen avläsning), godkänner en enskild saknad kontroll med orsak och tar bort
 * den manuella tiden igen (tillbaka till bedömningen från avläsningen).
 */
const clock = (instant: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit",
  second: "2-digit", hourCycle: "h23" }).format(new Date(instant));

async function openCard(owner: Page, name: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return card;
}

test("manuell tid med och utan avläsning, godkänd kontroll och borttagning", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg31.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Natt-KM ${suffix}`, today(), "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Mål", club: "OK Test", card: "7310001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Tappad", club: "OK Test", card: "7310002" });
  await addEntry(owner, { className: "H21", givenName: "Cia", familyName: "Nål", club: "OK Test", card: "7310003" });

  const day = today();
  const at = (time: string) => `${day}T${time}.000Z`;
  // Ada glömde stämpla mål; Cia missade 32 (stämplade med nålen). Bo tappade brickan och läser aldrig ut.
  await sendReadout(owner, raceId, { cardNumber: "7310001", startPunchedAt: at("16:00:00"),
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(`16:${10 + index * 10}:00`) })) });
  await sendReadout(owner, raceId, { cardNumber: "7310003", startPunchedAt: at("16:01:00"), finishPunchedAt: at("16:41:00"),
    punches: [31, 33].map((code, index) => ({ code, punchedAt: at(`16:${11 + index * 20}:00`) })) });
  await owner.reload();
  await openStep(owner, "Anmälda");

  // Ada: Ange tid manuellt med måltiden som klockslag och orsak. Starten från avläsningen behålls.
  let card = await openCard(owner, "Ada Mål");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  await card.getByRole("button", { name: "Ange tid manuellt" }).click();
  await card.getByLabel("Måltid (klockslag, t.ex. 19:42:10)").fill(clock(at("16:45:00")));
  await card.getByLabel("Orsak (krävs)").fill("Glömde stämpla mål");
  await expect(card.getByTestId("manual-time-preview")).toHaveText("Löptid 45:00, godkänd.");
  await reviewScreenshots(owner, "step31-manual-time-form");
  await card.getByRole("button", { name: "Spara manuell tid" }).click();
  await expect(card.getByText("Den manuella tiden är sparad.")).toBeVisible();
  const result = card.getByRole("region", { name: "Resultat", exact: true });
  await expect(result).toContainText("Godkänd");
  await expect(result).toContainText("45:00");
  await expect(result).toContainText("Manuell tid");
  await expect(card.getByTestId("decision-note")).toHaveText("Orsak: Glömde stämpla mål");
  await expect(owner.getByRole("row", { name: /Ada Mål/ })).toContainText("Manuell tid");
  await reviewScreenshots(owner, "step31-manual-time-saved");

  // Ta bort den manuella tiden: tillbaka till bedömningen från avläsningen.
  await card.getByLabel("Ändra status").selectOption({ label: "Ta bort manuell tid" });
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(owner.getByText("Den manuella tiden är borttagen.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");

  // Saknas målet är "Ange tid manuellt" vägen; "Godkänn manuellt" visas inte.
  await expect(card.getByLabel("Ändra status").locator("option", { hasText: "Godkänn manuellt" })).toHaveCount(0);

  // Bo: ingen avläsning. Start och mål anges; status Godkänd.
  card = await openCard(owner, "Bo Tappad");
  await card.getByRole("button", { name: "Ange tid manuellt" }).click();
  await expect(card.getByText("Löparen har ingen avläsning. Tiden blir hela resultatet.")).toBeVisible();
  await card.getByLabel("Måltid (klockslag, t.ex. 19:42:10)").fill(clock(at("16:50:30")));
  await card.getByRole("button", { name: "Spara manuell tid" }).click();
  await expect(card.getByRole("alert")).toContainText("Skriv en orsak.");
  await card.getByLabel("Orsak (krävs)").fill("Tappade brickan");
  await card.getByRole("button", { name: "Spara manuell tid" }).click();
  await expect(card.getByRole("alert")).toContainText("Ange starttid");
  await card.getByLabel("Starttid (klockslag)").fill(clock(at("16:05:00")));
  await expect(card.getByTestId("manual-time-preview")).toHaveText("Löptid 45:30, godkänd.");
  await card.getByRole("button", { name: "Spara manuell tid" }).click();
  await expect(card.getByText("Den manuella tiden är sparad.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("45:30");

  // Cia: godkänn den saknade kontrollen 32 med orsak; inget saknas efteråt, så hon blir godkänd med sin tid.
  card = await openCard(owner, "Cia Nål");
  await expect(card.getByLabel("Ändra status").locator("option", { hasText: "Godkänn manuellt" })).toHaveCount(1);
  await card.getByRole("button", { name: "Godkänn saknade kontroller" }).click();
  await card.getByLabel("Kontroll 32").check();
  await expect(card.getByText("Inget saknas efteråt: löparen blir godkänd med sin tid.")).toBeVisible();
  await card.getByLabel("Orsak (krävs)").fill("Stämplade med nålen");
  await reviewScreenshots(owner, "step31-approve-controls");
  await card.getByRole("button", { name: "Godkänn valda kontroller" }).click();
  await expect(card.getByText("Kontrollerna är godkända.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("40:00");
  await expect(card.getByTestId("decision-note")).toHaveText("Orsak: Stämplade med nålen");

  // Steg 31 B5: på tävlingsdagen varnar avläsningen att övningsstationen skriver riktiga avläsningar.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await expect(owner.getByText("Skriver riktiga avläsningar – inte under pågående tävling")).toBeVisible();
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("exercise-race-day")).toContainText("Övningsstationen skriver riktiga avläsningar");
  await reviewScreenshots(owner, "step31-readout-exercise-warning");
});
