import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0198 (ägaren 2026-11-03): färre gafflingsvarianter. "Natt" har tre fulgafflingar i följd (åtta varianter). Panelen
 * Varianter visar dem med fågelväg och längd längs vägval; "Begränsa varianter" förhandsgranskas och tar bort de som är längst
 * i alla avseenden (skyddet behåller en variant per kontroll). Efter omladdning är antalet lägre, en variant bockas ur och
 * ångras, och IOF XML har bara de behållna. Telefonen: tabellen på 390 px utan att sidan rullar i sidled.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
interface Document { courses: { id: string; name: string; excludedVariants?: { code: string; controls: string[] }[] }[] }

async function mapReady(page: Page) {
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await expect(page.getByText("Läser kartfilen …")).toHaveCount(0);
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 20_000 });
}

test("banläggning-gaffling-urval: tre gafflingar, förhandsgranska, ta bort de längsta, ladda om, IOF XML bara behållna", async ({ browser }) => {
  test.setTimeout(300_000);
  const shots = process.env.E2E_SCREENSHOT_DIR;
  const suffix = unique();
  const owner = await registerAccount(browser, `urval.${suffix}@exempel.se`, "Uno Urval");
  const raceId = await createRace(owner, `Urval ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  const documentNow = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } })
    .setting.document;
  await warmCourseSetting(owner, raceId);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/gaffling-urval.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  const courseRow = (page: Page, name: string) => page.getByTestId("course-setting-course")
    .filter({ has: page.locator("strong").getByText(name, { exact: true }) });
  await courseRow(owner, "Natt").click();
  await mapReady(owner);

  // Tabellen: åtta varianter, alla används; ACE kortast.
  const panel = owner.getByTestId("course-setting-variants");
  const summary = owner.getByTestId("course-setting-variants-summary");
  await expect(summary).toHaveText("8 varianter, alla används");
  const rows = panel.getByTestId("course-setting-variant-row");
  await expect(rows).toHaveCount(8);
  await expect(rows.filter({ hasText: "ACE" })).toContainText("kortast");
  await expect(rows.filter({ hasText: "BDF" })).toContainText(/\+\d+ m \(\d+ %\)/);

  // Längs vägval för alla varianters sträckor (samma Worker som banans längd).
  await panel.getByTestId("course-setting-variants-route").click();
  await expect(panel.getByText(/Längden längs vägval är räknad för alla varianter|\d+ av \d+ sträckor räknade/)).toBeVisible({ timeout: 120_000 });

  // Förhandsgranska "längst i alla avseenden": fyra tas bort, fyra behålls (tre för att deras kontroll annars inte används).
  const prune = panel.getByTestId("course-setting-variants-prune");
  await expect(prune.getByLabel("Ta bort varianter som är längst i alla avseenden")).toBeChecked();
  await prune.getByRole("button", { name: "Förhandsgranska" }).click();
  const preview = panel.getByTestId("course-setting-variants-preview");
  await expect(preview).toContainText("Tas bort (4):");
  await expect(preview).toContainText("Behålls (4):");
  await expect(preview).toContainText(/behövs för kontroll 4[246]/);
  await expect(panel.locator("tr[data-preview='goes']")).toHaveCount(4);
  await panel.scrollIntoViewIfNeeded();
  if (shots) await owner.screenshot({ path: `${shots}/banlaggning-gaffling-urval-forhand-1280.png`, fullPage: true });
  await preview.getByRole("button", { name: "Ta bort 4 varianter" }).click();
  await expect(summary).toHaveText("8 varianter, 4 används (4 bortvalda som längre)");
  await saved(owner);
  let natt = (await documentNow()).courses.find(course => course.name === "Natt")!;
  expect(natt.excludedVariants).toHaveLength(4);
  const excludedCodes = natt.excludedVariants!.map(row => row.code).sort();
  expect(excludedCodes).not.toContain("ACE");

  // Ladda om: antalet är lägre i panelen och i banlistan.
  await owner.reload();
  await mapReady(owner);
  await courseRow(owner, "Natt").click();
  await expect(summary).toHaveText("8 varianter, 4 används (4 bortvalda som längre)");
  await expect(courseRow(owner, "Natt")).toContainText("4 varianter (4 bortvalda)");
  if (shots) {
    await panel.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${shots}/banlaggning-gaffling-urval-tabell-1280.png` });
  }

  // För hand: bocka ur ACE (den kortaste); en kontroll kan bli oanvänd och sägs då. Ångra tar tillbaka den.
  await panel.getByLabel("Använd variant ACE").uncheck();
  await expect(summary).toHaveText("8 varianter, 3 används (5 bortvalda som längre)");
  await saved(owner);
  await owner.getByRole("button", { name: "Ångra" }).click();
  await expect(summary).toHaveText("8 varianter, 4 används (4 bortvalda som längre)");
  await saved(owner);
  natt = (await documentNow()).courses.find(course => course.name === "Natt")!;
  expect(natt.excludedVariants!.map(row => row.code).sort()).toEqual(excludedCodes);

  // IOF XML (banor) under Fil: bara de fyra behållna varianterna av Natt.
  await owner.getByRole("button", { name: /^Fil/ }).click();
  await owner.getByRole("menuitem", { name: "Fil och versioner …" }).click();
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByTestId("course-setting-iof").click();
  const xml = await readFile(await (await downloadPromise).path(), "utf8");
  const names = [...xml.matchAll(/<Name>Natt (\w+)<\/Name>/g)].map(match => match[1]!).sort();
  expect(names).toHaveLength(4);
  expect(names).toContain("ACE");
  for (const code of excludedCodes) expect(names).not.toContain(code);
  await owner.keyboard.press("Escape");

  // Telefonen: tabellen på 390 px; sidan rullar inte i sidled.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByTestId("course-setting-field-more")).toBeVisible({ timeout: 60_000 });
  await mapReady(phone);
  await phone.getByTestId("course-setting-field-more").click();
  await phone.getByRole("tab", { name: "Banor" }).click();
  await courseRow(phone, "Natt").click();
  const phonePanel = phone.getByTestId("course-setting-variants");
  await expect(phone.getByTestId("course-setting-variants-summary")).toHaveText("8 varianter, 4 används (4 bortvalda som längre)");
  await phonePanel.scrollIntoViewIfNeeded();
  expect(await phone.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (shots) await phone.screenshot({ path: `${shots}/banlaggning-gaffling-urval-tabell-390.png` });
  await phonePanel.getByTestId("course-setting-variants-prune").scrollIntoViewIfNeeded();
  await phonePanel.getByRole("button", { name: "Förhandsgranska" }).click();
  await expect(phone.getByTestId("course-setting-variants-preview")).toBeVisible();
  expect(await phone.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (shots) await phone.screenshot({ path: `${shots}/banlaggning-gaffling-urval-forhand-390.png` });
  await phoneContext.close();
});
