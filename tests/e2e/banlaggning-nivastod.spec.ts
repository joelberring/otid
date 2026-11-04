import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0212: nivåstödet. Den syntetiska kartan (kartfil.omap, 1:10 000) och kartfil.ppen. Inget syns förrän banläggaren
 * ber om det; målnivån Grön på banan Lång, "Hur lägger man en grön bana?" öppnar rätt guide, "Bedöm nivån" ger märken
 * med skäl och tips, "Visa på kartan" väljer kontrollen, avvikelserna blir notiser i Varningar först med valet. Telefonen
 * (390 px): samma panel i bladet nertill, utan att sidan går utanför.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function shot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

async function mapReady(page: Page) {
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await expect(page.getByText("Läser kartfilen …")).toHaveCount(0);
}

const courseRow = (page: Page, name: string) => page.getByTestId("course-setting-course").filter({ has: page.locator("strong").getByText(name, { exact: true }) });

test("banläggning-nivåstöd: målnivå, bedöm på begäran, skäl och tips, Visa på kartan, notiser i Varningar och telefonen", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `niva.${suffix}@exempel.se`, "Kim Lindqvist");
  owner.on("pageerror", error => console.log(`[datorn] ${error.message}`));
  const raceId = await createRace(owner, `Nivå ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });
  await mapReady(owner);

  // Banan Lång i fliken Banor: panelen finns, men ingen bedömning, inga märken och inga notiser innan man frågar.
  await owner.getByRole("tab", { name: "Banor" }).click();
  await courseRow(owner, "Lång").click();
  const panel = owner.getByTestId("course-setting-level");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("course-setting-level-summary")).toHaveCount(0);
  await expect(panel.getByTestId("course-setting-level-row")).toHaveCount(0);
  await expect(owner.getByTestId("course-setting-level-all")).toBeVisible();

  // Målnivån Grön och guiden för den.
  const select = owner.getByTestId("course-setting-level-select");
  await select.selectOption("GRON");
  await expect(select).toHaveValue("GRON");
  await expect(panel.getByTestId("course-setting-level-target")).toHaveText("Målnivå: Grön");
  await owner.getByTestId("course-setting-level-field").getByRole("button", { name: "Hur lägger man en grön bana?" }).click();
  const help = owner.getByTestId("help-panel");
  await expect(help.locator('[data-help-article="niva-gron"]')).toHaveAttribute("open", "");
  await expect(help.locator('[data-help-article="niva-gron"] > summary')).toHaveText("Så lägger du en grön bana");
  await help.getByRole("button", { name: "Stäng" }).click();
  await expect(help).toHaveCount(0);

  // Bedöm nivån: vägvalen räknas i Workern; sedan sammanfattning, märken, skäl och tips.
  await panel.getByRole("button", { name: "Bedöm nivån" }).click();
  const summary = panel.getByTestId("course-setting-level-summary");
  await expect(summary).toBeVisible({ timeout: 240_000 });
  await expect(summary).toHaveText(/^Banan motsvarar ungefär .+\..*svårare än Grön\./);
  const rows = panel.getByTestId("course-setting-level-row");
  expect(await rows.count()).toBeGreaterThanOrEqual(6);
  const harder = rows.and(owner.locator('[data-deviation="HARDER"]'));
  expect(await harder.count()).toBeGreaterThan(0);
  const first = harder.first();
  await expect(first.getByLabel(/^Nivå (Vit|Gul|Orange|Violett|Blå–Svart)$/)).toBeVisible();
  await expect(first).toContainText(/(Kontroll \d+|Start|Mål|Kontroll \d+–)/);
  await expect(first.getByTestId("course-setting-level-tip")).toHaveText(/^Tips: \S/);
  await summary.scrollIntoViewIfNeeded();
  await shot(owner, "banlaggning-nivastod-1280");

  // Visa på kartan väljer kontrollen eller sträckan.
  const controlRow = harder.and(owner.locator('[data-kind="control"]')).first();
  const label = (await controlRow.locator("strong").first().textContent())!;
  await controlRow.getByRole("button", { name: "Visa på kartan" }).click();
  await expect(owner.getByTestId("course-setting-selected")).toHaveText(new RegExp(label.replace(/^Kontroll /, "")));
  await owner.getByRole("tab", { name: "Banor" }).click();

  // Varningar: inga nivånotiser förrän valet är på; då notiser (inte fel) som går att godta.
  await owner.locator("#course-setting-tab-checks").click();
  const checks = owner.getByTestId("course-setting-checks");
  await expect(checks.locator('[data-group$=":LEVEL_DEVIATION"]')).toHaveCount(0);
  await owner.getByRole("tab", { name: "Banor" }).click();
  await panel.getByTestId("course-setting-level-notices").check();
  await owner.locator("#course-setting-tab-checks").click();
  const group = checks.locator('[data-group="NOTICE:LEVEL_DEVIATION"]');
  await expect(group).toBeVisible();
  await expect(group.getByTestId("course-setting-check").first()).toHaveText(/^Lång: .+målnivå Grön\)\. .+/);
  await expect(group.getByRole("button", { name: "Godta" }).first()).toBeVisible();

  // Målnivån och valet är sparade innan telefonen öppnar banläggningen.
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 20_000 });

  // Telefonen: samma panel i bladet, utan att sidan går utanför; Bedöm nivån på telefonen.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", error => console.log(`[telefonen] ${error.message}`));
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByTestId("course-setting-field-more")).toBeVisible({ timeout: 60_000 });
  await mapReady(phone);
  await phone.getByTestId("course-setting-field-more").click();
  await phone.getByRole("tab", { name: "Banor" }).click();
  await courseRow(phone, "Lång").click();
  const phonePanel = phone.getByTestId("course-setting-level");
  await expect(phonePanel.getByTestId("course-setting-level-target")).toHaveText("Målnivå: Grön");
  await expect(phonePanel.getByTestId("course-setting-level-summary")).toHaveCount(0);
  await phonePanel.getByRole("button", { name: "Bedöm nivån" }).click();
  await expect(phonePanel.getByTestId("course-setting-level-summary")).toBeVisible({ timeout: 240_000 });
  await expect(phonePanel.getByTestId("course-setting-level-tip").first()).toBeVisible();
  expect(await phone.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await phonePanel.getByTestId("course-setting-level-tip").first().scrollIntoViewIfNeeded();
  await shot(phone, "banlaggning-nivastod-390");
  await phoneContext.close();
});
