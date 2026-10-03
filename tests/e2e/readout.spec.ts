import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, registerAccount, unique } from "./helpers";

/**
 * Steg 4 (ADR-0168): avläsning i webbläsaren som tål nätavbrott.
 * Övningsstationen går genom samma SPORTident-protokoll som en riktig station.
 * Läs av utan nät → ladda om utan nät → kön finns kvar → nätet tillbaka →
 * kön skickas → resultatet syns publikt → okänd bricka kopplas i Hantera.
 */
test("avläsning offline, synk och okänd bricka", async ({ browser, request }) => {
  const suffix = unique();
  const owner = await registerAccount(browser, `las.${suffix}`, "Lisa Avläsare");
  const raceId = await createRace(owner, `Avläsning ${suffix}`);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Eva", familyName: "Löpare", club: "OK Test", card: "8001234" });

  // Öppna avläsningen via adminadressen; den leder till det offlinekapabla skalet.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await expect(owner.getByTestId("internet-status")).toContainText("Ansluten");
  await owner.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });

  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");

  // Utan nät: avläsningen bedöms lokalt och läggs i kön.
  await owner.context().setOffline(true);
  await expect(owner.getByTestId("internet-status")).toContainText("Ej ansluten");
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  const verdict = owner.getByTestId("verdict");
  await expect(verdict).toContainText("GODKÄND");
  await expect(verdict).toContainText("Eva Löpare");
  await expect(verdict).toContainText("30:00");
  await expect(verdict.getByRole("list", { name: "Sträcktider" })).toContainText("7:30");
  await expect(owner.getByTestId("queue-status")).toHaveText("1 väntar");

  // Omladdning utan nät: sidan startar från service worker och kön finns kvar.
  await owner.reload();
  await expect(owner.getByTestId("queue-status")).toHaveText("1 väntar");
  await expect(owner.getByTestId("recent-readouts")).toContainText("8001234");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await owner.getByRole("button", { name: "Läs av: okänd bricka" }).click();
  await expect(verdict).toContainText("OKÄND BRICKA");
  await expect(owner.getByTestId("queue-status")).toHaveText("2 väntar");

  // Nätet tillbaka: kön skickas och servern kvitterar.
  await owner.context().setOffline(false);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  await expect(owner.getByTestId("recent-readouts")).not.toContainText("Väntar");

  const results = await request.get(`/results/${raceId}`);
  expect(results.status()).toBe(200);
  const html = await results.text();
  expect(html).toContain("Löpare");
  expect(html).toContain("30:00");

  // Okänd bricka kopplas till en ny direktanmälan i Hantera tävling.
  await owner.goto(`/admin/${raceId}/manage`);
  await owner.getByRole("button", { name: /Under tävlingen/ }).first().click();
  await owner.getByText("Lös okänd brickavläsning").click();
  // Översikten hämtar okända avläsningar själv för sina räknare.
  await expect(owner.getByLabel("Koppla till")).toBeVisible();
  await owner.getByLabel("Koppla till").selectOption("NEW_ENTRY");
  await owner.getByLabel("Klass för ny deltagare").selectOption({ index: 1 });
  const panel = owner.locator(`#unknown-readout-${raceId}`);
  await panel.getByLabel("Förnamn").fill("Olle");
  await panel.getByLabel("Efternamn").fill("Okänd");
  await owner.getByRole("button", { name: "Granska koppling" }).click();
  await owner.getByRole("button", { name: "Bekräfta koppling och bedömning" }).click();
  await expect.poll(async () => (await request.get(`/results/${raceId}`)).text()).toContain("Okänd");
});
