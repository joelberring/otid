import { expect, test } from "@playwright/test";
import { createRace, registerAccount, today, unique } from "./helpers";

/**
 * Mastermind med kontroller från en träning (PR #2): förklaringen överst, valet i sidopanelen (och under Mer i tävlingsraden) öppnar spelets
 * statiska skal med träningens id. Övningsstationen: första utläsningen startar spelet, en gissning med fyra färger får
 * svarta/vita stift, och spelen sparas i webbläsaren per träning. I telefonbredd har skalet den smala raden med Byt funktion.
 */
test("Mastermind med kontroller: från träningen, övningsstationen, en gissning och raden i telefonbredd", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `mastermind.${suffix}@exempel.se`, "Mia Mästare");
  const raceId = await createRace(owner, `Mastermind ${suffix}`, today(), "Träning");

  await owner.getByTestId("nav-mastermind").click();
  await owner.waitForURL(`**/mastermind/index.html#${raceId}`);
  const training = owner.getByTestId("mastermind-training");
  await expect(training).toContainText(`Mastermind ${suffix}`, { timeout: 30_000 });
  await expect(training.getByRole("link", { name: "‹ Till träningen" })).toHaveAttribute("href", `/admin/${raceId}`);

  // Förklaringen är öppen tills något spel finns.
  const about = owner.getByTestId("mastermind-about");
  await expect(about).toHaveAttribute("open", "");
  await expect(about).toContainText("Flera lag kan spela samtidigt");
  await owner.getByRole("button", { name: "Övningsstation" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "är redo" })).toBeVisible({ timeout: 30_000 });
  const practice = owner.getByRole("region", { name: "Övningsstation" });
  await practice.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(owner.getByText("Spelet har startat")).toBeVisible({ timeout: 30_000 });
  for (const code of [31, 32, 33, 34]) await practice.getByRole("button", { name: new RegExp(` ${code}$`) }).click();
  await practice.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(owner.locator(".mm-message")).toContainText(/svarta, \d vita|Knäckt/, { timeout: 30_000 });
  await expect(owner.locator(".mm-row:not(.mm-row-blank):not(.mm-secret)")).toHaveCount(1);

  // Spelen sparas per träning: utan träningens id är listan tom.
  const stored = await owner.evaluate((id) => Object.keys(localStorage).filter(key => key.startsWith("otid.mastermind.v1")).includes(`otid.mastermind.v1.${id}`), raceId);
  expect(stored).toBe(true);

  // Telefonbredd: den smala raden visar Mastermind och Byt funktion leder till träningens övriga val.
  await owner.setViewportSize({ width: 390, height: 844 });
  const bar = owner.getByTestId("race-narrow-bar");
  await expect(bar).toContainText("Mastermind");
  await bar.getByRole("button", { name: "Byt funktion" }).click();
  await expect(owner.getByTestId("race-switch-sheet")).toContainText("Avläsning");
});
