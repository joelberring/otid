import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, openStep, publishRace, registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * Steg 59 (ADR-0179): kartfilen. En liten syntetisk Mapper-fil (SWEREF 99 TM, 1:10 000) laddas upp under Resultat → Karta och
 * vägval; webbläsaren läser och ritar den och kartan är georefererad direkt ur filen. Banfilen (Purple Pen, samma kartlägen)
 * hamnar på kartan via kartfilens mm. En OCAD-fil provas om fixturen finns (läsaren för OCAD).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function importCourses(owner: Page, raceId: string) {
  await owner.goto(`/admin/${raceId}/imports`);
  await owner.getByLabel("IOF XML 3.0").setInputFiles(fixture("iof/course-file-kartfil.xml"));
  await owner.getByRole("button", { name: "Importera", exact: true }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Filen är inläst" })).toBeVisible();
}

async function uploadMapFile(owner: Page, path: string) {
  const section = owner.getByRole("region", { name: "Karta och vägval" });
  await section.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(path);
  await section.getByRole("button", { name: /Ladda upp kartfil \(OCAD eller Mapper\)|Byt kartfil/ }).click();
  await expect(section.getByText("Kartan är ritad och sparad.")).toBeVisible({ timeout: 60_000 });
  return section;
}

test("kartfilen: Mapper-filen ritas i webbläsaren, georefereras ur filen och banan hamnar på kartan", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartfil.${suffix}@exempel.se`, "Kim Kartfil");
  const raceId = await createRace(owner, `Kartfil ${suffix}`, today(), "Tävling");
  await publishRace(owner);
  const admin = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["map", "map/image", "map/source", "control-map"]) await warmRoute(owner, `${admin}/${path}`);
  await importCourses(owner, raceId);

  // Banor → Kontrollkarta utan karta: hänvisning till kartfilen.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Öppna kontrollkartan" }).click();
  let dialog = owner.getByRole("dialog", { name: "Kontrollkarta" });
  await expect(dialog.getByText(/Ladda upp kartfilen \(OCAD eller Mapper\)/)).toBeVisible();
  await dialog.getByRole("button", { name: "Stäng" }).click();

  // Resultat → Karta och vägval: ladda upp kartfilen. Förloppet visas och sedan raden med kartans uppgifter.
  await openStep(owner, "Resultat");
  const section = await uploadMapFile(owner, fixture("maps/kartfil.omap"));
  await expect(section.getByText("Mapper (Mapper v9)", { exact: false })).toBeVisible();
  await expect(section.getByText("1:10 000")).toBeVisible();
  await expect(section.getByText("SWEREF 99 TM")).toBeVisible();
  await expect(section.getByText("11 objekt")).toBeVisible();
  await expect(section.getByText("Georefererad ur filen")).toBeVisible();
  await expect(section.getByText("Georefererad", { exact: true })).toBeVisible();
  await expect(section.getByText(/Förenklat i bilden: Text ritas med standardtypsnitt/)).toBeVisible();
  // Bilden är ritad (en PNG från webbläsaren) och originalfilen går att hämta för admin.
  const image = await owner.request.get(`${admin}/map/image`);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect((await image.body()).byteLength).toBeGreaterThan(1000);
  const original = await owner.request.get(`${admin}/map/source`);
  expect(original.status()).toBe(200);
  expect((await original.body()).toString("utf8")).toContain("openorienteering.org/apps/mapper");
  await reviewScreenshots(owner, "kartfil-uppladdad");

  // Kontrollkartan: kartbilden under och banan på kartfilens mm (1:10 000, 8 px/mm, 2 mm kant).
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Öppna kontrollkartan" }).click();
  dialog = owner.getByRole("dialog", { name: "Kontrollkarta" });
  await dialog.getByRole("button", { name: "Bana", exact: true }).click();
  const course = dialog.getByRole("img", { name: "Kontrollkarta: Lång" });
  await expect(course).toBeVisible();
  await expect(course.locator("image")).toHaveCount(1);
  await expect(course.locator('[data-control="32"]')).toHaveAttribute("data-tone", "course");
  // Kontroll 32 har kartläget (42, 61) mm: pixeln ((42 + 2) · 8, (102 − 61) · 8) = (352, 328).
  await expect(course.locator('[data-control="32"] circle')).toHaveAttribute("cx", "352");
  await expect(course.locator('[data-control="32"] circle')).toHaveAttribute("cy", "328");
  await expect(dialog.getByText("Banfilen verkar inte vara gjord på den här kartan")).toHaveCount(0);
  await reviewScreenshots(owner, "kartfil-kontrollkarta");
  await dialog.getByRole("button", { name: "Stäng" }).click();

  // Originalfilen lämnas aldrig ut publikt.
  const visitor = await (await browser.newContext()).newPage();
  expect((await visitor.request.get(`${admin}/map/source`)).status()).toBe(401);
  expect([401, 403, 404]).toContain((await visitor.request.get(`/api/public/races/${raceId}/map/source`)).status());

  // Ny kartfil (OCAD) ersätter bilden, om fixturen finns.
  const ocd = fixture("maps/kartfil.ocd");
  if (existsSync(ocd)) {
    await openStep(owner, "Resultat");
    await uploadMapFile(owner, ocd);
    await expect(section.getByText(/^OCAD/)).toBeVisible();
    await expect(section.getByText("Georefererad ur filen")).toBeVisible();
  }
});
