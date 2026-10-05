import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 15 (ADR-0170 beslut 5): rogaining. Kontrollerna läggs in som en bana med klass och tidsgräns, poängen
 * ändras under "Kontroller & poäng", två löpare läses av med övningsstationen (en för sen), avläsningen visar
 * poäng, straff och summa, och resultatlistan sorteras på summa. En ändrad poäng efter avläsning räknas om med besked.
 */
async function readExercise(page: Page, label: string, button: string) {
  await page.getByLabel("Deltagare").selectOption({ label });
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByTestId("verdict")).toContainText(label.split(" · ")[0]!);
}

test("rogaining: poäng, straff och resultatlista på summa", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `poang.${suffix}@exempel.se`, "Rut Rogaining");
  const raceId = await createRace(owner, `Poängjakt ${suffix}`, "2026-10-08", "Rogaining");
  // Besökarna ska se tävlingen (ADR-0172 beslut 4).
  await publishRace(owner);
  for (const path of ["rogaining", "rogaining/preview"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, "POST");

  // Kontrollerna som en bana med klass; tidsgränsen 60 minuter och 1 poäng i straff är förval.
  await addCourseAndClass(owner, "Kontroller", "Rogaining 60", "31 45 52 102");
  const panel = owner.getByRole("form", { name: "Kontroller & poäng" });
  await expect(panel.getByLabel("Poäng för kontroll 31")).toHaveValue("3");
  await expect(panel.getByLabel("Poäng för kontroll 102")).toHaveValue("10");
  await expect(panel.getByLabel("Tidsgräns i minuter för Rogaining 60")).toHaveValue("60");
  await expect(panel.getByLabel("Straff per påbörjad minut för Rogaining 60")).toHaveValue("1");

  // Ingen har läst ut: ändrade poäng och straff sparas direkt.
  await panel.getByLabel("Poäng för kontroll 52").fill("7");
  await panel.getByLabel("Straff per påbörjad minut för Rogaining 60").fill("2");
  await panel.getByRole("button", { name: "Spara poäng och tidsgräns" }).click();
  await expect(owner.getByText("Poängen och tidsgränsen är sparade.")).toBeVisible();
  await expect(panel.getByText("ändrad, förval 5")).toBeVisible();

  await addEntry(owner, { className: "Rogaining 60", givenName: "Ada", familyName: "Ek", club: "OK Poäng", card: "8005001" });
  await addEntry(owner, { className: "Rogaining 60", givenName: "Bo", familyName: "Sen", club: "OK Poäng", card: "8005002" });

  // Avläsning: Ada inom tidsgränsen (3 + 4 + 7 + 10 = 24), Bo 1:30 för sent (två påbörjade minuter, 4 i straff).
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
  await readExercise(owner, "Ada Ek · Rogaining 60 · 8005001", "Läs av: rätt stämplat");
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("verdict-total")).toHaveText("24 poäng");
  await expect(owner.getByTestId("verdict-breakdown")).toContainText("24 p kontroller · inget straff");
  await expect(owner.getByTestId("verdict").getByRole("list", { name: "Räknade kontroller" })).toContainText("102");
  await readExercise(owner, "Bo Sen · Rogaining 60 · 8005002", "Läs av: för sen");
  await expect(owner.getByTestId("verdict-total")).toHaveText("20 poäng");
  await expect(owner.getByTestId("verdict-breakdown")).toContainText("24 p kontroller − 4 p straff");
  await expect(owner.getByTestId("verdict-late")).toContainText("2 påbörjade minuter");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Publik resultatlista: sorterad på summa, Ada före Bo.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const table = visitor.getByRole("table", { name: "Rogaining 60" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row").nth(1)).toContainText("Ada Ek");
  await expect(table.getByRole("row").nth(1)).toContainText("24");
  await expect(table.getByRole("row").nth(2)).toContainText("Bo Sen");
  await expect(table.getByRole("row").nth(2)).toContainText("−4");

  // Efter avläsning: 102 ger 12 poäng. Beskedet visar de nya summorna; sparas efter bekräftelse och räknas om.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Kontroller & poäng");
  await panel.getByLabel("Poäng för kontroll 102").fill("12");
  await panel.getByRole("button", { name: "Spara poäng och tidsgräns" }).click();
  const review = panel.getByRole("status");
  await expect(review).toContainText("2 löpare får ändrat resultat");
  await expect(review).toContainText("Ada Ek · Rogaining 60 · godkänd, 24 p → godkänd, 26 p");
  await panel.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(owner.getByText("Poängen och tidsgränsen är sparade. 2 resultat räknades om.")).toBeVisible();
  await expect.poll(async () => {
    await visitor.reload();
    return (await table.getByRole("row").nth(1).textContent()) ?? "";
  }, { timeout: 30_000 }).toContain("26");
});
