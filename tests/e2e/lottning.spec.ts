import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, unique } from "./helpers";

/**
 * PLAN.md steg 9: tre klasser lottas på en gång (H21 och D21 har samma första kontroll),
 * förhandsvisningen ser ut som startlistan med vakanta tider, startlistan publiceras med
 * tiderna och en efteranmäld får den vakanta tiden utan att arrangören väljer tid.
 */
test("lotta tre klasser, publicera startlistan och placera en efteranmäld på vakant tid", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `lotta.${suffix}`, "Lo Lottare");
  const raceId = await createRace(owner, `Lottning ${suffix}`);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addCourseAndClass(owner, "Mellan", "D21", "31 34 33");
  await addCourseAndClass(owner, "Kort", "H16", "45 33");
  const clubs = ["OK Ek", "OK Ek", "IFK Lidingö", "Tullinge SK"];
  let card = 8_100_000;
  for (const className of ["H21", "D21", "H16"]) {
    for (const [index, club] of clubs.entries()) {
      await addEntry(owner, { className, givenName: `${className}${"ABCD"[index]}`, familyName: "Löpare", club, card: String(card++) });
    }
  }

  // Start: lottad minutstart för alla tre, första start 10:00, en vakans per klass.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill("10:00");
  for (const className of ["H21", "D21", "H16"]) {
    await draw.getByLabel(`Startsätt ${className}`).selectOption({ label: "Lottad minutstart" });
    await expect(draw.getByLabel(`Lotta ${className}`)).toBeChecked();
    await expect(draw.getByLabel(`Intervall (min) ${className}`)).toHaveValue("2");
    await draw.getByLabel(`Vakanser ${className}`).fill("1");
  }
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  const preview = owner.getByRole("region", { name: "Så blir startlistan" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/H21 har samma första kontroll och startar varannan minut|D21 och H21 har samma första kontroll och startar varannan minut/))
    .toBeVisible();
  for (const className of ["H21", "D21", "H16"]) {
    const section = preview.getByRole("region", { name: className, exact: true });
    await expect(section.getByRole("row")).toHaveCount(6);
    await expect(section.getByText("Vakant", { exact: true })).toHaveCount(1);
  }
  await expect(preview.getByRole("region", { name: "H16", exact: true }).getByRole("row").nth(1)).toContainText("10:00:00");
  const vacantH21 = (await preview.getByRole("region", { name: "H21", exact: true }).getByRole("row", { name: /Vakant/ })
    .getByRole("cell").first().textContent())!.trim();
  expect(vacantH21).toMatch(/^10:\d\d:00$/);
  await preview.getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();

  // Startlistan publiceras och visar de lottade tiderna utan inloggning.
  await owner.getByRole("button", { name: "Visa publicering" }).click();
  await owner.getByRole("button", { name: "Publicera startlistan" }).click();
  await expect(owner.getByText("Startlistan är publicerad.")).toBeVisible();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/starts/${raceId}`);
  await expect(visitor.getByText("H16A Löpare").or(visitor.getByText("H16B Löpare")).first()).toBeVisible();
  await expect(visitor.getByText("10:00:00").first()).toBeVisible();

  // Efteranmäld i H21 får den vakanta tiden; arrangören anger ingen tid.
  await openStep(owner, "Anmälda");
  await owner.getByRole("button", { name: "Ny deltagare" }).click();
  const entryForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Granska anmälan" }) });
  await entryForm.getByLabel("Anmälningsklass").selectOption({ label: "H21" });
  await expect(entryForm.getByText("Klassen är lottad.", { exact: false })).toBeVisible();
  await expect(entryForm.getByLabel("Starttid (klockslag)")).toHaveCount(0);
  await entryForm.getByLabel("Förnamn").fill("Sen");
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill("Anmäld");
  await entryForm.getByLabel("Klubb").fill("OK Ek");
  await entryForm.getByLabel("Bricknummer (valfritt)").fill(String(card++));
  await entryForm.getByRole("button", { name: "Granska anmälan" }).click();
  await expect(owner.getByText("Första lediga vakanta tid i lottningen", { exact: false })).toBeVisible();
  await owner.getByRole("button", { name: "Bekräfta anmälan" }).click();
  await expect(owner.getByText("Deltagaren är anmäld.")).toBeVisible();
  await openStep(owner, "Start");
  await expect(owner.getByRole("row", { name: /Sen Anmäld/ })).toContainText(vacantH21);
});
