import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, sectionButton, unique, warmRoute, type RaceTypeName,
  type SectionName } from "./helpers";

/**
 * Steg 12 (ADR-0170): tävlingstypen styr vilka delar som syns, navigeringen följer med när man rullar och
 * speakern har en egen sida som uppdateras av sig själv.
 */
const ALL: SectionName[] = ["Banor", "Banor & klasser", "Kontroller & poäng", "Klasser", "Klasser & sträckor", "Anmälda", "Deltagare",
  "Lag", "Start", "Avläsning", "Resultat", "Inställningar"];
const EXPECTED: Record<RaceTypeName, SectionName[]> = {
  "Träning": ["Banor & klasser", "Deltagare", "Avläsning", "Resultat", "Inställningar"],
  "Liten tävling": ["Banor", "Klasser", "Anmälda", "Start", "Avläsning", "Resultat", "Inställningar"],
  "Tävling": ["Banor", "Klasser", "Anmälda", "Start", "Avläsning", "Resultat", "Inställningar"],
  "Tävling med gafflade banor": ["Banor", "Klasser", "Anmälda", "Start", "Avläsning", "Resultat", "Inställningar"],
  "Stafett": ["Banor", "Klasser & sträckor", "Lag", "Start", "Avläsning", "Resultat", "Inställningar"],
  "Rogaining": ["Kontroller & poäng", "Deltagare", "Avläsning", "Resultat", "Inställningar"]
};
const SPEAKER: Record<RaceTypeName, boolean> = { "Träning": false, "Liten tävling": false, "Tävling": true,
  "Tävling med gafflade banor": true, "Stafett": true, "Rogaining": false };

test("varje tävlingstyp visar sina delar och inga andra", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `typer.${suffix}`, "Tea Typ");
  for (const type of Object.keys(EXPECTED) as RaceTypeName[]) {
    await owner.goto("/organizer");
    await createRace(owner, `${type} ${suffix}`, "2026-10-08", type);
    const navigation = owner.getByRole("navigation", { name: "Tävlingens delar" });
    await expect(navigation.getByRole("button")).toHaveCount(EXPECTED[type].length);
    for (const name of ALL) await expect(sectionButton(owner, name)).toHaveCount(EXPECTED[type].includes(name) ? 1 : 0);
    await expect(sectionButton(owner, "Inställningar")).toHaveAccessibleDescription(type);
    await expect(owner.getByRole("link", { name: /Öppna speaker/ })).toHaveCount(SPEAKER[type] ? 1 : 0);
    if (type === "Rogaining") await expect(owner.getByText("Inga kontroller ännu")).toBeVisible();
    if (type === "Träning") {
      // Fri start och ingen lottning: inget startsätt att välja när banan och klassen skapas.
      await expect(owner.getByLabel("Startupplägg")).toHaveCount(0);
      await expect(owner.getByRole("region", { name: "Lottning" })).toHaveCount(0);
    }
  }
});

test("typen byts under Inställningar utan att något försvinner, och navigeringen syns när man rullar", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `byt.${suffix}`, "Bo Byt");
  const raceId = await createRace(owner, `Byt typ ${suffix}`, "2026-10-08", "Träning");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Test", card: "8003001" });

  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/settings`, "POST");
  await openStep(owner, "Inställningar");
  await owner.getByRole("radio", { name: "Tävling", exact: true }).check();
  await owner.getByRole("button", { name: "Spara inställningar" }).click();
  await expect(owner.getByText("Inställningarna är sparade.")).toBeVisible();
  await expect(sectionButton(owner, "Start")).toBeVisible();
  await expect(sectionButton(owner, "Banor")).toHaveAccessibleDescription(/1 bana/);
  await expect(sectionButton(owner, "Anmälda")).toHaveAccessibleDescription(/1 anmäld/);
  await expect(owner.getByRole("link", { name: /Öppna speaker/ })).toBeVisible();

  // En lång sida: sidopanelen och toppbalken följer med när man rullar.
  await owner.setViewportSize({ width: 1280, height: 520 });
  await openStep(owner, "Inställningar");
  await owner.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => owner.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" })).toBeInViewport();
  await expect(sectionButton(owner, "Banor")).toBeInViewport();
  await expect(owner.getByRole("heading", { name: `Byt typ ${suffix}` })).toBeInViewport();

  // Mobil: delarna blir en remsa överst som också följer med.
  await owner.setViewportSize({ width: 390, height: 700 });
  await owner.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => owner.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" })).toBeInViewport();
  await expect(sectionButton(owner, "Inställningar")).toHaveAttribute("aria-current", "step");
  expect(await owner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("speakern har en egen sida som visar den som gått i mål", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `speaker.${suffix}`, "Sara Speaker");
  const raceId = await createRace(owner, `Speaker ${suffix}`, "2026-10-08", "Tävling");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Test", card: "8004001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Berg", club: "OK Test", card: "8004002" });

  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await owner.getByLabel("Deltagare").selectOption({ label: "Anna Ek · H21 · 8004001" });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Speakersidan i en egen flik: senast i mål med placering, ledare per klass och kvar i skogen.
  await owner.goto(`/admin/${raceId}/manage`);
  const [speaker] = await Promise.all([owner.context().waitForEvent("page"), owner.getByRole("link", { name: /Öppna speaker/ }).click()]);
  await speaker.waitForURL(`**/admin/${raceId}/speaker`);
  const latest = speaker.getByRole("region", { name: "Senast i mål" });
  await expect(latest).toContainText("Anna Ek");
  await expect(latest).toContainText("1.");
  await expect(speaker.getByRole("region", { name: "Ledare per klass" })).toContainText("Anna Ek");
  await expect(speaker.getByRole("region", { name: "Kvar i skogen" })).toContainText("Bo Berg");
  await expect(owner.getByRole("region", { name: "Speaker" })).toHaveCount(0);
});
