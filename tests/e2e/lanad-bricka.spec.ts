import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, reviewScreenshots, sendReadout, today, unique } from "./helpers";

/**
 * Steg 31 (B4): samma bricka hos två löpare. Ada läser ut; sedan springer Bo med Adas bricka. Den andra avläsningen skriver
 * inte över Adas resultat utan blir en okänd bricka "redan avläst för Ada Först", och kopplas i kontrollvyn till Bo.
 */
test("lånad bricka: den andra avläsningen skriver inte över den förstes resultat", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg31b4.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Natt-KM ${suffix}`, today(), "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Först", club: "OK Test", card: "7320001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Sen", club: "OK Test", card: "7320002" });
  const at = (time: string) => `${today()}T${time}.000Z`;
  const run = (hour: number, minutes: number) => ({ cardNumber: "7320001", startPunchedAt: at(`${hour}:00:00`),
    finishPunchedAt: at(`${hour}:${minutes}:00`), punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(`${hour}:${10 + index * 10}:00`) })) });
  await sendReadout(owner, raceId, run(15, 40));
  await sendReadout(owner, raceId, run(16, 45));
  await owner.reload();

  await openStep(owner, "Avläsning");
  const control = owner.getByRole("region", { name: "Tävlingsdagens kontrollvy" });
  const unknownCards = control.getByRole("region", { name: /Okända brickor/ });
  await expect(unknownCards.getByRole("heading")).toContainText("1");
  await expect(unknownCards.getByTestId("unknown-already-read")).toContainText("Brickan har redan lästs ut för Ada Först");
  await unknownCards.getByLabel("Koppla till").selectOption("EXISTING_ENTRY");
  const entry = unknownCards.locator("label", { hasText: /^Deltagare/ }).locator("select");
  await entry.selectOption(await entry.locator("option", { hasText: "Sen, Bo" }).getAttribute("value"));
  await reviewScreenshots(owner, "step31-borrowed-card");
  await unknownCards.getByRole("button", { name: "Granska koppling" }).click();
  await unknownCards.getByRole("button", { name: "Bekräfta koppling och bedömning" }).click();
  await expect(unknownCards).toContainText("Det finns inga olösta okända avläsningar");

  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Ada Först/ })).toContainText("40:00");
  await expect(owner.getByRole("row", { name: /Bo Sen/ })).toContainText("45:00");
});
