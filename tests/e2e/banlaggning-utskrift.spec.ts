import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * Steg 64 (ADR-0180 beslut 11): banpåtryck och utskrift. Kartfilen och en .ppen läses in; på banan Lång ritas ett förbjudet
 * område (tre hörn och Klar) och beskrivningen läggs på kartan; i fliken Utskrift väljs A4 liggande och 1:10 000; sparat
 * i dokumentet. Förhandsvisningen visar sidan med kartan, området, beskrivningen och raden om att det är ett utkast.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function clickMap(page: Page, map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  await page.mouse.click(box.x + box.width / 2 + (x - centerX) * scale, box.y + box.height / 2 - (y - centerY) * scale);
}

type Special = { id: string; kind: string; points: { x: number; y: number }[]; courses: string[] };
type Document = { courses: { id: string; name: string; printScale?: number; printArea?: { page?: { width: number; height: number; landscape: boolean } } }[];
  specialObjects: Special[] };

test("banläggning-utskrift: förbjudet område, beskrivningen på kartan, A4 liggande 1:10 000 och förhandsvisningen", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `utskrift.${suffix}@exempel.se`, "Uno Utskrift");
  const raceId = await createRace(owner, `Utskrift ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-center", /,/);

  // Fliken Objekt: ett förbjudet område med tre hörn och Klar.
  await owner.getByRole("tab", { name: "Objekt" }).click();
  const objects = owner.getByTestId("course-setting-specials");
  await objects.getByRole("button", { name: "Förbjudet område" }).click();
  await expect(owner.getByRole("button", { name: /Specialobjekt/ })).toHaveAttribute("aria-pressed", "true");
  await clickMap(owner, map, 60, 18);
  await clickMap(owner, map, 78, 18);
  await clickMap(owner, map, 70, 32);
  await expect(objects.getByRole("status")).toHaveText(/3 punkter utsatta/);
  await objects.getByRole("button", { name: "Klar" }).click();
  await expect(owner.getByTestId("course-setting-special")).toHaveAttribute("data-kind", "out-of-bounds");

  // Beskrivningen på kartan med ett klick (bara på banan).
  await objects.getByRole("button", { name: "Beskrivningen på kartan" }).click();
  await clickMap(owner, map, 56, 44);
  await expect(owner.getByTestId("course-setting-special")).toHaveAttribute("data-kind", "descriptions");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await owner.keyboard.press("Escape");

  // Fliken Utskrift: A4 liggande, 1:10 000.
  await owner.getByRole("tab", { name: "Utskrift" }).click();
  const print = owner.getByTestId("course-setting-print");
  await print.getByLabel("Papper").selectOption("A4");
  await print.getByLabel("Riktning").selectOption("landscape");
  await print.getByTestId("course-setting-print-scale").selectOption("10000");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await reviewScreenshots(owner, "banlaggning-utskrift-editor");

  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const document = state.setting.document;
  const course = document.courses.find(item => item.name === "Lång")!;
  expect(course.printScale).toBe(10000);
  expect(course.printArea?.page).toMatchObject({ width: 827, height: 1169, landscape: true });
  const area = document.specialObjects.find(item => item.kind === "out-of-bounds")!;
  expect(area.points).toHaveLength(3);
  expect(area.courses).toEqual([]);
  expect(document.specialObjects.find(item => item.kind === "descriptions")!.courses).toEqual([course.id]);

  // Förhandsvisningen: en A4 liggande med kartan, området och beskrivningen.
  await print.getByRole("button", { name: "Förhandsvisning och utskrift" }).click();
  await owner.waitForURL(`**/admin/${raceId}/course-setting/print?course=${course.id}`);
  await expect(owner.getByTestId("print-draft")).toContainText("färgerna är inte tryckkvalitet");
  const sheet = owner.getByTestId("print-sheet");
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  await expect(sheet).toHaveAttribute("width", /^296\.9\d*mm$/);
  await expect(sheet).toHaveAttribute("data-scale", "10000");
  await expect(sheet.getByTestId("print-map")).toHaveCount(1);
  await expect(sheet.locator(`[data-ref="${area.id}"][data-role="SPECIAL"]`).first()).toBeAttached();
  expect(await sheet.locator(`path[data-ref="${area.id}"]`).count()).toBeGreaterThan(3);
  await expect(sheet.getByTestId("print-description").locator("[data-symbol]").first()).toBeAttached();
  await expect(sheet.locator("path[data-role='CONTROL']").first()).toBeAttached();
  await reviewScreenshots(owner, "banlaggning-utskrift-forhandsvisning", [1280]);

  // Alla banor: en sida per bana och Alla kontroller.
  await owner.getByLabel("Alla", { exact: true }).check();
  await expect(sheet).toHaveCount(document.courses.length + 1);
});

/**
 * Skärmbilder med ägarens riktiga filer (aldrig i repot): `OTID_E2E_SBN_DIR` pekar på en katalog med kartfilen (.ocd) och
 * SBN26_2.ppen. Sidorna sparas i `E2E_SCREENSHOT_DIR` för granskning mot Purple Pen.
 */
const sbnDir = process.env.OTID_E2E_SBN_DIR;
test("banläggning-utskrift med ägarens Stockholm by Night (OTID_E2E_SBN_DIR)", async ({ browser }) => {
  test.skip(!sbnDir || !process.env.E2E_SCREENSHOT_DIR, "bara med ägarens filer");
  test.setTimeout(400_000);
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(sbnDir!);
  const mapFile = files.find(name => name.endsWith(".ocd"))!;
  const suffix = unique();
  const owner = await registerAccount(browser, `sbn.${suffix}@exempel.se`, "Sara SBN");
  const raceId = await createRace(owner, `SBN ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(`${sbnDir}/${mapFile}`);
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 120_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(`${sbnDir}/SBN26_2.ppen`);
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-center", /,/, { timeout: 60_000 });
  await owner.waitForTimeout(4000);
  await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/sbn-editor-alla-kontroller.png` });
  await owner.setViewportSize({ width: 2200, height: 1600 });
  await owner.goto(`/admin/${raceId}/course-setting/print`);
  const sheets = owner.getByTestId("print-sheet");
  await expect(sheets.first()).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Alla", { exact: true }).check();
  const count = await sheets.count();
  for (let index = 0; index < count; index++) {
    const sheet = sheets.nth(index);
    await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
    await sheet.scrollIntoViewIfNeeded();
    await sheet.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/sbn-sida-${index + 1}-${await sheet.getAttribute("data-course")}.png` });
  }
});
