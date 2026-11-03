import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0180 beslut 14 (ägarens synpunkter 2026-11-02): objekten och gafflingen i banläggningens editor. En obligatorisk
 * passage läggs i banan (vriden efter sträckan) och vrids med handtaget; en valfri passage läggs från paletten; banan
 * dupliceras; en befintlig kontroll fångas med ett klick i ringen; en gaffling i två grenar får en kontroll i varje gren;
 * en bana tas bort med sina oanvända kontroller (ett ångra-steg) och de oanvända tas bort i Alla kontroller. Telefonen:
 * Objekt ligger bakom "Mer" och öppnar samma palett.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function clickMap(page: Page, map: Locator, x: number, y: number, alt = false) {
  const at = await screenOf(map, x, y);
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.click(at.x, at.y);
  if (alt) await page.keyboard.up("Alt");
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
}

/** Telefonens rad är kompakt: verktygen ligger bakom "Mer" (⋯). */
async function openMore(page: Page) {
  const more = page.getByTestId("course-setting-field-more");
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
}

type Document = {
  controls: Record<string, { id: string; kind: string; code?: string; at: { x: number; y: number }; orientation?: number }>;
  courses: { id: string; name: string; first?: string }[];
  courseControls: Record<string, { control: string; next?: string; split?: { kind: string; branches: string[]; end: string } }>;
  specialObjects: { id: string; kind: string; orientation?: number; courses: string[] }[];
};

