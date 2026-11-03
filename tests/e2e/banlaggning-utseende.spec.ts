import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0180 beslut 12: banans utseende och etiketten vid kontrollen. Kartfilen och en .ppen läses in (1:10 000-karta utan
 * skalning, så ISOM:s förstoring saknas och O-Tid varnar). I Inställningar sätts ringstorleken till 1,25: ringen blir
 * större på kartan och mm på papperet visas. På banan Lång väljs Nummer och kod: "1-31" på kartan och i förhandsvisningen.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

test("banläggning-utseende: större ringar och nummer och kod (1-31) på kartan och i utskriften", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `utseende.${suffix}@exempel.se`, "Ulla Utseende");
  const raceId = await createRace(owner, `Utseende ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await owner.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  const overprint = owner.getByTestId("course-setting-overprint");
  await expect(overprint).toHaveAttribute("data-labels", /^1 2 /);
  const before = Number(await overprint.getAttribute("data-ring-mm"));
  expect(before).toBeCloseTo(5.35, 2);

  // Inställningar → Utseende: ringstorleken 1,25 (fritt tal, Enter sparar).
  await owner.getByRole("tab", { name: "Inställningar" }).click();
  const appearance = owner.getByTestId("course-setting-appearance");
  await expect(appearance.getByTestId("appearance-warnings")).toContainText("ISOM 2017-2 anger 8,03 mm");
  await expect(appearance.getByTestId("appearance-circleSize-paper")).toHaveText("ring 8,03 → 5,35 mm");
  await appearance.getByLabel("Ringstorlek").fill("1,25");
  await appearance.getByLabel("Ringstorlek").press("Enter");
  await expect(appearance.getByTestId("appearance-circleSize-paper")).toHaveText("ring 8,03 → 6,69 mm");
  await expect.poll(async () => Number(await overprint.getAttribute("data-ring-mm"))).toBeCloseTo(before * 1.25, 2);
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  // Snabbvalet Förstorat ger ISOM:s 150 % och varningen för ringen försvinner inte (1,25 är kvar), men linjen stämmer.
  await appearance.getByTestId("appearance-preset-enlarged").click();
  await expect(appearance.getByTestId("appearance-preset-enlarged")).toHaveAttribute("aria-pressed", "true");
  await expect(appearance.getByTestId("appearance-scales")).toContainText("0,53");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await reviewScreenshots(owner, "banlaggning-utseende-installningar", [1280]);
  await appearance.getByTestId("appearance-scales").scrollIntoViewIfNeeded();
  await reviewScreenshots(owner, "banlaggning-utseende-installningar-tabell", [1280]);

  // Banor → Vid kontrollen: Nummer och kod.
  await owner.getByRole("tab", { name: "Banor" }).click();
  const label = owner.getByTestId("course-setting-label");
  await expect(label.getByText("1-31")).toBeVisible();
  await label.getByLabel("Nummer och kod").check();
  await expect(overprint).toHaveAttribute("data-labels", /(^| )1-31( |$)/);
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });
  await reviewScreenshots(owner, "banlaggning-utseende-etikett", [1280]);

  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as {
    setting: { document: { courses: { id: string; name: string; labelKind: string }[]; event: { raw: { xml: string }[] } } } };
  const document = state.setting.document;
  const course = document.courses.find(item => item.name === "Lång")!;
  expect(course.labelKind).toBe("SEQUENCE_AND_CODE");
  expect(document.event.raw.find(raw => raw.xml.startsWith("<course-appearance"))!.xml)
    .toBe('<course-appearance control-circle-size-ratio="1.25" scale-sizes="RelativeTo15000" auto-leg-gap-size="3.5"/>');

  // Telefonen: Inställningar och Banor ligger bakom "Mer"; utseendet och etiketten går att nå och läsa på 390 px.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  const more = phone.getByTestId("course-setting-field-more");
  await expect(more).toBeVisible({ timeout: 60_000 });
  await more.click();
  // ADR-0188: flikarna som inte får plats ligger under lådans "Mer".
  await phone.getByTestId("course-setting-tab-more").click();
  await phone.getByRole("menuitem", { name: /Inställningar/ }).click();
  await expect(phone.getByTestId("appearance-circleSize")).toHaveValue("1.25");
  expect(await phone.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const shots = process.env.E2E_SCREENSHOT_DIR;
  if (shots) await phone.screenshot({ path: `${shots}/banlaggning-utseende-installningar-390.png` });
  await phone.getByTestId("appearance-scales").scrollIntoViewIfNeeded();
  if (shots) await phone.screenshot({ path: `${shots}/banlaggning-utseende-installningar-tabell-390.png` });
  await phone.getByRole("tab", { name: "Banor" }).click();
  await phone.getByTestId("course-setting-course").filter({ hasText: "Lång" }).click();
  await expect(phone.getByTestId("course-setting-label").getByLabel("Nummer och kod")).toBeChecked();
  await phone.getByTestId("course-setting-label").scrollIntoViewIfNeeded();
  if (shots) await phone.screenshot({ path: `${shots}/banlaggning-utseende-etikett-390.png` });
  await phoneContext.close();

  // Förhandsvisningen: samma text och den större ringen på papperet (1:10 000, förstorat: 5,35 · 1,25 · 1,5 = 10,0 mm).
  await owner.goto(`/admin/${raceId}/course-setting/print?course=${course.id}`);
  const sheet = owner.getByTestId("print-sheet");
  await expect(sheet).toHaveCount(1);
  await expect(sheet.locator("text[data-role='NUMBER']").filter({ hasText: /^1-31$/ })).toHaveCount(1);
  const ringMm = await sheet.evaluate(svg => {
    const paperWidth = Number.parseFloat(svg.getAttribute("width") ?? "0");
    const ring = svg.querySelector("[data-role='CONTROL']")!.getBoundingClientRect();
    return Math.max(ring.width, ring.height) / svg.getBoundingClientRect().width * paperWidth;
  });
  // Rutan räknas till linjens mitt (utan linjebredden 0,53 mm).
  expect(ringMm).toBeGreaterThan(9.2);
  expect(ringMm).toBeLessThan(10.3);
  await reviewScreenshots(owner, "banlaggning-utseende-forhandsvisning", [1280]);
});
