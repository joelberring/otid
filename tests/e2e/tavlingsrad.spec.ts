import { expect, test, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmRoute } from "./helpers";

/**
 * Tävlingsraden (ägaren 2026-11-18, ADR-0227 tillägg): i telefonbredd inne i en tävling byts flikraden (Hem, Kartor …) mot
 * tävlingens rad. På tävlingsdagen väljs Tävlingsdag automatiskt; växeln byter till Förbereda och valet håller medan man rör sig
 * i arrangemanget. Mer har resten, «‹ Mitt O-Tid» leder ut, och avläsningen har bara den smala raden med Byt funktion. På datorn
 * syns ingen av dem och arbetsytans sidopanel är kvar.
 */
async function shot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

async function tapTargets(page: Page, selector: string) {
  for (const target of await page.locator(selector).all()) {
    const box = (await target.boundingBox())!;
    expect(box.height, selector).toBeGreaterThanOrEqual(44);
    expect(box.width, selector).toBeGreaterThanOrEqual(44);
  }
}

test("Tävlingsraden: tävlingens flikar i telefonbredd, växeln, Mer, vägen ut och avläsningens smala rad", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `tavlingsrad.${suffix}@exempel.se`, "Rut Rad");
  // Utvecklingsserverns egen knapp (nere till vänster) ligger över raden; den finns inte i drift.
  await owner.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style"); style.textContent = "nextjs-portal { display: none !important; }"; document.head.append(style);
  }));
  const raceId = await createRace(owner, `Radtävling ${suffix}`, today(), "Tävling");
  await warmRoute(owner, `/admin/${raceId}/maps`);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/navigation`);
  await warmRoute(owner, `/admin/${raceId}/speaker`);
  const bar = owner.getByTestId("race-tabs");
  const tabs = bar.locator("[data-tab]");

  // Telefonen på tävlingsdagen: Tävlingsdag är valt, tävlingens rad i stället för Hem, Kartor …, och ingen remsa eller Meny.
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(bar).toBeVisible();
  await expect(owner.getByTestId("app-tabs")).toHaveCount(0);
  await expect(tabs).toHaveText(["Avläsning", "Sekretariat", "Resultat", "Speaker", "Mer"]);
  await expect(owner.getByTestId("race-mode-switch").getByRole("button", { name: "Tävlingsdag" })).toHaveAttribute("aria-pressed", "true");
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" })).toBeHidden();
  await expect(owner.getByText("Meny", { exact: true })).toBeHidden();
  await tapTargets(owner, '[data-testid="race-tabs"] [data-tab]');
  await tapTargets(owner, '[data-testid="race-mode-switch"] button');
  await expect(owner.getByRole("link", { name: /Mitt O-Tid/ }).first()).toBeVisible();

  // Sekretariat är arbetsytans kontrollvy (kvar i skogen, okända brickor, felstämplade, direktanmälan).
  await bar.locator('[data-tab="secretariat"]').click();
  await expect(bar.locator('[data-tab="secretariat"]')).toHaveAttribute("aria-current", "page");
  await expect(owner.locator(`#workflow-${raceId}-readout`)).toBeVisible();
  await shot(owner, "tavling-tavlingsdag-390");

  // Växeln: Förbereda byter rad, och valet håller vid omladdning och på arrangemangets andra sidor.
  await owner.getByTestId("race-mode-switch").getByRole("button", { name: "Förbereda" }).click();
  await expect(tabs).toHaveText(["Banor", "Klasser", "Anmälda", "Start", "Mer"]);
  await bar.locator('[data-tab="classes"]').click();
  await expect(bar.locator('[data-tab="classes"]')).toHaveAttribute("aria-current", "page");
  await shot(owner, "tavling-forbereda-390");
  await owner.reload();
  await expect(tabs).toHaveText(["Banor", "Klasser", "Anmälda", "Start", "Mer"]);
  await owner.goto(`/admin/${raceId}/maps`);
  await expect(owner.getByTestId("race-top")).toBeVisible();
  await expect(tabs).toHaveText(["Banor", "Klasser", "Anmälda", "Start", "Mer"]);
  await expect(bar.locator('[data-tab="start"]')).toHaveAttribute("aria-current", "page");
  await expect(owner.getByTestId("race-top").getByRole("link", { name: "Tillbaka till Mitt O-Tid" })).toBeVisible();
  await shot(owner, "tavling-kartor-overrad-390");
  await bar.locator('[data-tab="courses"]').click();
  await owner.waitForURL(/\/manage\?del=banor$/);
  await expect(bar.locator('[data-tab="courses"]')).toHaveAttribute("aria-current", "page");
  await expect(owner.locator('[data-authenticated="true"]')).toBeVisible();

  // Mer: allt övrigt i arrangemanget, också det som tidigare bara fanns i Meny och remsan.
  await bar.locator('[data-tab="more"]').click();
  const more = owner.getByTestId("race-more");
  await expect(more).toBeVisible();
  await expect(more.locator("a[data-item] strong")).toHaveText(["Publicera", "Sekretariat", "Resultat", "Avläsning", "Speaker",
    "Banläggning", "Personer", "Inställningar"]);
  await expect(more.getByRole("button", { name: "Uppdatera översikten" })).toBeVisible();
  await shot(owner, "tavling-mer-390");
  await more.locator('a[data-item="people"]').click();
  await expect(more).toBeHidden();
  await expect(bar.locator('[data-tab="more"]')).toHaveAttribute("data-active", "true");
  await expect(owner.getByRole("list", { name: "Personer med behörighet" })).toBeVisible();

  // Speakern: bara den smala raden, med samma val under Byt funktion.
  await owner.goto(`/admin/${raceId}/speaker`);
  await expect(owner.getByTestId("race-narrow-bar")).toContainText("Speaker");
  await expect(owner.getByTestId("race-tabs")).toHaveCount(0);
  await shot(owner, "speaker-smal-rad-390");
  await owner.goto(`/admin/${raceId}/manage`);

  // Avläsningen: bara den smala raden med funktionens namn och Byt funktion, som har samma val.
  await owner.getByTestId("race-mode-switch").getByRole("button", { name: "Tävlingsdag" }).click();
  await bar.locator('[data-tab="readout"]').click();
  await owner.waitForURL(/\/readout\/index\.html#/);
  const narrow = owner.getByTestId("race-narrow-bar");
  await expect(narrow).toBeVisible();
  await expect(narrow).toContainText("Avläsning");
  await expect(owner.getByTestId("race-tabs")).toHaveCount(0);
  await tapTargets(owner, '[data-testid="race-narrow-bar"] button');
  await expect(owner.getByTestId("verdict")).toBeVisible();
  await shot(owner, "avlasning-smal-rad-390");
  await narrow.getByRole("button", { name: "Byt funktion" }).click();
  const sheet = owner.getByTestId("race-switch-sheet");
  await expect(sheet.locator('a[data-item="secretariat"]')).toBeVisible();
  await expect(sheet.locator('a[data-item="readout"]')).toHaveAttribute("aria-current", "page");
  await expect(sheet.locator("a[data-item] strong").first()).toHaveText("Avläsning");
  await shot(owner, "avlasning-byt-funktion-390");
  await sheet.locator('a[data-item="secretariat"]').click();
  await owner.waitForURL(/\/manage\?del=avlasning$/);
  await expect(bar.locator('[data-tab="secretariat"]')).toHaveAttribute("aria-current", "page");

  // Vägen ut: «‹ Mitt O-Tid» leder till Mitt O-Tid, där den vanliga flikraden är tillbaka.
  await owner.getByRole("link", { name: /Mitt O-Tid/ }).first().click();
  await owner.waitForURL(/\/organizer$/);
  await expect(owner.getByTestId("app-tabs")).toBeVisible();
  await expect(owner.getByTestId("race-tabs")).toHaveCount(0);

  // En träning: tävlingsdagen utan Speaker.
  await owner.setViewportSize({ width: 1280, height: 900 });
  const trainingId = await createRace(owner, `Radträning ${suffix}`, today(), "Träning");
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(tabs).toHaveText(["Avläsning", "Sekretariat", "Resultat", "Mer"]);
  await shot(owner, "traning-tavlingsdag-390");
  await owner.getByTestId("race-mode-switch").getByRole("button", { name: "Förbereda" }).click();
  await expect(tabs).toHaveText(["Banor", "Deltagare", "Publicera", "Mer"]);
  await shot(owner, "traning-forbereda-390");

  // Datorn: ingen av raderna, ingen växel; sidopanelen är kvar.
  await owner.setViewportSize({ width: 1280, height: 900 });
  await expect(owner.getByTestId("race-tabs")).toBeHidden();
  await expect(owner.getByTestId("race-mode-switch")).toBeHidden();
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" })).toBeVisible();
  await owner.goto(`/readout/index.html#${trainingId}`);
  await expect(owner.getByTestId("verdict")).toBeVisible();
  await expect(owner.getByTestId("race-narrow-bar")).toBeHidden();
});
