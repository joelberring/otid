import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, expectSaved, raceStartedAgo, registerAccount, sendReadout, unique } from "./helpers";

/**
 * Steg 57: placeringen vid avläsningen. Serverns kvitto säger var löparen ligger bland de godkända i klassen
 * ("2:a av 2 i mål · +10:00 efter Ada Ek"), preliminärt. Utan nät står att placeringen kommer när nätet är tillbaka, och
 * den kommer när kön har skickats. Kvittot på papper har samma rad.
 */
async function shot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.getByTestId("verdict").screenshot({ path: `${directory}/placering-${name}.png` });
}

test("placeringen på avläsningens kvitto: tvåa, utan nät, lika tid, ledare och på papperskvittot", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const race = raceStartedAgo(90);
  const owner = await registerAccount(browser, `placering.${suffix}@exempel.se`, "Pia Placering");
  const raceId = await createRace(owner, `Placering ${suffix}`, race.date);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addCourseAndClass(owner, "Mellan", "D21", "31 33");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Ek", club: "OK Ek", card: "8571001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Ek", club: "OK Ek", card: "8571002" });
  await addEntry(owner, { className: "H21", givenName: "Cia", familyName: "Ek", club: "OK Ek", card: "8571003" });
  await addEntry(owner, { className: "D21", givenName: "Dora", familyName: "Ek", club: "OK Ek", card: "8571004" });
  await addEntry(owner, { className: "D21", givenName: "Eva", familyName: "Ek", club: "OK Ek", card: "8571005" });
  // Ada (25:00) och Eva (35:00) är redan avlästa på en annan dator. Övningsstationens brickor har 30:00.
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const run = (cardNumber: string, codes: number[], minutes: number) => ({ cardNumber, startPunchedAt: ago(10 + minutes), finishPunchedAt: ago(10),
    punches: codes.map((code, index) => ({ code, punchedAt: ago(10 + minutes - (index + 1) * 5) })) });
  await sendReadout(owner, raceId, run("8571001", [31, 32, 33], 25));
  await sendReadout(owner, raceId, run("8571005", [31, 33], 35));

  await owner.addInitScript(() => {
    const counter = window as unknown as { otidPrints: number };
    counter.otidPrints = 0;
    window.print = () => { counter.otidPrints += 1; };
  });
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
  const verdict = owner.getByTestId("verdict");
  const placement = owner.getByTestId("verdict-placement");
  const read = async (label: string) => {
    await owner.getByLabel("Deltagare").selectOption({ label });
    await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
    await expect(verdict).toContainText("GODKÄND");
    await expect(verdict).toContainText(label.split(" · ")[0]!);
  };

  // Den andra i mål är tvåa av två, fem minuter efter Ada.
  await read("Bo Ek · H21 · 8571002");
  await expectSaved(owner);
  await expect(placement).toContainText("2:a av 2 i mål · +5:00 efter Ada Ek");
  await expect(placement).toContainText("preliminärt");
  await shot(owner, "godkand-2a");

  // Papperskvittot har samma rad.
  await owner.getByRole("button", { name: "Skriv ut kvitto" }).click();
  await expect(owner.getByTestId("receipt")).toContainText("Preliminärt: 2:a av 2 i mål · +5:00 efter Ada Ek");
  await owner.getByRole("button", { name: "Dölj kvitto" }).click();

  // Utan nät: ingen gammal siffra, bara att placeringen kommer.
  await owner.context().setOffline(true);
  await expect(owner.getByTestId("internet-status")).toContainText("Ej ansluten");
  await read("Cia Ek · H21 · 8571003");
  await expect(placement).toHaveText("Placering visas när nätet är tillbaka.");
  await shot(owner, "utan-nat");

  // Nätet tillbaka: kön skickas och placeringen kommer. Cia har samma tid som Bo: delad andraplats.
  await owner.context().setOffline(false);
  await expectSaved(owner);
  await expect(placement).toContainText("Delad 2:a av 3 i mål · +5:00 efter Ada Ek", { timeout: 30_000 });
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar");

  // Ledaren: Dora är fem minuter före Eva.
  await read("Dora Ek · D21 · 8571004");
  await expectSaved(owner);
  await expect(placement).toContainText("Leder · 5:00 före tvåan");
  await shot(owner, "ledare");
});
