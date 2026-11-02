import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0192: träningsläget i banläggningen. På banan Lång (påhittad karta och .ppen i fixtures) läggs en kantig korridor från
 * start till 32, bara kurvbild därifrån till 34 och fönster till mål, sista säkra på en sträcka och ett ritat område;
 * ångra och gör om; före och efter. Sedan stjärnbana, linjeorientering och kepsorientering, förhandsvisningen med kartbitar
 * och telefonens fliken Träning. Skärmbilderna sparas i E2E_SCREENSHOT_DIR (dator 1280 och telefon 390).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function clickMap(page: Page, map: Locator, x: number, y: number) {
  const at = await screenOf(map, x, y);
  await page.mouse.click(at.x, at.y);
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
}

/** Kartan är ritad med så många pass (0 = utan träning). */
async function drawnWith(map: Locator, passes: number) {
  await expect(map).toHaveAttribute("data-passes", String(passes), { timeout: 30_000 });
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

type Training = {
  courses: Record<string, { outside: { kind: string }; sections: { form: string; from: string | null; to: string | null }[]; star?: unknown; line?: { points: unknown[] };
    pairs?: { pairs: unknown[]; print: string } }>;
  areas: Record<string, unknown>;
  attackPoints: Record<string, { from: string; to: string }>;
};
type Document = { courses: { id: string; name: string }[]; training?: Training };

test("banläggning: träningsläget med avsnitt, sista säkra, område, stjärna, linje, keps och kartbitar", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `traning.${suffix}@exempel.se`, "Tea Tränare");
  // Utvecklingsservern kompilerar tävlingssidan vid första besöket (kan ta längre än väntetiden i createRace).
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  await warmRoute(owner, "/api/admin/races/00000000-0000-4000-8000-000000000000/administrator/session");
  const raceId = await createRace(owner, `Träning ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  const documentNow = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document;
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByTestId("course-setting-map");
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await drawnWith(map, 0);
  const panel = owner.getByTestId("course-setting-training");

  // Ingången: knappen Träning i verktygsraden öppnar fliken med formerna.
  await owner.getByTestId("course-setting-training-tool").click();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("training-add-CORRIDOR")).toContainText("Korridor");
  await shot(owner, "01-fore-1280");

  // 1. Korridor (kantig) från start till 32: vitt utanför.
  await panel.getByTestId("training-add-CORRIDOR").click();
  await saved(owner);
  await drawnWith(map, 2);
  const sections = panel.getByTestId("training-section");
  await sections.nth(0).getByTestId("training-section-to").selectOption({ label: "2 (32)" });
  await saved(owner);
  await panel.getByTestId("training-corridor-width").fill("80");
  await panel.getByTestId("training-corridor-width").press("Enter");
  await saved(owner);
  let document = await documentNow();
  expect(document.training!.courses["1"]!.outside.kind).toBe("WHITE");
  expect(document.training!.courses["1"]!.sections[0]!.form).toBe("CORRIDOR");
  await shot(owner, "02-korridor-kantig-1280");
  await sections.nth(0).getByTestId("training-corridor-SMOOTH").click();
  await saved(owner);
  await shot(owner, "03-korridor-mjuk-1280");

  // 2. Bara kurvbild från 32 till 34, med text vid bytet; 3. fönster från 34 till mål.
  await panel.getByTestId("training-add-BAND").click();
  await saved(owner);
  await sections.nth(1).getByTestId("training-section-to").selectOption({ label: "4 (34)" });
  await saved(owner);
  await panel.getByTestId("training-add-WINDOW").click();
  await saved(owner);
  await drawnWith(map, 4);
  document = await documentNow();
  expect(document.training!.courses["1"]!.sections.map(section => section.form)).toEqual(["CORRIDOR", "BAND", "WINDOW"]);
  expect(document.training!.courses["1"]!.sections[2]!.from).not.toBeNull();
  await shot(owner, "04-avsnitt-korridor-kurvbild-fonster-1280");

  // 4. Sista säkra på sträckan 33–34 (kortet startar verktyget).
  await panel.getByTestId("training-add-ATTACK").click();
  await clickMap(owner, map, 95, 39);
  await saved(owner);
  document = await documentNow();
  expect(Object.values(document.training!.attackPoints).map(attack => `${attack.from}-${attack.to}`)).toEqual(["4-5"]);
  await panel.getByTestId("training-attack-add").click();
  await shot(owner, "05-sista-sakra-1280");

  // 5. Ett ritat område (bara kurvbild) ritas punkt för punkt; ångra tar bort det och gör om lägger tillbaka det.
  await panel.getByTestId("training-add-AREA").click();
  for (const [x, y] of [[55, 30], [75, 30], [75, 45], [55, 45]] as const) await clickMap(owner, map, x, y);
  await panel.getByTestId("training-tool-finish").click();
  await saved(owner);
  expect(Object.keys((await documentNow()).training!.areas)).toHaveLength(1);
  await owner.getByRole("button", { name: "Ångra" }).click();
  await saved(owner);
  expect(Object.keys((await documentNow()).training!.areas)).toHaveLength(0);
  await owner.getByRole("button", { name: "Gör om" }).click();
  await saved(owner);
  expect(Object.keys((await documentNow()).training!.areas)).toHaveLength(1);
  await drawnWith(map, 8);
  await shot(owner, "06-omrade-1280");

  // Före och efter: "Visa träningen" av ger kartan som vanligt.
  await panel.getByTestId("training-show").uncheck();
  await drawnWith(map, 0);
  await shot(owner, "07-fore-efter-av-1280");
  await panel.getByTestId("training-show").check();
  await drawnWith(map, 8);

  // 6. Linjeorientering: linjen längs sträckorna. 7. Keps: par intill varandra, gemensam karta.
  await panel.getByTestId("training-add-LINE").click();
  await panel.getByTestId("training-line-legs").click();
  await saved(owner);
  await panel.getByTestId("training-add-PAIRS").click();
  await panel.getByTestId("training-pairs-make").click();
  await saved(owner);
  document = await documentNow();
  expect(document.training!.courses["1"]!.line!.points.length).toBeGreaterThan(5);
  expect(document.training!.courses["1"]!.pairs).toMatchObject({ print: "COMMON" });
  expect(document.training!.courses["1"]!.pairs!.pairs).toHaveLength(3);
  await expect(owner.getByTestId("course-setting-overprint")).toHaveAttribute("data-labels", /1a/);
  await shot(owner, "08-linje-keps-1280");

  // 8. Stjärna: en ny bana C – udd – C med 31 i mitten, utskrift en karta per udd.
  await panel.getByTestId("training-add-STAR").click();
  await panel.getByTestId("training-star-center").selectOption({ label: "31" });
  await panel.getByTestId("training-star-create").click();
  await saved(owner);
  document = await documentNow();
  const star = document.courses.find(course => course.name === "Stjärna 31")!;
  expect(star).toBeDefined();
  expect(document.training!.courses[star.id]!.star).toMatchObject({ print: "PER_CONTROL" });
  await owner.getByTestId("course-setting-view").selectOption({ label: "Stjärna 31" });
  await shot(owner, "09-stjarna-1280");

  // Telefonen (390 px): fliken Träning bakom Mer, inget utanför skärmen.
  await owner.getByTestId("course-setting-view").selectOption({ label: "Lång" });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.reload();
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await owner.getByTestId("course-setting-view").selectOption({ label: "Lång" });
  const more = owner.getByTestId("course-setting-field-more");
  if (await more.isVisible() && await more.getAttribute("aria-expanded") !== "true") await more.click();
  await owner.getByTestId("course-setting-training-tool").click();
  await expect(panel).toBeVisible();
  await drawnWith(map, 8);
  const overflow = await owner.evaluate(() => window.document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(owner, "10-telefon-390");
  await panel.getByTestId("training-section").first().scrollIntoViewIfNeeded();
  await shot(owner, "11-telefon-avsnitt-390");
  await owner.setViewportSize({ width: 1280, height: 720 });

  // Förhandsvisningen: Lång med träningen och kartbitar; stjärnan en karta per udd.
  await owner.goto(`/admin/${raceId}/course-setting/print`);
  await owner.getByLabel("Lång").check();
  await expect(owner.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  await shot(owner, "12-utskrift-lang-1280");
  await owner.getByTestId("print-pieces").check();
  await expect(owner.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  expect(Number(await owner.getByTestId("print-sheet").first().getAttribute("data-frames"))).toBeGreaterThan(4);
  await shot(owner, "13-kartbitar-1280");
  await owner.getByTestId("print-pieces").uncheck();
  await owner.getByLabel("Lång").uncheck();
  await owner.getByLabel("Stjärna 31").check();
  await expect(owner.getByTestId("print-sheet")).toHaveCount(5, { timeout: 30_000 });
  await expect(owner.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  await shot(owner, "14-stjarna-per-udd-1280");
});
