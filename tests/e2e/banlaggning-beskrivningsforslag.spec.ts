import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, openStep, registerAccount, reviewScreenshots, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0180 beslut 13: förslag på kontrollbeskrivning ur kartfilen. Testkartan (kartfil.omap) har stenar i (42, 61),
 * (76, 52) och (98, 30) mm. En ny kontroll läggs på stenen i (76, 52): beskrivningen visar förslaget (sten) ljusare tills
 * det godtas, panelen ritar det med riktiga symboler, och "Godta" skriver in det som en vanlig ändring (sparat). På
 * telefonen godtas förslaget för kontroll 34 (också en sten) med raden i fältläget.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
}

async function shot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

type Document = { controls: Record<string, { kind: string; code?: string; at: { x: number; y: number }; descriptions: { box: string; ref?: string; text?: string }[] }> };

test("förslag på kontrollbeskrivning: ny kontroll på en sten, förhandsvisning, godta i panelen och i fältläget", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `beskrivningsforslag.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Beskrivningsförslag ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);

  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByRole("link", { name: "Banläggning" }).click();
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const map = owner.getByRole("img", { name: "Karta med banpåtryck: Lång" });
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });

  // Kontrollerna utan detalj (33, 34 …) visar förslag i beskrivningen redan innan något godtas.
  await owner.getByRole("tab", { name: "Beskrivning" }).click();
  await expect(owner.getByTestId("description-preview-count")).toContainText("visar förslag", { timeout: 30_000 });
  await expect(owner.getByTestId("description-preview-label").first()).toHaveText("förslag");

  // Flytta kontroll 33 bort från stenen och lägg en ny kontroll på stenen i (76, 52).
  const from = await screenOf(map, 76, 52);
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  await owner.getByRole("button", { name: "Välj och flytta" }).click();
  await owner.mouse.move(from.x, from.y);
  await owner.mouse.down();
  await owner.mouse.move(from.x + 3 * scale, from.y - 4 * scale, { steps: 4 });
  await owner.mouse.move(from.x + 6 * scale, from.y - 8 * scale, { steps: 4 });
  await owner.mouse.up();
  await saved(owner);
  await owner.getByRole("button", { name: "Ny kontroll" }).click();
  const stone = await screenOf(map, 76, 52);
  await owner.mouse.click(stone.x, stone.y);
  await owner.getByRole("button", { name: "Välj och flytta" }).click();
  await owner.mouse.click(stone.x, stone.y);
  const selected = (await owner.getByTestId("course-setting-selected").textContent())!;
  const code = /kontroll (\d+)/.exec(selected)![1]!;
  await owner.getByRole("tab", { name: "Beskrivning" }).click();

  // Förslaget: sten (D 2.4) ritat med symbolen, säkerheten och förklaringen; inget är inskrivet än.
  const suggestion = owner.getByTestId("description-suggestion");
  await expect(suggestion).toBeVisible({ timeout: 30_000 });
  await expect(suggestion.getByTestId("description-suggestion-best").locator('[data-box="D"]')).toHaveAttribute("data-symbol", "2.4");
  await expect(suggestion.getByTestId("description-suggestion-reason")).toContainText("Sten (ISOM 206)");
  await expect(suggestion.getByTestId("description-suggestion-level")).toContainText("säkert");
  const before = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const created = Object.entries(before.setting.document.controls).find(([, control]) => control.code === code)!;
  expect(created[1].descriptions.filter(box => box.box === "D")).toEqual([]);
  await suggestion.getByTestId("description-suggestion-best").hover();
  await reviewScreenshots(owner, "beskrivningsforslag-panel");
  await suggestion.getByTestId("description-suggestion-best").hover();
  await shot(owner, "beskrivningsforslag-markerad");

  await suggestion.getByTestId("description-suggestion-accept").click();
  await saved(owner);
  const after = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  expect(after.setting.document.controls[created[0]]!.descriptions.find(box => box.box === "D")?.ref).toBe("2.4");
  await expect(owner.getByTestId("description-svg").locator(`[data-ref="${created[0]}"][data-symbol="2.4"]`).first()).toBeVisible();

  // Telefonen: kontroll 34 på stenen (98, 30) saknar detalj; raden i fältläget godtar förslaget.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  const phoneMap = phone.getByTestId("course-setting-map");
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await expect(phoneMap).toHaveAttribute("data-px-per-mm", /\d/);
  await phone.waitForTimeout(500);
  const c34 = await screenOf(phoneMap, 98, 30);
  await phone.touchscreen.tap(c34.x, c34.y);
  await expect(phone.getByTestId("course-setting-field-selected")).toHaveText("Vald: kontroll 34");
  const line = phone.getByTestId("course-setting-field-suggestion");
  await expect(line).toContainText("Förslag: sten", { timeout: 30_000 });
  await shot(phone, "beskrivningsforslag-falt-390");
  await line.getByTestId("course-setting-field-suggestion-accept").click();
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 15_000 });
  await expect(line).toHaveCount(0);
  const final = await (await phone.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const c34Saved = Object.values(final.setting.document.controls).find(control => control.code === "34")!;
  expect(c34Saved.descriptions.find(box => box.box === "D")?.ref).toBe("2.4");
  await phoneContext.close();
});
