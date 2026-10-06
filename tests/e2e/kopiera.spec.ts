import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, publishRace, registerAccount, sectionButton, unique } from "./helpers";

/**
 * Steg 21 (PLAN.md): "Ny tävling som …" och kvitto vid avläsning. Förra veckans träning kopieras från Mina tävlingar;
 * kopian har banor och klasser men inga deltagare. En löpare anmäls och läses av med övningsstationen i kopian.
 * "Skriv ut kvitto" visar kvittot och startar utskriften; i utskriftsläge syns bara kvittot med sträcktider och
 * QR-kod, inga knappar eller länkar. QR-koden syns också på skärmen.
 */
async function screenshots(page: Page, name: string, widths: readonly number[] = [1280, 390]) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/step21-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** ÅÅÅÅ-MM-DD i webbläsarens (och testets) lokala tid. */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("kopiera förra veckans träning, läs av i kopian och skriv ut kvitto", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const lastWeek = localDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const thisWeek = localDate(new Date());
  const owner = await registerAccount(browser, `kopia.${suffix}@exempel.se`, "Karin Kopia");
  await createRace(owner, `Träning v${suffix}`, lastWeek, "Träning");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33 34");
  await addCourseAndClass(owner, "Kort", "D21", "31 33");
  await addEntry(owner, { className: "H21", givenName: "Förra", familyName: "Veckan", club: "OK Test", card: "8201001" });
  await publishRace(owner);

  // Mina tävlingar: "Kopiera" på loppet öppnar dialogen med samma namn och datumet en vecka senare.
  await owner.goto("/organizer");
  await owner.getByRole("button", { name: "Kopiera Torsdag till en ny tävling" }).click();
  const dialog = owner.getByRole("dialog", { name: "Ny tävling som …" });
  await expect(dialog.getByLabel("Tävlingens namn")).toHaveValue(`Träning v${suffix}`);
  await expect(dialog.getByLabel("Loppets namn")).toHaveValue("Torsdag");
  await expect(dialog.getByLabel("Datum")).toHaveValue(thisWeek);
  await expect(dialog.getByRole("checkbox", { name: /Ta med funktionärer och administratörer/ })).toBeChecked();
  await dialog.getByLabel("Tävlingens namn").fill(`Träning denna vecka ${suffix}`);
  await screenshots(owner, "copy-dialog");
  await dialog.getByRole("button", { name: "Skapa kopian" }).click();
  await expect(dialog.getByRole("status")).toContainText("Kopian är skapad.");
  await expect(dialog.getByRole("status")).toContainText("2 banor · 2 klasser · 4 kontroller");
  await dialog.getByRole("button", { name: "Öppna kopian" }).click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const copyId = owner.url().split("/").at(-2)!;
  await expect(owner.getByRole("heading", { name: `Träning denna vecka ${suffix}` })).toBeVisible();

  // Kopian har banor och klasser men inga deltagare, och är inte publicerad.
  await expect(sectionButton(owner, "Banor & klasser")).toHaveAccessibleDescription(/2 banor · 2 klasser/);
  await expect(sectionButton(owner, "Deltagare")).toHaveAccessibleDescription(/Inga deltagare ännu/);
  await expect(sectionButton(owner, "Publicera")).toHaveAccessibleDescription(/Inte publicerad/);

  // En löpare anmäls och läses av med övningsstationen i kopian. Utskriften fångas (ingen skrivare i testet).
  await addEntry(owner, { className: "H21", givenName: "Nya", familyName: "Veckan", club: "OK Test", card: "8201002" });
  await owner.addInitScript(() => {
    const counter = window as unknown as { otidPrints: number };
    counter.otidPrints = 0;
    window.print = () => { counter.otidPrints += 1; };
  });
  await owner.goto(`/admin/${copyId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${copyId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
  await owner.getByLabel("Deltagare").selectOption({ label: "Nya Veckan · H21 · 8201002" });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  const verdict = owner.getByTestId("verdict");
  await expect(verdict).toContainText("GODKÄND");
  await expect(verdict).toContainText("Nya Veckan");

  // QR-koden på skärmen leder till löparens publika resultat i kopian.
  const screenQr = owner.getByTestId("screen-qr");
  await expect(screenQr).toContainText("Skanna för dina resultat");
  await expect(screenQr.getByTestId("qr-code")).toHaveAttribute("data-url", new RegExp(`/results/${copyId}/participants/[0-9a-f-]{36}$`));
  await expect(screenQr).toContainText("Resultatsidan syns när tävlingen publiceras.");
  await screenshots(owner, "readout-verdict");

  // "Skriv ut kvitto": kvittot visas och utskriften startar.
  await owner.getByRole("button", { name: "Skriv ut kvitto" }).click();
  const receipt = owner.getByTestId("receipt");
  await expect(receipt).toBeVisible();
  await expect.poll(() => owner.evaluate(() => (window as unknown as { otidPrints: number }).otidPrints)).toBe(1);
  await expect(receipt).toContainText(`Träning denna vecka ${suffix}`);
  await expect(receipt).toContainText("Nya Veckan");
  await expect(receipt).toContainText("H21 · OK Test");
  await expect(receipt).toContainText("GODKÄND");
  const splits = receipt.getByRole("table");
  await expect(splits.getByRole("row")).toHaveCount(1 + 4 + 1);
  for (const code of ["31", "32", "33", "34", "Mål"]) await expect(splits).toContainText(code);
  await expect(receipt.getByTestId("qr-code")).toBeVisible();
  await screenshots(owner, "receipt-preview");

  // Utskriftsläge: bara kvittot, inga knappar, länkar eller statusrad.
  await owner.emulateMedia({ media: "print" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByRole("table")).toContainText("Mål");
  await expect(receipt.getByTestId("qr-code")).toBeVisible();
  for (const name of ["Skriv ut kvitto", "Koppla från station", "Ladda ner rålogg", "Dölj kvitto"]) {
    await expect(owner.getByRole("button", { name })).toBeHidden();
  }
  await expect(owner.getByRole("link", { name: "Hantera tävling" })).toBeHidden();
  await expect(owner.getByTestId("station-status")).toBeHidden();
  await expect(verdict).toBeHidden();
  await screenshots(owner, "receipt-print", [302]);
  await owner.emulateMedia({ media: "screen" });

  // Automatisk utskrift (per enhet): nästa godkända avläsning skrivs ut utan knapptryck.
  await owner.getByRole("checkbox", { name: "Skriv ut kvitto automatiskt" }).check();
  await expect.poll(() => owner.evaluate(() => (window as unknown as { otidPrints: number }).otidPrints)).toBe(1);
  await owner.getByRole("button", { name: "Läs av: missad kontroll" }).click();
  await expect(verdict).toContainText("FELSTÄMPLAD");
  await expect.poll(() => owner.evaluate(() => (window as unknown as { otidPrints: number }).otidPrints)).toBe(2);
  await expect(receipt).toContainText("FELSTÄMPLAD");
  await expect(receipt).toContainText("Saknar:");
});
