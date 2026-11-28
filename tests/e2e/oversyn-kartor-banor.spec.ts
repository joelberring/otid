import { fileURLToPath } from "node:url";
import { expect, test, type Locator } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * Översynen av användbarheten 2026-11-17: kartprojekten och banläggningen för en ny användare.
 * - Mina kartprojekt: «Nytt kartprojekt» överst och «Öppna» per projekt; projektets sida visar «Nästa steg» i ordning.
 * - Kartredigeraren i telefonen har en tillbakalänk («‹», 44 px) till projektet.
 * - Banläggningen: panelflikarna heter Utsnitt och Träningsformer (Utskrift är bara sidan), ett grått verktyg säger varför
 *   när man trycker på det, banväljaren klipps inte på datorn och raden överst ryms i 390 px.
 * - Layouten: «Sparade kopior av layouten» och en tillbakapil med text och 44 px tryckyta.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function box(locator: Locator): Promise<{ width: number; height: number }> {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return { width: rect!.width, height: rect!.height };
}

test("översynen: kartprojektens nästa steg och banläggningens namn", async ({ browser }) => {
  test.setTimeout(480_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `oversyn.kartor.${suffix}@exempel.se`, "Kim Kartor");
  await warmRoute(owner, "/organizer/map-projects");
  await warmRoute(owner, "/api/organizer/map-projects");

  // Mina kartprojekt: «Nytt kartprojekt» leder till formulären; ett eget projekt från en kartfil.
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto("/organizer/map-projects");
  await expect(owner.getByTestId("map-projects-new")).toHaveAttribute("href", "#nytt-kartprojekt");
  const upload = owner.getByRole("form", { name: "Nytt kartprojekt från en kartfil" });
  await upload.getByLabel("Projektets namn").fill(`Skogen ${suffix}`);
  await upload.locator("input[type=file]").setInputFiles(fixture("maps/kartfil.omap"));
  await upload.getByRole("button", { name: "Starta projektet" }).click();
  await owner.waitForURL(/\/organizer\/map-projects\/[0-9a-f-]+$/, { timeout: 60_000 });
  const projectPath = new URL(owner.url()).pathname;

  // Nästa steg: underlaget är kartfilen (klart), nästa steg är att rita, banorna kommer sedan.
  const steps = owner.getByTestId("map-project-next");
  await expect(steps.getByRole("heading", { name: "Nästa steg", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(steps.getByTestId("map-project-step-base")).toHaveAttribute("data-done", "true");
  await expect(steps.getByTestId("map-project-step-draw")).toHaveAttribute("data-next", "true");
  await expect(steps.getByTestId("map-project-step-courses")).toContainText("Lägg banor på kartan");
  await expect(steps.getByRole("link", { name: "Öppna kartan" })).toHaveAttribute("href", `${projectPath}/map`);

  // Listan (steg F2): hela raden är länken till projektet, ingen knapp «Öppna» per rad.
  await owner.goto("/organizer/map-projects");
  const row = owner.getByTestId("map-project-row").filter({ hasText: `Skogen ${suffix}` });
  await expect(row.getByRole("link")).toHaveAttribute("href", projectPath);
  await expect(owner.getByTestId("map-projects").getByRole("link", { name: /^Öppna/ })).toHaveCount(0);

  // Kartredigeraren i telefonen: tillbaka till projektet med 44 px tryckyta.
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${projectPath}/map`);
  const back = owner.getByTestId("map-project-back");
  await expect(back).toBeVisible({ timeout: 60_000 });
  await expect(back).toHaveAccessibleName("Till kartprojektet");
  const backBox = await box(back);
  expect(backBox.width).toBeGreaterThanOrEqual(44);
  expect(backBox.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await owner.waitForURL(url => url.pathname === projectPath);

  // Banläggningen.
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto("/organizer");
  const raceId = await createRace(owner, `Översyn banor ${suffix}`, today(), "Träning");
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/layout`);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await expect(owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)")).toBeVisible({ timeout: 120_000 });
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });

  // Samma ord betyder samma sak: Utskrift är sidan (fliken överst), panelfliken heter Tryckyta.
  await expect(owner.getByTestId("course-setting-tab-print")).toHaveText("Utskrift");
  await expect(owner.getByRole("tab", { name: "Tryckyta" })).toBeVisible();
  await expect(owner.getByRole("tab", { name: "Träningsformer" })).toBeVisible();
  await expect(owner.getByRole("tab", { name: /^.?Utskrift$/ })).toHaveCount(0);
  await owner.getByRole("tab", { name: "Tryckyta" }).click();
  await expect(owner.getByRole("heading", { name: /^Utsnitt: / })).toBeVisible();

  // Banväljaren visar hela «Alla kontroller» på datorn.
  const view = owner.getByTestId("course-setting-view");
  await view.selectOption({ label: "Alla kontroller" });
  expect(await view.evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(120);

  // Ett grått verktyg säger varför när man trycker på det.
  const bend = owner.getByRole("button", { name: "Brytpunkt på sträcka" });
  await expect(bend).toHaveAttribute("aria-disabled", "true");
  await bend.click({ force: true });
  await expect(owner.getByText("Brytpunkt på sträcka: välj en bana först.", { exact: false })).toBeVisible();
  await expect(bend).toHaveAttribute("aria-pressed", "false");

  // Raden överst ryms i telefonen.
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.reload();
  const topbar = owner.locator("header").filter({ has: owner.getByTestId("course-setting-back") });
  await expect(topbar).toBeVisible({ timeout: 60_000 });
  expect(await topbar.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  // Layouten: tillbakapilen med text och namn, och «Sparade kopior av layouten».
  await owner.goto(`/admin/${raceId}/course-setting/layout`);
  const layoutBack = owner.getByTestId("layout-back");
  await expect(layoutBack).toBeVisible({ timeout: 60_000 });
  await expect(layoutBack).toHaveAccessibleName("Tillbaka till tävlingen");
  await expect(layoutBack).toContainText("Tävlingen");
  expect((await box(layoutBack)).height).toBeGreaterThanOrEqual(44);
  await expect(owner.getByRole("heading", { name: "Sparade kopior av layouten" })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Spara en kopia" })).toBeVisible();
});
