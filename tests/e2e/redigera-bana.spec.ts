import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, registerAccount, unique } from "./helpers";

/**
 * Steg 8.2 (ADR-0169): banan ändras efter att en löpare läst ut. Beskedet visar
 * vad som händer, ändringen sparas och resultatet räknas om utan fler steg.
 */
test("redigera bana efter avläsning räknar om resultatet", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `bana.${suffix}`, "Kim Klubb");
  const raceId = await createRace(owner, `Banändring ${suffix}`);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33 34");
  await addEntry(owner, { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Test", card: "8002001" });

  // Övningsstationen hoppar över den mittersta kontrollen (33): felstämplad.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await owner.getByLabel("Deltagare").selectOption({ label: "Anna Ek · H21 · 8002001" });
  await owner.getByRole("button", { name: "Läs av: missad kontroll" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("FELSTÄMPLAD");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Banor: stryk kontroll 33 i Lång.
  await owner.goto(`/admin/${raceId}/manage`);
  await owner.getByRole("button", { name: "Före tävlingen", exact: true }).first().click();
  await owner.getByRole("button", { name: "Banor", exact: true }).click();
  const row = owner.getByRole("row", { name: /Lång/ });
  await expect(row).toContainText("31 32 33 34");
  await expect(row.getByRole("cell").nth(3)).toHaveText("1");
  await row.getByRole("button", { name: "Redigera Lång" }).click();
  const editor = owner.getByRole("form", { name: "Redigera Lång" });
  await expect(editor.getByLabel("Kontroller i ordning")).toHaveValue("31 32 33 34");
  await editor.getByLabel("Kontroller i ordning").fill("31 32 34");
  await editor.getByRole("button", { name: "Visa vad som händer" }).click();
  await expect(editor.getByRole("status")).toContainText("1 har läst ut. Efter ändringen: 1 blir godkänd.");
  await expect(editor.getByRole("status")).toContainText("Anna Ek · H21 · Felstämplad → Godkänd");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Banan är ändrad. 1 resultat räknades om.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /Lång/ })).toContainText("31 32 34");

  // Publikt resultat utan inloggning: Anna är godkänd.
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    return html.includes("Ek") && html.includes("Godkänd") && !html.includes("Felstämplad");
  }, { timeout: 30_000 }).toBe(true);
});
