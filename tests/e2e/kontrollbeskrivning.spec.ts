import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting } from "./helpers";

/**
 * Steg 63 (ADR-0180): kontrollbeskrivningarna. Kartfilen och en .ppen läses in, banans beskrivning syns bredvid kartan,
 * en symbol väljs i ruta D (sökning och tangenter) och en fri text i ruta F på kontroll 33, beskrivningen visar dem och
 * de finns kvar efter omladdning; utskriftssidan visar banans beskrivning med symbolen på en A4.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const SYMBOL = { id: "2.4", search: "sten" };

type Document = { controls: Record<string, { code?: string; descriptions: { box: string; ref?: string; text?: string }[] }> };

test("kontrollbeskrivning: symbol i D och text i F, sparad efter omladdning och på utskriftssidan", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `beskrivning.${suffix}@exempel.se`, "Bo Beskrivare");
  const raceId = await createRace(owner, `Beskrivning ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();

  // Banans beskrivning bredvid kartan; .ppen har en symbol i D på kontroll 31.
  await owner.getByRole("tab", { name: "Beskrivning" }).click();
  const panel = owner.getByTestId("description-panel");
  const description = panel.getByRole("group", { name: "Kontrollbeskrivning: Lång" });
  await expect(description).toBeVisible();
  await expect(description.locator("[data-symbol]").first()).toBeVisible();

  // Ruta D på kontroll 33: sök, pil ned och upp, Enter.
  await description.getByRole("button", { name: /^kontroll 33, ruta D$/ }).click();
  await expect(owner.getByTestId("course-setting-selected")).toHaveText("Vald: kontroll 33");
  const picker = owner.getByTestId("description-picker");
  const search = picker.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill(SYMBOL.search);
  const wanted = picker.locator(`[role="option"][data-symbol="${SYMBOL.id}"]`);
  await expect(wanted).toHaveCount(1);
  await wanted.hover();
  await search.press("ArrowDown");
  await search.press("ArrowUp");
  await expect(wanted).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(picker).toHaveCount(0);
  const ref = await description.getByRole("button", { name: /^kontroll 33, ruta D: / }).getAttribute("data-ref");
  await expect(description.locator(`[data-symbol="${SYMBOL.id}"][data-ref="${ref}"]`)).toBeVisible();

  // Ruta F: fri text.
  await description.getByRole("button", { name: /^kontroll 33, ruta F$/ }).click();
  await picker.getByRole("combobox").fill("2m");
  await expect(picker.getByRole("option").first()).toHaveText('Använd texten "2m"');
  await picker.getByRole("combobox").press("Enter");
  await expect(description.getByRole("button", { name: "kontroll 33, ruta F: 2m" })).toBeVisible();
  await expect(description.locator("text", { hasText: /^2m$/ })).toHaveCount(1);
  // Kontrollens beskrivning i text i detaljrutan.
  await expect(owner.getByTestId("course-setting-described")).not.toHaveText("");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await reviewScreenshots(owner, "kontrollbeskrivning-panel");

  // Ladda om: sparat i dokumentet och i panelen.
  await owner.reload();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  await owner.getByRole("tab", { name: "Beskrivning" }).click();
  await expect(description.getByRole("button", { name: /^kontroll 33, ruta D: / })).toBeVisible();
  await expect(description.locator(`[data-symbol="${SYMBOL.id}"][data-ref="${ref}"]`)).toBeVisible();
  await expect(description.getByRole("button", { name: "kontroll 33, ruta F: 2m" })).toBeVisible();
  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: Document } };
  const control = Object.values(state.setting.document.controls).find(row => row.code === "33")!;
  expect(control.descriptions).toEqual(expect.arrayContaining([{ box: "D", ref: SYMBOL.id }, { box: "F", text: "2m" }]));

  // Utskriftssidan: banans beskrivning med symbolen på en A4.
  await panel.getByRole("button", { name: "Skriv ut beskrivningar" }).click();
  await expect(owner).toHaveURL(new RegExp(`/admin/${raceId}/course-setting/descriptions$`));
  await expect(owner.getByRole("heading", { name: "Kontrollbeskrivningar", level: 1 })).toBeVisible();
  await owner.getByRole("checkbox", { name: "Mellan" }).uncheck();
  await expect(owner.getByText("1 sida, 1 beskrivning.")).toBeVisible();
  const sheet = owner.getByRole("img", { name: "Sida 1 av 1" });
  await expect(sheet.locator(`[data-symbol="${SYMBOL.id}"][data-ref="${ref}"]`)).toHaveCount(1);
  await owner.getByLabel("Kopior per bana").fill("4");
  await expect(owner.getByText("1 sida, 4 beskrivningar.")).toBeVisible();
  await expect(sheet.locator(`[data-symbol="${SYMBOL.id}"][data-ref="${ref}"]`)).toHaveCount(4);
  const download = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Ladda ned SVG: Lång" }).click();
  // Filnamnet ("Lång.svg") provas i enhetstesterna; webbläsaren i testet ger inte alltid blob-länkens namn vidare.
  const svg = await readFile(await (await download).path(), "utf8");
  expect(svg).toMatch(/^<\?xml[\s\S]*<svg [^>]*width="[\d.]+mm"/);
  expect(svg).toContain(`<g data-symbol="${SYMBOL.id}">`);
  expect(svg).toContain(">2m</text>");
  await reviewScreenshots(owner, "kontrollbeskrivning-utskrift", [1280]);

  // Banhemligheten: sidan läser dokumentet, som bara admin får.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/admin/${raceId}/course-setting/descriptions`);
  await expect(visitor.getByText("Banläggningen kunde inte hämtas.")).toBeVisible();
  await expect(visitor.locator("[data-symbol]")).toHaveCount(0);
});
