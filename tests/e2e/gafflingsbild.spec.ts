import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * Steg 49: en gafflad bana byggs i appen. Banan "Fjäril" (31 50 32 33) får en fjäril på 50 (slingorna 41 42 och 43) och
 * en enkel gaffling på 32–33 (61 eller 62). Bilden visas, ett alternativ ändras till 63, gafflingarna fördelas, två
 * löpare läses av och resultatlistan visar "Visa gafflingar" och sträcktidsanalysen per sträcka.
 */

// Stämplingar som passar alla fyra varianter (båda slingorna i båda ordningarna och båda alternativen).
const allVariants = [31, 50, 41, 42, 50, 43, 50, 41, 42, 50, 32, 61, 63, 33];

async function readOut(page: Page, raceId: string, cardNumber: string, minutes: number) {
  const start = Date.now() - 90 * 60_000;
  await sendReadout(page, raceId, { cardNumber, startPunchedAt: new Date(start).toISOString(),
    finishPunchedAt: new Date(start + (allVariants.length + 1) * minutes * 60_000).toISOString(),
    punches: allVariants.map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * minutes * 60_000).toISOString() })) });
}

test("bygg en gafflad bana i bilden, fördela, läs av och se gafflingarna i resultatlistan", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `bild.${suffix}@exempel.se`, "Bo Bild");
  const raceId = await createRace(owner, `Gafflingsbild ${suffix}`, today(), "Tävling med gafflade banor");
  await publishRace(owner);
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmRoute(owner, `${admin}/courses`);
  await owner.goto(`/admin/${raceId}/manage`);
  await addCourseAndClass(owner, "Fjäril", "D21", "31 50 32 33");
  await addEntry(owner, { className: "D21", givenName: "Ada", familyName: "Ek", club: "OK Skogen", card: "8201001" });
  await addEntry(owner, { className: "D21", givenName: "Ylva", familyName: "Ek", club: "OK Skogen", card: "8201002" });

  // Banor: gaffla banan i bilden. En fjäril på kontroll 50 och en enkel gaffling på sträckan 32–33.
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit-preview`, "POST");
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit`, "POST");
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Gaffla banan Fjäril" }).click();
  const editor = owner.getByRole("form", { name: "Gafflingar på Fjäril" });
  await expect(editor.getByRole("img", { name: /Banbild för Fjäril/ })).toBeVisible();
  await editor.getByRole("button", { name: "Kontroll 50", exact: true }).click();
  await editor.getByRole("button", { name: "Lägg till fjäril på 50" }).click();
  await editor.getByRole("textbox", { name: "Slinga A" }).fill("41 42");
  await editor.getByRole("textbox", { name: "Slinga B" }).fill("43");
  await editor.getByRole("button", { name: "Sträckan 32–33" }).click();
  await editor.getByRole("button", { name: "Lägg till gaffling på 32–33" }).click();
  await editor.getByRole("textbox", { name: "Alternativ C" }).fill("61");
  await editor.getByRole("textbox", { name: "Alternativ D" }).fill("62");
  const generated = editor.getByRole("region", { name: "Varianterna som banan ger" });
  await expect(generated).toContainText("4 varianter");
  await expect(generated).toContainText("AC 31 50 41 42 50 43 50 32 61 33");
  await expect(generated).toContainText("BD 31 50 43 50 41 42 50 32 62 33");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible();
  const course = owner.getByRole("row", { name: /^Fjäril .*Gafflad/ });
  await expect(course).toContainText("Gafflad (4 varianter)");
  await expect(course.getByRole("img", { name: /Banbild för Fjäril/ })).toBeVisible();
  // Utjämnad bana: den enkla gafflingen ger olika sträckor och en varning. Som fulgaffling är det bara en upplysning.
  await expect(course).toContainText("Varianterna har inte samma sträckor");
  await course.getByLabel("Gafflingssätt").selectOption("UNEQUAL");
  await expect(owner.getByText("Banan är en fulgaffling.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /^Fjäril .*Gafflad/ })).toContainText("alternativen är inte utjämnade");

  // Ändra ett alternativ: D blir 63. Varianterna med 62 försvinner och de nya visas direkt.
  await owner.getByRole("button", { name: "Redigera gafflingar på Fjäril" }).click();
  await editor.getByRole("textbox", { name: "Alternativ D" }).fill("63");
  await expect(generated).toContainText("AD 31 50 41 42 50 43 50 32 63 33");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /^Fjäril .*Gafflad/ }).getByRole("row", { name: /^AD 31 50 41 42 50 43 50 32 63 33/ })).toBeVisible();

  // Klasser: fördela gafflingarna.
  await warmRoute(owner, `${admin}/classes/00000000-0000-4000-8000-000000000000/variant-distribution`, "POST");
  await openStep(owner, "Klasser");
  const d21 = owner.getByRole("row", { name: /^D21/ });
  await expect(d21).toContainText("2 saknar variant");
  await d21.getByRole("button", { name: "Fördela gafflingar i D21" }).click();
  await expect(owner.getByText("2 löpare fick en variant.")).toBeVisible();

  // Avläsning: båda godkända på sina varianter.
  await readOut(owner, raceId, "8201001", 2);
  await readOut(owner, raceId, "8201002", 3);

  // Publik resultatlista: varianten under namnet och "Visa gafflingar" med löparens väg i bilden.
  const visitor = await (await browser.newContext()).newPage();
  await expect(async () => {
    await visitor.goto(`/results/${raceId}`);
    await expect(visitor.getByRole("row", { name: /Ylva Ek/ })).toContainText("Godkänd", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  const ada = visitor.getByRole("row", { name: /Ada Ek/ });
  await expect(ada).toContainText(/Variant (AC|AD|BC|BD)/);
  const variant = /Variant (AC|AD|BC|BD)/.exec(await ada.innerText())![1]!;
  await expect(visitor.getByRole("img", { name: /Banbild: Ada Ek/ })).toHaveCount(0);
  await visitor.getByRole("button", { name: "Visa gafflingar: D21" }).click();
  await expect(ada.getByRole("img", { name: `Banbild: Ada Ek sprang variant ${variant}` })).toBeVisible();

  // Deltagarsidan: samma bild, större, med variantens text.
  await ada.getByRole("link", { name: "Ada Ek" }).click();
  await visitor.waitForURL(/\/participants\//);
  await visitor.getByRole("button", { name: "Visa gafflingar", exact: true }).click();
  await expect(visitor.getByRole("img", { name: `Banbild: Ada Ek sprang variant ${variant}` })).toBeVisible();
  await expect(visitor.getByText(`Variant ${variant}`).first()).toBeVisible();

  // Sträcktidsanalysen: per sträcka (kontrollpar) för alla, oavsett variant; per variant som val.
  await visitor.goto(`/results/${raceId}/splits?class=D21`);
  await expect(visitor.getByRole("button", { name: "Per sträcka" })).toHaveAttribute("aria-pressed", "true");
  await expect(visitor.getByRole("columnheader", { name: /50–41/ })).toBeVisible();
  await expect(visitor.getByRole("columnheader", { name: /32–63/ })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "D21", exact: true })).toBeVisible();
  await visitor.getByRole("button", { name: "Per variant" }).click();
  await expect(visitor.getByRole("heading", { name: new RegExp(`D21.*${variant}`) })).toBeVisible();
});