test("banläggning: passager och vridning, paletten, duplicera, fånga befintlig, gaffla, ta bort bana och oanvända", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `objekt.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Objekt ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  const documentNow = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document;
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByTestId("course-setting-map");
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await expect(owner.getByTestId("course-setting-control-list")).toContainText("Kontroller i Lång");

  // 1. Obligatorisk passage efter 32: den vrids efter sträckan 32–33 automatiskt (in och ut åt samma håll: −104,8° → 255°).
  await clickMap(owner, map, 42, 61);
  await expect(owner.getByTestId("course-setting-selected")).toHaveText("Vald: kontroll 32");
  await owner.getByRole("button", { name: "Ny obligatorisk passage" }).click();
  await clickMap(owner, map, 59, 56.5);
  await saved(owner);
  let document = await documentNow();
  const crossing = Object.values(document.controls).find(control => control.kind === "CROSSING_POINT")!;
  expect(crossing.orientation).toBeGreaterThan(250);
  expect(crossing.orientation).toBeLessThan(260);
  await expect(owner.getByTestId("course-setting-control-list")).toContainText("passage");

  // Vrid med handtaget: dra det rakt upp från mitten (90°); med 5°-steg blir det exakt 90.
  await owner.getByRole("button", { name: "Välj och flytta" }).click();
  await clickMap(owner, map, crossing.at.x, crossing.at.y);
  await expect(owner.getByTestId("course-setting-selected")).toHaveText("Vald: passage");
  const center = await screenOf(map, crossing.at.x, crossing.at.y);
  const radians = crossing.orientation! * Math.PI / 180;
  const handle = { x: center.x + 38 * Math.cos(radians), y: center.y - 38 * Math.sin(radians) };
  await owner.mouse.move(handle.x, handle.y);
  await owner.mouse.down();
  await owner.mouse.move(center.x + 20, center.y - 50, { steps: 4 });
  await owner.mouse.move(center.x + 1, center.y - 60, { steps: 4 });
  await reviewScreenshots(owner, "efter-1-vrid-handtag");
  await owner.mouse.up();
  await expect(owner.getByTestId("course-setting-orientation").first()).toHaveValue("90");
  await saved(owner);
  document = await documentNow();
  expect(document.controls[crossing.id]!.orientation).toBe(90);

  // 2. Valfri passage från paletten (Objekt i verktygsraden).
  await owner.getByRole("button", { name: /Specialobjekt/ }).click();
  const palette = owner.getByTestId("course-setting-palette");
  await expect(palette.getByRole("group", { name: "Passager och kartbyte" })).toBeVisible();
  await expect(palette.getByRole("group", { name: "Spärrar" })).toBeVisible();
  await reviewScreenshots(owner, "efter-2-palett");
  await palette.getByTestId("course-setting-palette-optional-crossing-point").click();
  await expect(palette).toHaveCount(0);
  await clickMap(owner, map, 30, 30);
  await expect(owner.getByTestId("course-setting-special")).toHaveAttribute("data-kind", "optional-crossing-point");
  await saved(owner);
  document = await documentNow();
  expect(document.specialObjects.map(special => special.kind)).toEqual(["optional-crossing-point"]);
  await owner.keyboard.press("Escape");

  // 3. Duplicera banan: "Lång (kopia)" direkt efter originalet, med samma kontroller.
  await owner.getByRole("tab", { name: "Banor" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).first().click();
  await owner.getByRole("button", { name: "Duplicera" }).click();
  await expect(owner.getByTestId("course-setting-course")).toHaveCount(3);
  await expect(owner.getByTestId("course-setting-view")).toHaveValue(/.+/);
  const names = await owner.getByTestId("course-setting-course").allInnerTexts();
  expect(names.map(name => name.split("\n")[0])).toEqual(["Lång", "Lång (kopia)", "Mellan"]);
  expect(names[1]!.split("\n")[1]).toBe(names[0]!.split("\n")[1]);
  await saved(owner);
  await reviewScreenshots(owner, "efter-3-duplicera");

  // 4. Ny bana och fånga en befintlig kontroll: ringen tänds ("Lägg in kontroll 32") och klicket lägger in 32.
  await owner.getByLabel("Namn på ny bana").fill("Fånga");
  await owner.getByRole("button", { name: "Ny bana" }).click();
  const before = Object.keys((await documentNow()).controls).length;
  await owner.getByRole("button", { name: "Ny kontroll" }).click();
  const near = await screenOf(map, 43, 62);
  await owner.mouse.move(near.x, near.y);
  await expect(owner.getByTestId("course-setting-snap")).toHaveText("Lägg in kontroll 32");
  await reviewScreenshots(owner, "efter-4-fanga");
  await owner.mouse.click(near.x, near.y);
  const fanga = owner.getByTestId("course-setting-course").filter({ hasText: "Fånga" });
  await expect(fanga).toContainText("1 kontroll");
  // Alt (eller "Alltid ny") ger en ny kontroll också nära en befintlig.
  await clickMap(owner, map, 77, 53, true);
  await expect(fanga).toContainText("2 kontroller");
  await saved(owner);
  expect(Object.keys((await documentNow()).controls).length).toBe(before + 1);

  // 5. Gaffla vid 32 i två grenar: editorn står i gren A, Nästa gren, en kontroll i varje.
  await owner.getByTestId("course-setting-tree-control").filter({ hasText: "kontroll 32" }).click();
  await owner.getByRole("button", { name: "Gaffla här (vid vald kontroll)" }).click();
  await owner.getByTestId("course-setting-fork-picker").getByRole("button", { name: "2 grenar" }).click();
  const bar = owner.getByTestId("course-setting-fork-bar");
  await expect(bar).toContainText("Gren A av 2");
  await owner.getByRole("button", { name: "Ny kontroll" }).click();
  await clickMap(owner, map, 55, 75);
  await bar.getByRole("button", { name: /Nästa gren/ }).click();
  await expect(bar).toContainText("Gren B av 2");
  await clickMap(owner, map, 60, 40);
  const branches = owner.getByTestId("course-setting-branch");
  await expect(branches).toHaveCount(2);
  await expect(branches.nth(0)).toContainText("kontroll");
  await expect(branches.nth(1)).toHaveAttribute("data-active", "true");
  await expect(owner.getByTestId("course-setting-variant")).toHaveCount(2);
  await saved(owner);
  await reviewScreenshots(owner, "efter-5-gaffling");
  document = await documentNow();
  const course = document.courses.find(row => row.name === "Fånga")!;
  const forkCc = Object.values(document.courseControls).find(item => item.split?.kind === "FORK")!;
  expect(forkCc.split!.branches).toHaveLength(2);
  for (const branch of forkCc.split!.branches) {
    const next = document.courseControls[branch]!.next!;
    expect(next).not.toBe(forkCc.split!.end);
    expect(document.courseControls[next]!.next).toBe(forkCc.split!.end);
  }
  // Klar: alla grenar visas igen; en variant ur listan visas kraftig (den andra grenen svag).
  await bar.getByRole("button", { name: "Klar" }).click();
  await expect(bar).toHaveCount(0);
  await owner.getByTestId("course-setting-variant").nth(1).click();
  await expect(owner.getByTestId("course-setting-variant").nth(1)).toHaveAttribute("aria-pressed", "true");

  // 6. Ta bort banan: dialogen listar kontrollerna som blir oanvända; banan och de två nya tas bort i ett ångra-steg.
  await owner.getByRole("button", { name: "Ta bort banan" }).click();
  const dialog = owner.getByTestId("course-setting-delete-course");
  await expect(dialog).toContainText("3 kontroller används inte längre i någon annan bana");
  await reviewScreenshots(owner, "efter-6-ta-bort-bana");
  await dialog.getByRole("button", { name: "Ta bort banan och de 3 oanvända kontrollerna" }).click();
  await expect(owner.getByTestId("course-setting-course")).toHaveCount(3);
  await saved(owner);
  document = await documentNow();
  expect(document.courses.some(row => row.id === course.id)).toBe(false);
  expect(Object.keys(document.controls).length).toBe(before);
  await owner.getByRole("button", { name: "Ångra" }).click();
  await expect(owner.getByTestId("course-setting-course")).toHaveCount(4);
  await saved(owner);
  expect(Object.keys((await documentNow()).controls).length).toBe(before + 3);
  await owner.getByRole("button", { name: "Gör om" }).click();
  await expect(owner.getByTestId("course-setting-course")).toHaveCount(3);
  await saved(owner);

  // 7. Oanvända kontroller i Alla kontroller: en ny kontroll utan bana räknas, ritas grå och tas bort efter en bekräftelse.
  await owner.getByTestId("course-setting-view").selectOption({ label: "Alla kontroller" });
  const unusedCount = owner.getByTestId("course-setting-unused-count");
  const unusedBefore = Number((await unusedCount.innerText()).split(" ")[0]);
  await owner.getByRole("button", { name: "Ny kontroll" }).click();
  await clickMap(owner, map, 20, 20);
  await expect(unusedCount).toHaveText(`${unusedBefore + 1} oanvänd${unusedBefore + 1 === 1 ? "" : "a"}`);
  await owner.getByRole("button", { name: "Välj och flytta" }).click();
  await reviewScreenshots(owner, "efter-7-oanvanda");
  await owner.getByRole("button", { name: "Ta bort alla oanvända" }).click();
  const confirm = owner.getByTestId("course-setting-remove-unused");
  await expect(confirm).toContainText("Ta bort");
  await confirm.getByRole("button", { name: "Ta bort alla oanvända" }).click();
  await expect(unusedCount).toHaveText("0 oanvända");
  await saved(owner);

  // 8. Telefonen: Objekt bakom "Mer" öppnar samma palett.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByTestId("course-setting-field-more")).toBeVisible({ timeout: 60_000 });
  await openMore(phone);
  await phone.getByRole("button", { name: /Specialobjekt/ }).click();
  await expect(phone.getByTestId("course-setting-palette")).toBeVisible();
  await expect(phone.getByTestId("course-setting-palette-ADD_CROSSING")).toContainText("Obligatorisk passage");
  if (process.env.E2E_SCREENSHOT_DIR) await phone.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/efter-8-telefon-palett-390.png` });
  await phoneContext.close();
});
