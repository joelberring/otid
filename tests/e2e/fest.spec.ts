import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * Steg 40: fest med bardisk, hela kvällen i automatiskt läge i ett fönster. Festen och två varor läggs in, bardisken
 * ansluter övningsstationen och en påhittad gäst checkar in (okänd bricka, namnet skrivs in), stämplar två varor och
 * läser ut (två nya köp), läser ut igen (inga nya köp), stämplar mål (utcheckad). En ny okänd bricka får namnförslag.
 * Arbetsytan visar köpen med summa per person och utcheckningen, och summeringen laddas ner som CSV.
 */
test("fest: bardisken checkar in, verifierar köp och checkar ut med mål", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `fest.${suffix}@exempel.se`, "Fia Fest");
  const raceId = await createRace(owner, `Klubbfest ${suffix}`, today(), "Fest");
  for (const path of ["party-guests", "party-desk-events"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, "POST");

  // Festens start i dag 00:00, så att övningens stämplingar räknas. Två varor med kod och pris.
  const start = owner.getByRole("form", { name: "Festens start" });
  await start.getByLabel("Datum").fill(today());
  await start.getByLabel("Klockslag").fill("00:00");
  await start.getByRole("button", { name: "Spara start" }).click();
  await expect(owner.getByText("Starten är sparad.")).toBeVisible();
  const add = owner.getByRole("form", { name: "Lägg till vara" });
  for (const [code, name, price] of [["31", "Öl", "40"], ["32", "Drink", "60"]] as const) {
    await add.getByLabel("Kod").fill(code);
    await add.getByLabel("Namn").fill(name);
    await add.getByLabel("Pris (kr)").fill(price);
    await add.getByRole("button", { name: "Lägg till vara" }).click();
    await expect(owner.getByLabel(`Vara ${code}: Namn`)).toHaveValue(name);
  }
  await expect(owner.getByRole("link", { name: "Öppna bardisken" }).first()).toHaveAttribute("href", `/admin/${raceId}/readout`);

  // Bardisken: ett fönster, stationens knappar syns tills den är ansluten.
  const desk = await owner.context().newPage();
  await desk.goto(`/admin/${raceId}/readout`);
  await desk.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(desk.getByRole("heading", { name: "Bardisken" })).toBeVisible();
  await expect(desk.getByTestId("package-status")).toContainText("v");
  await desk.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(desk.getByTestId("station-status")).toContainText("Övningsstation");
  const verdict = desk.getByTestId("party-verdict");
  await expect(verdict).toContainText("Stämpla på varans enhet");
  // Kiosk: inga länkar ut ur sidan i automatiskt läge.
  await expect(desk.getByRole("link", { name: "Hantera tävlingen" })).toHaveCount(0);

  // Första utläsningen: incheckning. Okänd bricka: namnrutan, köpet sparas ändå.
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ Välkommen!");
  const nameBox = desk.getByTestId("party-name");
  await nameBox.getByLabel("Förnamn").fill("Festa");
  await nameBox.getByLabel("Efternamn").fill("Påhittsson");
  await nameBox.getByLabel("Klubb (valfritt)").fill("Påhittade OK");
  await nameBox.getByRole("button", { name: "Spara" }).click();
  await expect(nameBox).toHaveCount(0);
  await expect(verdict).toContainText("Inte du? Ändra");

  // Två stämplingar och utläsning: två nya köp och kvällens summa.
  await desk.getByRole("button", { name: "Stämpla 31 (Öl)" }).click();
  await desk.getByRole("button", { name: "Stämpla 32 (Drink)" }).click();
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ 2 nya köp");
  await expect(desk.getByTestId("party-new")).toContainText("Nytt: Öl");
  await expect(desk.getByTestId("party-new")).toContainText("Nytt: Drink");
  await expect(desk.getByTestId("party-total")).toHaveText("Kvällens summa: 100,00 kr");
  await expect(verdict).toContainText("Festa Påhittsson");
  await reviewScreenshots(desk, "fest-bardisk-kop");

  // Samma bricka igen utan nya stämplingar: inga nya köp, samma summa.
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("Inga nya köp");
  await expect(desk.getByTestId("party-total")).toHaveText("Kvällens summa: 100,00 kr");
  await expect(verdict).toContainText("Tidigare i kväll");

  // Målstämpling: utcheckad med alla köp och summan.
  await desk.getByRole("button", { name: "Stämpla mål" }).click();
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText(/^✓ Utcheckad \d\d:\d\d$/);
  await expect(desk.getByTestId("party-total")).toHaveText("Kvällens summa: 100,00 kr");
  await expect(desk.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // En ny okänd bricka: namnrutan föreslår kvällens gäster när man söker.
  await desk.getByRole("button", { name: "Ny gäst (okänd bricka)" }).click();
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ Välkommen!");
  await expect.poll(async () => {
    await nameBox.getByLabel("Sök namn").fill("");
    await nameBox.getByLabel("Sök namn").fill("påhitt");
    return nameBox.getByText("Festa Påhittsson").count();
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await reviewScreenshots(desk, "fest-bardisk-namn");
  await nameBox.getByLabel("Förnamn").fill("Gäst");
  await nameBox.getByLabel("Efternamn").fill("Tvåsson");
  await nameBox.getByRole("button", { name: "Spara" }).click();
  await expect(nameBox).toHaveCount(0);
  await expect(desk.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Arbetsytan: köpen, summa per person, in- och utcheckade och export.
  await owner.bringToFront();
  await expect(owner.getByTestId("party-totals")).toContainText("2 köp · 100,00 kr", { timeout: 20_000 });
  await expect(owner.getByTestId("party-totals")).toContainText("2 incheckade · 1 utcheckade");
  const festa = owner.locator("tr[data-card]").filter({ hasText: "Festa Påhittsson" });
  await expect(festa).toContainText("100,00");
  await expect(festa).toContainText("(mål)");
  await expect(owner.getByTestId("party-purchases")).toContainText("Drink");
  const download = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Ladda ner summering (CSV)" }).click();
  const file = await (await download).path();
  const csv = await readFile(file!, "utf8");
  expect(csv.startsWith("\uFEFFNamn;Klubb;Bricka;Antal köp;Summa kr;Incheckad;Utcheckad;Utcheckad via")).toBe(true);
  expect(csv).toMatch(/Festa Påhittsson;Påhittade OK;\d+;2;100,00;[^;]+;[^;]+;Mål/);

  // Ångra ett köp med orsak: summan räknas om.
  owner.once("dialog", dialog => void dialog.accept("Fel enhet"));
  await owner.getByRole("button", { name: /^Ångra Öl på bricka/ }).click();
  await expect(owner.getByTestId("party-totals")).toContainText("1 köp · 60,00 kr");
  await expect(owner.getByTestId("party-purchases")).toContainText("ångrat: Fel enhet");
});
