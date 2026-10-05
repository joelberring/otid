import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_EVENTOR_API_KEY, FAKE_EVENTOR_PORT } from "./fake-eventor";
import { createRace, openStep, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 14 (ADR-0170 beslut 4): Eventor och banfiler, med uppdateringar. Klubbens nyckel sparas,
 * tävlingen väljs, klasser och anmälda hämtas, banfilen läses in. När anmälningarna ändras i
 * Eventor visas skillnaderna (ny, ändrad, struken) och godkänns; en ny banfil med ändrad kontroll
 * ger samma besked och omräkning som "Redigera bana". Eventor är en falsk server (fixtures).
 */
const courseFile = (name: string) => fileURLToPath(new URL(`../../fixtures/iof/${name}`, import.meta.url));

async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test("Eventor: koppla, importera, uppdatera med skillnader och läs in ny banfil", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `eventor.${suffix}`, "Eva Eventor");
  const raceId = await createRace(owner, `Höstsprinten ${suffix}`, "2026-10-18", "Tävling");
  const api = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["eventor", "eventor/events", "source-sync"]) await warmRoute(owner, `${api}/${path}`);
  for (const path of ["eventor/test", "eventor/event", "eventor/preview", "course-file/preview", "source-sync/consequence"]) {
    await warmRoute(owner, `${api}/${path}`, "POST");
  }
  await request.post(`http://127.0.0.1:${FAKE_EVENTOR_PORT}/__fixture/entries/entries-1`);

  // Inställningar → Eventor: nyckeln sparas och visas bara som "Nyckel sparad".
  await openStep(owner, "Inställningar");
  const eventor = owner.getByRole("region", { name: "Eventor" });
  await eventor.getByLabel("Klubbens API-nyckel").fill(FAKE_EVENTOR_API_KEY);
  await eventor.getByRole("button", { name: "Spara nyckel" }).click();
  await expect(eventor.getByText("Anslutningen fungerar.")).toBeVisible();
  await expect(eventor.getByText("Nyckel sparad")).toBeVisible();
  await expect(eventor.getByText("Ansluten som OK Skogsfalken")).toBeVisible();
  await expect(owner.locator(`input[value="${FAKE_EVENTOR_API_KEY}"]`)).toHaveCount(0);

  // Välj tävlingen ur klubbens lista.
  await eventor.getByRole("button", { name: "Visa klubbens tävlingar" }).click();
  await eventor.getByLabel("Välj tävling").selectOption({ label: "2026-10-18 · Höstsprinten i Skogsby (individuell)" });
  await eventor.getByRole("button", { name: "Välj", exact: true }).first().click();
  await expect(eventor.getByText("Höstsprinten i Skogsby · 2026-10-18 · individuell · nummer 47110")).toBeVisible();
  await screenshots(owner, "step14-eventor-settings");

  // Första importen: fyra klasser och sex anmälda.
  await eventor.getByRole("button", { name: "Hämta från Eventor" }).click();
  const firstReview = eventor.getByRole("region", { name: "Skillnader mot Eventor" });
  await expect(firstReview).toContainText("10 nya · 0 oförändrade");
  await expect(firstReview).toContainText("Åkesson");
  await firstReview.getByRole("button", { name: "Godkänn 10 ändringar" }).click();
  await expect(eventor.getByText("10 ändringar har sparats.")).toBeVisible();
  await expect(eventor.getByText(/Senast uppdaterad från Eventor \d\d:\d\d/)).toBeVisible();

  // Banor → banfil från OCAD: tre banor, klasserna får sina banor.
  await openStep(owner, "Banor");
  const files = owner.getByRole("region", { name: "Banfil" });
  await files.getByLabel("Banfil (IOF XML)").setInputFiles(courseFile("course-file-1.xml"));
  await files.getByRole("button", { name: "Läs in banfil" }).click();
  const courseReview = files.getByRole("region", { name: "Skillnader mot course-file-1.xml" });
  await expect(courseReview).toContainText("Bana saknas");
  await courseReview.getByRole("button", { name: /^Godkänn \d+ ändringar$/ }).click();
  await expect(files.getByText(/ändringar har sparats/)).toBeVisible();
  await expect(owner.getByRole("row", { name: /Bana 2/ })).toContainText("31 35 33");

  // Anna läser ut rätt på Bana 2.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await owner.getByLabel("Deltagare").selectOption({ label: "Anna Åkesson · D21 · 2101001" });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Anmälningarna ändras i Eventor: ny bricka, klassbyte, en struken och en ny löpare.
  await request.post(`http://127.0.0.1:${FAKE_EVENTOR_PORT}/__fixture/entries/entries-2`);
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Inställningar");
  await eventor.getByRole("button", { name: "Uppdatera från Eventor" }).click();
  const update = eventor.getByRole("region", { name: "Skillnader mot Eventor" });
  await expect(update).toContainText("1 nya · 2 ändrade · 1 strukna · 3 oförändrade");
  await expect(update.getByRole("listitem").filter({ hasText: "Gustav Ek" })).toContainText("Bricka");
  await expect(update.getByRole("listitem").filter({ hasText: "Björn Öberg" })).toContainText("2109999");
  await expect(update.getByRole("listitem").filter({ hasText: "Cecilia Ärlig" })).toContainText("D35");
  await expect(update.getByRole("listitem").filter({ hasText: "Eva Ström" })).toBeVisible();
  await expect(update.getByRole("status")).toContainText("Ingen av ändringarna påverkar resultat.");
  await screenshots(owner, "step14-eventor-diff");
  // Bocka ur och i en rad: beskedet följer urvalet.
  await update.getByRole("checkbox", { name: "Ta med Björn Öberg" }).uncheck();
  await expect(update.getByRole("button", { name: "Godkänn 3 ändringar" })).toBeEnabled();
  await update.getByRole("checkbox", { name: "Ta med Björn Öberg" }).check();
  await update.getByRole("button", { name: "Godkänn 4 ändringar" }).click();
  await expect(eventor.getByText("4 ändringar har sparats.")).toBeVisible();

  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Gustav Ek/ })).toBeVisible();
  await expect(owner.getByRole("row", { name: /Cecilia Ärlig/ })).toContainText("D35");

  // Ny banfil: kontroll 35 i Bana 2 är 38. Anna har läst ut: samma besked som Redigera bana.
  await openStep(owner, "Banor");
  await files.getByLabel("Banfil (IOF XML)").setInputFiles(courseFile("course-file-2.xml"));
  await files.getByRole("button", { name: "Läs in ny banfil" }).click();
  const changed = files.getByRole("region", { name: "Skillnader mot course-file-2.xml" });
  await expect(changed.getByRole("listitem").filter({ hasText: "Bana 2" }).first()).toContainText("31 38 33");
  await expect(changed.getByRole("status")).toContainText("1 har läst ut. Efter ändringen: 1 blir felstämplad.");
  await expect(changed.getByRole("status")).toContainText("Anna Åkesson · D21 · Godkänd → Felstämplad");
  await screenshots(owner, "step14-course-diff");
  await changed.getByRole("button", { name: "Godkänn 1 ändring och räkna om" }).click();
  await expect(files.getByText("1 ändring har sparats, 1 resultat har räknats om.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /Bana 2/ })).toContainText("31 38 33");
});
