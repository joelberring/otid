import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { browserErrors, createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0203: en bana med kartbyte (Lång i kartbyte.ppen, kartbytet vid 33 med "vänd kartan") som Purple Pen: delväljaren i
 * fliken Utskrift, en egen tryckyta för del 2 och "Visa överlapp"; förhandsvisningen med en karta per del, dubbelsidigt
 * (förval när kartan vänds) med del 2 på baksidan, delens beskrivning och överlappet tonat; .ppen med delens tryckyta.
 * Skärmbilder i 1280 och 390 px till E2E_SCREENSHOT_DIR (07-*).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string, part?: Locator) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    if (part) { await part.scrollIntoViewIfNeeded(); await part.screenshot({ path: `${shots}/${name}-${width}.png` }); }
    else await page.screenshot({ path: `${shots}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

type Doc = { courses: { id: string; name: string; partPrintAreas?: Record<string, { page?: { landscape: boolean } }> }[];
  event: { paperLayouts?: Record<string, { overlap?: string }> } };

test("banläggning-kartbyte: delar, egen tryckyta, överlapp och dubbelsidigt", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartbyte.${suffix}@exempel.se`, "Kim Kartbyte");
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  await warmRoute(owner, "/api/admin/races/00000000-0000-4000-8000-000000000000/administrator/session");
  const raceId = await createRace(owner, `Kartbyte ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  const doc = async (): Promise<Doc> => {
    const read = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Doc } }).setting.document;
    try { return await read(); } catch { return await read(); }
  };
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartbyte.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-center", /,/, { timeout: 60_000 });

  // 1. Fliken Utskrift: delväljaren, del 2 med egen tryckyta (liggande), "Visa överlapp".
  await owner.getByRole("tab", { name: "Utskrift" }).click();
  const print = owner.getByTestId("course-setting-print");
  const parts = print.getByTestId("course-setting-parts");
  await expect(parts).toBeVisible();
  const chooser = parts.getByTestId("course-setting-part");
  await expect(chooser.locator("option")).toHaveText(["Hela banan", "Del 1", "Del 2"]);
  await chooser.selectOption("1");
  await expect(parts.getByTestId("course-setting-part-area")).toHaveText("Delen har banans tryckyta tills du ändrar den här.");
  await print.getByLabel("Riktning").selectOption("landscape");
  await expect(parts.getByTestId("course-setting-part-area")).toHaveText("Delen har en egen tryckyta.", { timeout: 15_000 });
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await expect.poll(async () => (await doc()).courses.find(row => row.id === "1")!.partPrintAreas?.["1"]?.page?.landscape).toBe(true);
  // Hela banan är fortfarande stående (delen ärver inte tillbaka).
  expect((await doc()).courses.find(row => row.id === "1")!.partPrintAreas?.["0"]).toBeUndefined();
  await parts.getByTestId("course-setting-overlap").selectOption("PREVIOUS_PART");
  await expect.poll(async () => (await doc()).event.paperLayouts?.["1"]?.overlap).toBe("PREVIOUS_PART");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await shot(owner, "07-kartbyte-editor");
  await reviewScreenshots(owner, "07-kartbyte-editor-hela");

  // 2. Förhandsvisningen: en karta per del, dubbelsidigt förvalt (kartan vänds), del 2 på baksidan med överlappet.
  // Inga fel i webbläsaren: en banas två delar fick förut samma nyckel i översikten (dev-överläggets "1 Issue").
  const errors = browserErrors(owner, /\/course-setting\/print$/);
  await owner.goto(`/admin/${raceId}/course-setting/print?course=1`);
  const sheets = owner.getByTestId("print-sheet");
  await expect(sheets).toHaveCount(2, { timeout: 60_000 });
  await expect(sheets.first()).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await expect(sheets.nth(0)).toHaveAttribute("aria-label", /Lång – del 1/);
  await expect(sheets.nth(1)).toHaveAttribute("aria-label", /Lång – del 2/);
  const duplex = owner.getByTestId("print-parts-duplex");
  await expect(duplex).toBeChecked();
  await expect(sheets.nth(0)).not.toHaveAttribute("data-back", "");
  await expect(sheets.nth(1)).toHaveAttribute("data-back", "");
  // Del 2 är liggande (egen tryckyta), del 1 stående.
  const size = async (sheet: Locator) => (await sheet.getAttribute("viewBox"))!.split(" ").map(Number);
  const [, , w1, h1] = await size(sheets.nth(0));
  const [, , w2, h2] = await size(sheets.nth(1));
  expect(w1!).toBeLessThan(h1!);
  expect(w2!).toBeGreaterThan(h2!);
  // Överlappet (hela föregående del) tonat på del 2, inget på del 1; varje del har sin beskrivning.
  await expect(sheets.nth(1).locator("[data-role=OVERLAP]").first()).toHaveAttribute("opacity", "0.35");
  await expect(sheets.nth(0).locator("[data-role=OVERLAP]")).toHaveCount(0);
  for (const index of [0, 1]) await expect(sheets.nth(index).getByTestId("print-description")).toHaveCount(1);
  // Numren på del 2 fortsätter (33 är kontroll 3, del 2 börjar där); föregående dels kontroller saknar nummer.
  const numbers = await sheets.nth(1).locator("[data-role=NUMBER]").allTextContents();
  expect(numbers).not.toContain("1");
  expect(numbers).toContain("4");
  await expect(sheets.nth(1)).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await shot(owner, "07-kartbyte-del1", sheets.nth(0));
  await shot(owner, "07-kartbyte-del2-baksida", sheets.nth(1));
  // Enkelsidigt: inga baksidor.
  await duplex.uncheck();
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(1)).not.toHaveAttribute("data-back", "");
  await duplex.check();
  // Alla banor: Mellan (en del) får en tom baksida efter sig när dubbelsidigt är på.
  await owner.getByRole("checkbox", { name: "Alla", exact: true }).uncheck();
  await owner.getByRole("checkbox", { name: "Lång", exact: true }).check();
  await owner.getByRole("checkbox", { name: "Mellan", exact: true }).check();
  await expect(sheets).toHaveCount(4, { timeout: 30_000 });
  await expect(sheets.nth(3)).toHaveAttribute("aria-label", "Baksida (tom)");
  await reviewScreenshots(owner, "07-kartbyte-forhandsvisning");
  errors.check("utskriftssidan med kartbyten");

  // 3. .ppen: delens tryckyta som Purple Pens `<print-area part="1">`.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
  await owner.getByRole("button", { name: /^Fil/ }).click();
  await owner.getByRole("menuitem", { name: "Fil och versioner …" }).click();
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Ladda ned .ppen" }).click();
  const ppen = await readFile(await (await downloadPromise).path(), "utf8");
  expect(ppen).toMatch(/<print-area part="1"[^>]*page-landscape="true"/);
  expect(ppen).toContain('map-exchange="true" map-flip="true"');
});
