import { expect, test, type Page } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * Steg 37 (PLAN.md): Om O-Tid utan inloggning, sidfoten med kontaktadressen på publika sidor och i arbetsytan, och
 * Hjälp i arbetsytan och på avläsningssidan: panelen visar stegets artiklar först, söker lokalt (utan å/ä/ö och
 * versaler) och stängs med Esc. Med E2E_SCREENSHOT_DIR sparas skärmbilder på 1280 och 390 px (step37-*.png).
 */
const contact = "otid@berring.se";

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("Om O-Tid och sidfoten utan inloggning", async ({ browser }) => {
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 844 } })).newPage();
  await visitor.goto("/");
  const footer = visitor.getByRole("contentinfo", { name: "Om O-Tid och kontakt" });
  await expect(footer).toContainText("O-Tid · beta · Frågor:");
  await expect(footer.getByRole("link", { name: contact })).toHaveAttribute("href", `mailto:${contact}`);
  await footer.getByRole("link", { name: "Om O-Tid" }).click();
  await visitor.waitForURL(/\/om$/);

  await expect(visitor.getByRole("heading", { name: "Om O-Tid", level: 1 })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Beta – fritt att använda" })).toBeVisible();
  await expect(visitor.getByText("utvecklat av Joel Berring med AI-stöd", { exact: false })).toBeVisible();
  const features = visitor.getByRole("heading", { name: "Tekniska funktioner" }).locator("xpath=following-sibling::ul[1]");
  await expect(features.getByRole("listitem")).toHaveCount(11);
  await expect(features).toContainText("WebUSB i Chrome på Android-platta");
  await expect(features).toContainText("ROC");
  await expect(visitor.getByRole("main").getByRole("link", { name: contact })).toHaveAttribute("href", `mailto:${contact}`);
  await expect(visitor.getByRole("link", { name: "Skapa konto eller logga in" })).toHaveAttribute("href", "/organizer");
  await visitor.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(visitor);
  await reviewScreenshots(visitor, "step37-om");

  // Sidfoten syns inte på papper.
  await visitor.emulateMedia({ media: "print" });
  await expect(visitor.getByRole("contentinfo", { name: "Om O-Tid och kontakt" })).toBeHidden();
  await visitor.close();
});

test("Hjälp i arbetsytan och på avläsningssidan", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `hjalp.${suffix}@exempel.se`, "Hanna Hjälp");
  await warmRoute(owner, "/om");

  // Mina tävlingar har Hjälp med artikeln om att skapa en tävling först.
  await owner.getByRole("button", { name: "Hjälp" }).click();
  let panel = owner.getByRole("dialog", { name: "Hjälp" });
  await expect(panel.getByRole("region", { name: "Hjälp för den här sidan" })).toContainText("Skapa en tävling och välj typ");
  await owner.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  const raceId = await createRace(owner, `Hjälpkvällen ${suffix}`, undefined, "Tävling");

  // Arbetsytan: sidfoten längst ned, länkarna i en ny flik.
  // I arbetsytan ligger sidfoten i innehållet (ingen landmärkesroll); den globala sidfoten är dold.
  const footer = owner.locator("footer.site-footer").filter({ visible: true });
  await expect(footer).toHaveCount(1);
  await expect(footer).toContainText("O-Tid · beta · Frågor: otid@berring.se · Om O-Tid");
  await expect(footer.getByRole("link", { name: "Om O-Tid" })).toHaveAttribute("target", "_blank");
  await expect(footer.getByRole("link", { name: contact })).toHaveAttribute("href", `mailto:${contact}`);

  // Hjälp öppnar panelen med stegets artiklar först (en ny tävling står på Banor).
  const help = owner.getByRole("button", { name: "Hjälp" });
  await help.click();
  panel = owner.getByRole("dialog", { name: "Hjälp" });
  await expect(panel).toBeVisible();
  const search = panel.getByRole("searchbox", { name: "Sök i hjälpen" });
  await expect(search).toBeFocused();
  const here = panel.getByRole("region", { name: "Hjälp för den här sidan" });
  await expect(here.locator("details > summary").first()).toHaveText("Banor");
  await expect(panel.getByRole("region", { name: "Fler hjälpartiklar" })).toContainText("Funktionärer");
  await expect(panel.getByRole("link", { name: /Om O-Tid/ })).toHaveAttribute("href", "/om");
  await expect(panel.getByRole("link", { name: contact })).toHaveAttribute("href", `mailto:${contact}`);

  // Sökningen bryr sig inte om versaler eller å/ä/ö, och träffarna är utfällda.
  await search.fill("OKAND BRICKA");
  await expect(panel.getByRole("status")).toContainText("träff");
  const unknown = panel.locator("details[data-help-article='okand-bricka']");
  await expect(unknown).toHaveAttribute("open", "");
  await expect(unknown).toContainText("Det är samma löpare – använd den nya avläsningen");
  await search.fill("lottning avancerat");
  await expect(panel.locator("details[data-help-article]")).toHaveCount(1);
  await expect(panel.locator("details[data-help-article='start']")).toBeVisible();
  await search.fill("xyzzy");
  await expect(panel.getByRole("status")).toContainText("Inga träffar.");
  await expect(panel.locator("details[data-help-article]")).toHaveCount(0);
  await search.fill("");
  await expect(panel.locator("details[data-help-article='banor']")).not.toHaveAttribute("open", "");

  // Esc stänger (även med text i sökfältet) och fokus går tillbaka till knappen.
  await search.fill("start");
  await owner.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(help).toBeFocused();

  // 390 px: knappen syns i toppbalken och panelen tar hela bredden utan sidledsrullning.
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(help).toBeVisible();
  await reviewScreenshots(owner, "step37-arbetsyta");
  await owner.setViewportSize({ width: 390, height: 844 });
  await help.click();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalScroll(owner);
  await reviewScreenshots(owner, "step37-hjalp", [390]);
  await owner.setViewportSize({ width: 1280, height: 844 });
  await reviewScreenshots(owner, "step37-hjalp", [1280]);
  await panel.getByRole("button", { name: "Stäng" }).click();
  await expect(panel).toBeHidden();

  // Avläsningssidan: Hjälp med avläsningens artiklar; statusraden står kvar.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("station-status")).toBeVisible();
  await reviewScreenshots(owner, "step37-avlasning");
  await owner.getByRole("button", { name: "Hjälp" }).click();
  panel = owner.getByRole("dialog", { name: "Hjälp" });
  await expect(panel.getByRole("region", { name: "Hjälp för den här sidan" }).locator("details > summary").first())
    .toHaveText("Avläsning med station");
  await panel.getByRole("searchbox", { name: "Sök i hjälpen" }).fill("cp210x");
  await expect(panel.locator("details[data-help-article]")).toHaveCount(1);
  await expect(panel).toContainText("Anslut via USB (läsplatta)");
  await reviewScreenshots(owner, "step37-avlasning-hjalp");
  await owner.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(owner.getByTestId("station-status")).toBeVisible();
  await expect(owner.locator("footer.site-footer")).toHaveCount(0);
});
