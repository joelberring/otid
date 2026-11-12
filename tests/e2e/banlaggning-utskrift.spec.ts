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
  await warmRoute(owner, `/admin/${raceId}/course-setting/layout`);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
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

  // Kontrollbeskrivningen är inget kartobjekt (ägaren 2026-11-03): den hör till papperet och placeras i förhandsvisningen.
  await expect(objects.getByRole("button", { name: "Beskrivningen på kartan" })).toHaveCount(0);
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await owner.keyboard.press("Escape");

  // Skalan hör till banan (ADR-0211 beslut 5): Banor → Egenskaper, "Skala för banan".
  await owner.getByRole("tab", { name: "Banor" }).click();
  await owner.getByTestId("course-setting-course-scale").selectOption("10000");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });

  // Fliken Utskrift: skalan visas och ändras i banans egenskaper; papperet ställs in på arket i utskriften (ADR-0211 tillägg).
  await owner.getByRole("tab", { name: "Utskrift" }).click();
  const print = owner.getByTestId("course-setting-print");
  await expect(print.getByTestId("course-setting-print-scale-value")).toHaveText("1:10 000");
  await expect(print.getByTestId("course-setting-print-scale-change")).toBeVisible();
  await expect(print.getByLabel("Papper")).toHaveCount(0);
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await reviewScreenshots(owner, "banlaggning-utskrift-editor");

  // Förhandsvisningen: A4 liggande under Papper och kartram, med kartan, området och beskrivningen.
  await print.getByRole("button", { name: "Förhandsvisning och utskrift" }).click();
  const before = (await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } }).setting.document;
  const lang = before.courses.find(item => item.name === "Lång")!;
  await owner.waitForURL(`**/admin/${raceId}/course-setting/print?course=${lang.id}`);
  await expect(owner.getByTestId("print-draft")).toContainText("färgerna är inte tryckkvalitet");
  // Papperet ställs in i fliken Layout (ADR-0217 fas 3).
  await owner.goto(`/admin/${raceId}/course-setting/layout?course=${lang.id}`);
  await expect(owner.getByRole("checkbox", { name: "Kontrollbeskrivning på kartan för Lång" })).toBeChecked({ timeout: 60_000 });
  const sheetPaper = owner.getByTestId("sheet-paper");
  await sheetPaper.getByTestId("sheet-paper-size").selectOption("A4");
  await sheetPaper.getByTestId("sheet-paper-orientation").selectOption("landscape");
  await expect.poll(async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document
    .courses.find(item => item.name === "Lång")!.printArea?.page, { timeout: 15_000 }).toMatchObject({ width: 827, height: 1169, landscape: true });

  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const document = state.setting.document;
  const course = document.courses.find(item => item.name === "Lång")!;
  expect(course.printScale).toBe(10000);
  const area = document.specialObjects.find(item => item.kind === "out-of-bounds")!;
  expect(area.points).toHaveLength(3);
  expect(area.courses).toEqual([]);
  expect(document.specialObjects.some(item => item.kind === "descriptions")).toBe(false);
  await owner.goto(`/admin/${raceId}/course-setting/print?course=${lang.id}`);
  const sheet = owner.getByTestId("print-sheet");
  await expect(sheet).toHaveCount(1, { timeout: 60_000 });
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  await expect(sheet).toHaveAttribute("width", /^296\.9\d*mm$/);
  await expect(sheet).toHaveAttribute("data-scale", "10000");
  await expect(sheet.getByTestId("print-map")).toHaveCount(1);
  await expect(sheet.locator(`[data-ref="${area.id}"][data-role="SPECIAL"]`).first()).toBeAttached();
  expect(await sheet.locator(`path[data-ref="${area.id}"]`).count()).toBeGreaterThan(3);
  await expect(sheet.getByTestId("print-description").locator("[data-symbol]").first()).toBeAttached();
  await expect(sheet.locator("path[data-role='CONTROL']").first()).toBeAttached();
  await reviewScreenshots(owner, "banlaggning-utskrift-forhandsvisning", [1280]);

  // Användartestet 2026-11-12: rubriken på kartorna är tävlingens namn, inte .ppen-filens titel; filens titel kan väljas.
  const raceTitle = `Utskrift ${suffix} · Torsdag`;
  const titleNotice = owner.getByTestId("print-title");
  await expect(titleNotice).toContainText(`Rubriken på kartorna: ${raceTitle}. Filen heter Kvällsträning på kartfilen.`);
  await owner.getByLabel("Rubrik överst (tävling, bana, längd, skala)").check();
  await expect(sheet.first()).toContainText(raceTitle);
  await expect(sheet.first()).not.toContainText("Kvällsträning på kartfilen");
  await titleNotice.getByLabel("Använd filens titel på kartorna").check();
  await expect(titleNotice).toContainText(`Rubriken på kartorna: Kvällsträning på kartfilen. Tävlingen heter ${raceTitle}.`);
  await expect(sheet.first()).toContainText("Kvällsträning på kartfilen");
  await expect.poll(async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: { event: { printFileTitle?: boolean } } } })
    .setting.document.event.printFileTitle, { timeout: 15_000 }).toBe(true);
  await titleNotice.getByLabel("Använd filens titel på kartorna").uncheck();
  await expect(sheet.first()).toContainText(raceTitle);
  await owner.getByLabel("Rubrik överst (tävling, bana, längd, skala)").uncheck();

  // Alla banor: en sida per bana och Alla kontroller.
  await owner.getByLabel("Alla", { exact: true }).check();
  await expect(sheet).toHaveCount(document.courses.length + 1);

  // Layoutmallen (ADR-0183): fyra kartor per A4 i ordning, med skärmarker; webbläsarens utskrift fungerar som utkast.
  // "Kartor per ark" hör till layouten (fliken Layout, huvudlayouten).
  await owner.goto(`/admin/${raceId}/course-setting/layout`);
  await owner.locator("[data-testid=layout-entry][data-layout=MAIN]").getByTestId("layout-per-sheet").selectOption("a4-four");
  await expect.poll(async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: { event: { mainLayout?: { layoutTemplate?: string } } } } })
    .setting.document.event.mainLayout?.layoutTemplate, { timeout: 15_000 }).toBe("a4-four");
  await owner.goto(`/admin/${raceId}/course-setting/print`);
  await owner.getByLabel("Alla", { exact: true }).check();
  await expect(sheet).toHaveCount(Math.ceil((document.courses.length + 1) / 4));
  await expect(sheet.first()).toHaveAttribute("data-frames", String(Math.min(4, document.courses.length + 1)));
  await expect(sheet.first().getByTestId("print-frame")).toHaveCount(Math.min(4, document.courses.length + 1));
  await expect(sheet.first()).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  await owner.getByTestId("print-fill").selectOption("REPEAT");
  await expect(sheet).toHaveCount(document.courses.length + 1);
  await expect(sheet.first().getByTestId("print-frame")).toHaveCount(4);

  // Utskriftsprofilen: kartans färger ur filen, Kontorsskrivare (ljusare grönt) väljs för tävlingen och kartan ritas om.
  // ADR-0211 beslut 6: färgerna som en kompakt rad; "Redigera färger" öppnar flödet, "Justera färger för hand" tabellen.
  const profile = owner.getByTestId("print-profile");
  await expect(profile.getByTestId("print-profile-status")).toBeVisible();
  await profile.getByTestId("print-colors-edit").click();
  await profile.getByTestId("print-colors-manual").locator("summary").click();
  await expect(profile.getByTestId("print-profile-colors").locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });
  await expect(profile.getByTestId("print-preflight")).toBeVisible();
  await profile.getByTestId("print-profile-select").selectOption("office");
  await expect.poll(async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: { event: { printProfileId?: string } } } })
    .setting.document.event.printProfileId, { timeout: 15_000 }).toBe("office");
  await expect(sheet.first()).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  await reviewScreenshots(owner, "banlaggning-utskrift-mall-profil", [1280]);

  // En karta per löpare: kartbuntarna (inga anmälda här) och kontrollen före utskrift.
  await owner.getByTestId("print-mode-runners").check();
  await expect(owner.getByTestId("print-runners")).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByTestId("print-runner-check")).toBeVisible();

  // Telefonen: Specialobjekt och fliken Utskrift ligger bakom "Mer" som resten av verktygen.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  const more = phone.getByTestId("course-setting-field-more");
  await expect(more).toBeVisible({ timeout: 60_000 });
  await expect(phone.getByRole("button", { name: /Specialobjekt/ })).toBeHidden();
  await expect(phone.getByRole("tab", { name: "Utskrift" })).toBeHidden();
  await more.click();
  await expect(phone.getByRole("button", { name: /Specialobjekt/ })).toBeVisible();
  // ADR-0188: Utskrift ligger under lådans "Mer" (de vanligaste flikarna syns med namn).
  await phone.getByTestId("course-setting-tab-more").click();
  await phone.getByRole("menuitem", { name: /Utskrift/ }).click();
  await expect(phone.getByRole("tab", { name: "Utskrift" })).toBeVisible();
  await expect(phone.getByTestId("course-setting-print")).toBeVisible();
  if (process.env.E2E_SCREENSHOT_DIR) await phone.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/banlaggning-utskrift-telefon-mer.png` });
  await phoneContext.close();
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
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(`${sbnDir}/${mapFile}`);
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
