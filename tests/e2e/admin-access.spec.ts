import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, unique } from "./helpers";

/**
 * Steg 1 (ADR-0168): två behörighetsnivåer.
 * Konto → tävling → bana/klass/deltagare → bjud in en administratör →
 * den inbjudna kan arbeta → en utloggad besökare ser publikt men inte admin.
 */

test("konto, tävling, medadministratör och publik vy", async ({ browser, request }) => {
  const suffix = unique();
  const owner = await registerAccount(browser, `anna.${suffix}`, "Anna Arrangör");

  const eventName = `Klubbträning ${suffix}`;
  const raceId = await createRace(owner, eventName);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Eva", familyName: "Löpare", club: "OK Test", card: "8001234" });

  // En annan person registrerar sig men ser ingenting förrän ägaren bjuder in.
  const helperLogin = `bertil.${suffix}`;
  const helper = await registerAccount(browser, helperLogin, "Bertil Hjälpare");
  await expect(helper.getByText("Inga tävlingar ännu")).toBeVisible();
  const helperForbidden = await helper.request.get(`/api/admin/races/${raceId}/administrator/participants`);
  expect(helperForbidden.status()).toBe(401);

  await owner.goto("/organizer");
  await owner.getByText("Visa medadministratörer").click();
  await owner.getByLabel("Befintligt kontos inloggningsnamn").fill(helperLogin);
  await owner.getByRole("button", { name: "Ge eventåtkomst" }).click();
  await expect(owner.getByText("aktiv åtkomst")).toBeVisible();

  await helper.reload();
  await expect(helper.getByText(eventName)).toBeVisible();
  await helper.getByRole("button", { name: "Öppna arbetsytan" }).first().click();
  await helper.waitForURL(/manage$/);
  await openStep(helper, "Anmälda");
  await expect(helper.getByRole("button", { name: "Eva Löpare OK Test" })).toBeVisible();

  // Utloggad besökare: publika sidor fungerar, admin-API nekas.
  const publicResults = await request.get(`/results/${raceId}`);
  expect(publicResults.status()).toBe(200);
  const startList = await request.get(`/starts/${raceId}`);
  expect(startList.status()).toBe(200);
  const adminApi = await request.get(`/api/admin/races/${raceId}/administrator/participants`);
  expect(adminApi.status()).toBe(401);
});
