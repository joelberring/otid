import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, registerAccount, unique } from "./helpers";

/**
 * Steg 58: kön räknar avläsningen innan beskedet visas. Servern svarar långsamt (som en belastad CI-maskin eller ett
 * dåligt nät): när beskedet "GODKÄND" syns ska stationen säga "1 väntar", inte ett gammalt "0 väntar". Annars går den
 * som läser av (eller ett test) vidare innan den sista avläsningen har skickats.
 */
test("avläsningen räknas i kön innan beskedet visas, även när servern svarar långsamt", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `ko.${suffix}@exempel.se`, "Kö Kösson");
  const raceId = await createRace(owner, `Kö ${suffix}`);
  await addCourseAndClass(owner, "Kort", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Eva", familyName: "Sjö", club: "OK Ek", card: "8301005" });
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar");

  // Avläsningarna hålls kvar hos servern tills testet släpper dem.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await owner.route("**/administrator/readouts", async route => { await held; await route.continue(); });
  await owner.getByLabel("Deltagare").selectOption({ label: "Eva Sjö · Öppen · 8301005" });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  // Beskedet syns och avläsningen är inte skickad: kön säger det, från första ögonblicket.
  await expect(owner.getByTestId("queue-status")).toHaveText("1 väntar", { timeout: 1_000 });
  release();
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
});

/**
 * Översynen 2026-11-02: servern svarar 503 (omstart, databasen nere). Avläsningen hålls inte åt sidan; statusraden säger
 * att servern inte svarar och att avläsningarna köas, och kön skickas automatiskt när servern svarar igen.
 */
test("när servern inte svarar köas avläsningarna och skickas automatiskt", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `nere.${suffix}@exempel.se`, "Nere Nilsson");
  const raceId = await createRace(owner, `Nere ${suffix}`);
  await addCourseAndClass(owner, "Kort", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Ida", familyName: "Berg", club: "OK Ek", card: "8301006" });
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();

  let down = true;
  let refused = 0;
  await owner.route("**/administrator/readouts", async route => {
    if (!down) return route.continue();
    refused += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ formatVersion: 1, error: "SERVICE_UNAVAILABLE" }) });
  });
  await owner.getByLabel("Deltagare").selectOption({ label: "Ida Berg · Öppen · 8301006" });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("internet-status")).toHaveText("◐ Servern svarar inte", { timeout: 30_000 });
  await expect(owner.getByTestId("queue-status")).toHaveText("1 köas här – skickas när servern svarar");
  await expect(owner.getByTestId("server-down")).toContainText("skickas automatiskt");
  await expect(owner.getByTestId("held-readouts")).toHaveCount(0);
  expect(refused).toBeGreaterThanOrEqual(3);
  down = false;
  // Ingen knapp behövs: nästa automatiska försök skickar kön.
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 45_000 });
  await expect(owner.getByTestId("internet-status")).toHaveText("● Ansluten");
});
