import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, openStep, registerAccount, unique } from "./helpers";

/**
 * PLAN.md steg 10 (ADR-0169 beslut 2): en gafflad klass importeras från IOF XML
 * (CourseFamily med fyra varianter, anmälningslista och PersonCourseAssignment).
 * Löpare utan variant får en med "Fördela gafflingar". Två löpare läses av med
 * övningsstationen och blir godkända på sina egna varianter; en av dem byter variant
 * i deltagarkortet (besked, bekräftelse, omräkning) och tillbaka. Publika resultat visar varianterna.
 */
const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/iof/${name}`, import.meta.url));

async function importFile(page: Page, name: string, summary: string) {
  await page.getByLabel("IOF XML 3.0").setInputFiles(fixture(name));
  await page.getByRole("button", { name: "Importera atomärt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Importen lagrades" })).toContainText(summary);
}

async function readExercise(page: Page, label: string, name: string, variant: string) {
  await page.getByLabel("Deltagare").selectOption({ label });
  await page.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(page.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(page.getByTestId("verdict")).toContainText(name);
  await expect(page.getByTestId("verdict-variant")).toHaveText(`Variant ${variant}`);
}

test("gafflad klass: import, fördelning, avläsning mot rätt variant och publikt resultat", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `gaffel.${suffix}`, "Gun Gaffel");
  const raceId = await createRace(owner, `Gafflingar ${suffix}`);

  // IOF XML: banor med varianter, anmälda och varianttilldelning per löpare.
  await owner.goto(`/admin/${raceId}/imports`);
  await importFile(owner, "course-data-forked.xml", "2 banor och 2 klasser, 4 varianter");
  await importFile(owner, "entry-list-forked.xml", "7 deltagare");
  await importFile(owner, "course-assignment-forked.xml", "4 löpare fick sin variant");

  // Banor: den gafflade banan med fyra varianter och kontrollföljder.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  const course = owner.getByRole("row", { name: /^Lång Gafflad/ });
  await expect(course).toContainText("Gafflad (4 varianter)");
  await course.getByText("Visa 4 varianter").click();
  await expect(course.getByRole("row", { name: /^AD 31 50 41 42 50 43 44 50 32 60 63 64 60 61 62 60 33/ })).toBeVisible();
  await expect(course.getByRole("button", { name: "Redigera variant BC på Lång" })).toBeVisible();
  await expect(course).not.toContainText("Varianterna täcker inte samma sträckor");

  // Klasser: H21 är gafflad och två löpare saknar variant. Fördelningen sparas direkt.
  await openStep(owner, "Klasser");
  const h21 = owner.getByRole("row", { name: /^H21/ });
  await expect(h21).toContainText("Gafflad (4 varianter)");
  await expect(h21).toContainText("2 saknar variant");
  await h21.getByRole("button", { name: "Fördela gafflingar i H21" }).click();
  await expect(owner.getByText("2 löpare fick en variant.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /^H21/ })).not.toContainText("saknar variant");

  // Startlistan visar variant per löpare i den gafflade klassen.
  await openStep(owner, "Start");
  await expect(owner.getByRole("row", { name: /Cia Holm/ })).toContainText("AD");
  await expect(owner.getByRole("row", { name: /Dan Berg/ })).toContainText("BC");

  // Avläsning: Cia (AD) och Dan (BC) stämplar sina egna varianter och blir godkända.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await readExercise(owner, "Cia Holm · H21 · 8101003", "Cia Holm", "AD");
  await readExercise(owner, "Dan Berg · H21 · 8101004", "Dan Berg", "BC");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Deltagarkortet: Dan byter variant till BD. Resultatet ändras, så beskedet visas först och
  // ändringen räknas om. Tillbaka till BC blir han godkänd igen.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: /Dan Berg/ }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name: "Dan Berg" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const variant = card.getByRole("region", { name: "Variant", exact: true });
  await expect(variant).toContainText("BC");
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");
  await variant.getByLabel("Byt variant").selectOption("BD");
  await expect(variant.getByRole("alert")).toContainText("Dan Berg: Godkänd → Felstämplad");
  await variant.getByRole("button", { name: "Byt variant BD" }).click();
  await expect(owner.getByText("Varianten är ändrad till BD. Resultatet räknades om.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  await variant.getByLabel("Byt variant").selectOption("BC");
  await expect(variant.getByRole("alert")).toContainText("Dan Berg: Felstämplad → Godkänd");
  await variant.getByRole("button", { name: "Byt variant BC" }).click();
  await expect(owner.getByText("Varianten är ändrad till BC. Resultatet räknades om.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");

  // Publikt resultat utan inloggning: Cia och Dan är godkända på sina varianter.
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    return html.includes("Holm") && html.includes("Berg") && html.includes("Variant AD") && html.includes("Variant BC") &&
      (html.match(/Godkänd/g) ?? []).length >= 2;
  }, { timeout: 30_000 }).toBe(true);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  await expect(visitor.getByRole("row", { name: /Cia Holm/ })).toContainText("Godkänd");
  await expect(visitor.getByRole("row", { name: /Cia Holm/ })).toContainText("Variant AD");
  await expect(visitor.getByRole("row", { name: /Dan Berg/ })).toContainText("Godkänd");
  await expect(visitor.getByRole("row", { name: /Dan Berg/ })).toContainText("Variant BC");
});
