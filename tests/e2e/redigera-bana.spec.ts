import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 8.2–8.4 (ADR-0169): banan ändras efter att en löpare läst ut. Beskedet visar
 * vad som händer, ändringen sparas och resultatet räknas om utan fler steg. Sedan
 * byter klassen bana i Klasser-tabellen och löparen godkänns i deltagarkortet.
 */
test("redigera bana efter avläsning räknar om resultatet", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `bana.${suffix}`, "Kim Klubb");
  const raceId = await createRace(owner, `Banändring ${suffix}`, "2026-10-08", "Liten tävling");
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
  for (const route of ["courses", "classes"]) for (const action of ["edit-preview", "edit"]) {
    await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${route}/${raceId}/${action}`, "POST");
  }
  for (const path of ["approval-candidates", "approval-withdrawals"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`);
  await openStep(owner, "Banor");
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

  // Steg 8.3: klassen H21 flyttas till Kort (31 33) i Klasser-tabellen. Anna har inte 33: beskedet, en bekräftelse, omräkning.
  await addCourseAndClass(owner, "Kort", "D21", "31 33");
  await openStep(owner, "Klasser");
  const classRow = owner.getByRole("row", { name: /H21/ });
  await expect(classRow).toContainText("Lång");
  await expect(classRow).toContainText("Fri start");
  await expect(classRow).toContainText("Alla har läst ut");
  await classRow.getByRole("button", { name: "Redigera H21" }).click();
  const classEditor = owner.getByRole("form", { name: "Redigera H21" });
  await classEditor.getByLabel("Bana").selectOption({ label: "Kort" });
  await classEditor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(classEditor.getByRole("status")).toContainText("1 har läst ut. Efter ändringen: 1 blir felstämplad.");
  await expect(classEditor.getByRole("status")).toContainText("Anna Ek · Godkänd → Felstämplad");
  await classEditor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Klassen är ändrad. 1 resultat räknades om.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /H21/ })).toContainText("Kort");

  // Steg 8.4: deltagarkortet visar resultat, sträcktider och historik; "Ändra status" godkänner Anna manuellt.
  await openStep(owner, "Anmälda");
  await owner.getByRole("row", { name: /Anna Ek/ }).getByRole("cell").nth(1).click();
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(card.getByRole("heading", { name: "Anna Ek" })).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  await expect(card.getByRole("region", { name: "Historik", exact: true })).toContainText("Omräknat: Felstämplad");
  await expect(card.getByRole("region", { name: "Sträcktider", exact: true }).first()).toContainText("31");
  await card.getByLabel("Ändra status").selectOption({ label: "Godkänn manuellt" });
  await expect(card.getByRole("alert")).toContainText("Löparen visas som godkänd trots felstämplingen.");
  await card.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(owner.getByText("Godkännandet är sparat.")).toBeVisible();
  await expect(card.getByRole("region", { name: "Historik", exact: true })).toContainText("Godkänd manuellt: Godkänd");
  await expect.poll(async () => {
    const html = await (await request.get(`/results/${raceId}`)).text();
    return html.includes("Ek") && html.includes("Godkänd manuellt av arrangör");
  }, { timeout: 30_000 }).toBe(true);
});
