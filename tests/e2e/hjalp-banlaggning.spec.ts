import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * Grenen hjalp-banlaggning: Hjälp i banläggningen (flikens artiklar först), sökning med synonymer (kartdef), länkar
 * mellan artiklarna, ett "?" vid en svår ruta i Layout, Hjälp i klubbarkivet och allt på 390 px.
 * Skärmbilder i 1280 och 390 px till E2E_SCREENSHOT_DIR (hjalp-*.png).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string, widths: readonly number[] = [1280, 390]) {
  if (!shots) return;
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/hjalp-${name}-${width}.png` });
  }
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const summaries = (page: Page) => page.getByRole("dialog", { name: "Hjälp" }).getByRole("region", { name: "Hjälp för den här sidan" })
  .locator("details > summary");

test("hjälp i banläggningen, i Layout och i klubbarkivet", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `hjalpbana.${suffix}@exempel.se`, "Hanna Hjälp");
  // Utvecklingsservern kompilerar sidorna vid första besöket.
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  await warmRoute(owner, "/api/admin/races/00000000-0000-4000-8000-000000000000/administrator/session");
  const raceId = await createRace(owner, `Hjälpbanan ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/layout`);

  // Före kartfilen: Hjälp med banläggningens början först.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByRole("button", { name: "Hjälp", exact: true }).click();
  await expect(summaries(owner).first()).toHaveText("Kom igång: lägga en träning på 10 minuter");
  await expect(summaries(owner)).toContainText(["Banläggningen: öppna den och läs in kartan"]);
  await owner.keyboard.press("Escape");

  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });

  // Fliken Utskrift: utskriftens artiklar först, sedan det som gäller hela banläggningen.
  await owner.getByRole("tab", { name: "Utskrift" }).click();
  const help = owner.getByRole("button", { name: "Hjälp", exact: true });
  await help.click();
  const panel = owner.getByRole("dialog", { name: "Hjälp" });
  await expect(panel).toBeVisible();
  await expect(summaries(owner).nth(0)).toHaveText("Utskrift och förhandsvisning");
  await expect(summaries(owner).nth(1)).toHaveText("Kontrollbeskrivningen på kartan");
  await expect(summaries(owner).nth(2)).toHaveText("Papperet: texter, bilder, skalstock och nordpil");
  await expect(summaries(owner).nth(3)).toHaveText("Färger för tryck");
  await expect(summaries(owner).nth(4)).toHaveText("PDF för tryck och spegelvänd karta");
  await expect(summaries(owner)).toContainText(["Sparande, versioner och ångra"]);
  await shot(owner, "editor-utskrift");

  // Sökningen förstår kartdef (= kontrollbeskrivning).
  const search = panel.getByRole("searchbox", { name: "Sök i hjälpen" });
  await search.fill("kartdef");
  const description = panel.locator("details[data-help-article='kontrollbeskrivning']");
  await expect(description).toHaveAttribute("open", "");
  await expect(description).toContainText("Ingen (töm rutan)");
  await search.fill("gafflingar");
  await expect(panel.locator("details[data-help-article='gaffling']")).toBeVisible();

  // En länk i en artikel öppnar den andra artikeln överst och utfälld.
  await search.fill("");
  const printArticle = panel.locator("details[data-help-article='utskrift']");
  await printArticle.locator("summary").click();
  await printArticle.getByRole("link", { name: "PDF för tryck" }).click();
  const pdf = panel.locator("details[data-help-article='pdf-tryck']");
  await expect(pdf).toHaveAttribute("open", "");
  await expect(summaries(owner).first()).toHaveText("PDF för tryck och spegelvänd karta");
  await expect(pdf.locator("summary")).toBeFocused();
  await expect(pdf).toContainText("Spegelvänd kartan och banan i utskriften");
  // Kom igång är en numrerad lista med länkar.
  await search.fill("kom igång purple");
  const started = panel.locator("details[data-help-article='kom-igang-purple-pen']");
  await expect(started.locator("ol > li")).toHaveCount(8);
  await started.getByRole("link", { name: "Purple Pen, OCAD och IOF XML" }).click();
  await expect(panel.locator("details[data-help-article='purple-pen']")).toHaveAttribute("open", "");
  await owner.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(help).toBeFocused();

  // 390 px: bara "?" i raden överst, panelen tar hela bredden utan sidledsrullning.
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(help).toBeVisible();
  const box = (await help.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(help).toHaveText("?", { useInnerText: true });
  await help.click();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalScroll(owner);
  // Telefonen är fältläget: dess artikel står först.
  await expect(summaries(owner).first()).toHaveText("Fältläget i telefonen (hänga kontroller)");
  await shot(owner, "editor-falt", [390]);
  await owner.keyboard.press("Escape");
  await owner.setViewportSize({ width: 1280, height: 720 });

  // Papperet redigeras i Layout (ADR-0217 fas 3): "?" vid kontrollbeskrivningen på kartan.
  await owner.goto(`/admin/${raceId}/course-setting/layout?course=1`);
  await expect(owner.getByTestId("layout-courses").getByRole("checkbox", { name: "Alla", exact: true })).toBeVisible({ timeout: 60_000 });
  await owner.getByRole("button", { name: "Hjälp: Kontrollbeskrivningen på kartan" }).click();
  const placement = panel.locator("details[data-help-article='beskrivning-pa-kartan']");
  await expect(placement).toHaveAttribute("open", "");
  await expect(summaries(owner).first()).toHaveText("Kontrollbeskrivningen på kartan");
  await shot(owner, "layout-papperet");
  await owner.keyboard.press("Escape");
  // Papperet (texter, bilder, skalstock, nordpil): "?" vid rutan öppnar artikeln, som länkar till mallarna.
  await owner.getByRole("button", { name: "Hjälp: Papperet: texter, bilder, skalstock och nordpil" }).click();
  const paper = panel.locator("details[data-help-article='papperet']");
  await expect(paper).toHaveAttribute("open", "");
  await expect(paper).toContainText("+ Skalstock");
  await paper.getByRole("link", { name: "Mall för papperet och klippning av kartan" }).click();
  await expect(panel.locator("details[data-help-article='papperets-mallar']")).toContainText("Mitt bibliotek (alla mina tävlingar)");
  await owner.keyboard.press("Escape");
  await owner.setViewportSize({ width: 1280, height: 720 });

  // Klubbarkivet: Hjälp med flikens artiklar och "?" vid importen.
  await warmRoute(owner, "/organizer/clubs/00000000-0000-4000-8000-000000000000");
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Hjälp ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  await owner.getByRole("button", { name: "Hjälp", exact: true }).click();
  await expect(summaries(owner).first()).toHaveText("Klubbarkivet");
  await owner.keyboard.press("Escape");
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByRole("button", { name: "Hjälp", exact: true }).click();
  await expect(summaries(owner).first()).toHaveText("Importera till klubbarkivet från datorn");
  // ADR-0204: importen i webbläsaren i sex steg.
  await expect(panel.locator("details[data-help-article='arkiv-import'] ol > li")).toHaveCount(6);
  await owner.keyboard.press("Escape");
  await owner.getByRole("button", { name: "Hjälp: Importera till klubbarkivet från datorn" }).click();
  await expect(panel.locator("details[data-help-article='arkiv-import']")).toHaveAttribute("open", "");
  await owner.keyboard.press("Escape");
  await owner.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(owner);
  await owner.getByRole("button", { name: "Hjälp", exact: true }).click();
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalScroll(owner);
  await shot(owner, "klubbarkiv");
});
