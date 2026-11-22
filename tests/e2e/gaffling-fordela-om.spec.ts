import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, unique } from "./helpers";

/**
 * Fel 2026-11-22 (ägarens SBN-test): en ojämn gaffling ger en begriplig varning med knappen "Fördela om jämnt", som visar
 * vilka löpare som byter variant innan något sparas. Fyra löpare på en bana med en gaffling (A 41, B 42) blir 2–2; en byts
 * för hand till A (3–1) och knappen jämnar ut det igen.
 */
const CLASS = "Superion herr";
const COURSE = "Superion";

test("ojämn gaffling: begriplig varning och Fördela om jämnt med namn före och efter", async ({ browser }) => {
  const suffix = unique();
  const owner = await registerAccount(browser, `fordela.${suffix}@exempel.se`, "Fia Fördelare");
  const raceId = await createRace(owner, `Fördela om ${suffix}`);
  await addCourseAndClass(owner, COURSE, CLASS, "31 40 50 100");
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: `Gaffla banan ${COURSE}` }).click();
  const editor = owner.getByRole("form", { name: `Gafflingar på ${COURSE}` });
  await editor.getByRole("button", { name: "Sträckan 40–50" }).click();
  await editor.getByRole("button", { name: "Lägg till gaffling på 40–50" }).click();
  await editor.getByRole("textbox", { name: "Alternativ A" }).fill("41");
  await editor.getByRole("textbox", { name: "Alternativ B" }).fill("42");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible({ timeout: 30_000 });

  const names = ["Ada", "Bo", "Cia", "Dan"];
  for (const [index, given] of names.entries()) {
    await addEntry(owner, { className: CLASS, givenName: given, familyName: "Ek", club: "OK Ek", card: String(8_620_001 + index) });
  }
  await openStep(owner, "Banor");
  const course = owner.getByRole("row", { name: new RegExp(`^${COURSE} .*Gafflad`) });
  await expect(course.getByTestId("forking-readiness")).toHaveText("Klar för start: alla 2 varianter har löpare och fördelningen är jämn.");

  // En löpare på B byts för hand till A: 3–1.
  await openStep(owner, "Anmälda");
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  let moved = "";
  for (const given of names) {
    await expect(async () => {
      await owner.getByRole("row", { name: new RegExp(`${given} Ek`) }).getByRole("cell").nth(1).click();
      await expect(card.getByRole("heading", { name: `${given} Ek` })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const variant = card.getByRole("region", { name: "Variant", exact: true });
    if ((await variant.getByRole("heading").textContent())?.includes("B")) {
      await variant.getByLabel("Byt variant").selectOption("A");
      await expect(owner.getByText("Varianten är ändrad till A.")).toBeVisible();
      moved = given;
      break;
    }
  }
  expect(moved).not.toBe("");

  await openStep(owner, "Banor");
  await expect(course.getByTestId("forking-readiness"))
    .toHaveText("Se över före start: Superion herr är ojämnt fördelad vid gaffling 1 (3 på A, 1 på B)");
  await course.getByRole("button", { name: `Fördela om varianterna jämnt i ${CLASS}` }).click();
  const review = owner.getByTestId("rebalance-review");
  await expect(review).toContainText(`1 löpare i ${CLASS} byter variant`);
  await expect(review).toContainText(/ Ek: A → B/);
  await expect(review).toContainText("Avlästa löpare behåller sin variant.");
  await review.getByRole("button", { name: "Byt varianterna" }).click();
  await expect(owner.getByText("1 löpare bytte variant.")).toBeVisible();
  await expect(course.getByTestId("forking-readiness")).toHaveText("Klar för start: alla 2 varianter har löpare och fördelningen är jämn.");
  expect(raceId).toBeTruthy();
});
