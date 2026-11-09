import { expect, test } from "@playwright/test";

/**
 * Idéerna 2026-11-08 (engelska): en webbläsare utan svenska får startsidan, sidfoten och Om O-Tid på engelska (med avsnittet
 * om klubbar utanför Sverige); länken byter språk, valet sparas och går att byta tillbaka. En svensk webbläsare får svenska.
 */
test("språk: engelska för den som inte har svenska, och språkvalet", async ({ browser }) => {
  const english = await browser.newContext({ locale: "en-US" });
  const page = await english.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events");
  await expect(page.getByRole("contentinfo")).toContainText("About O-Tid");
  await page.goto("/om");
  await expect(page.getByRole("heading", { name: "Clubs outside Sweden" })).toBeVisible();
  await expect(page.locator("[data-testid=language-switch]:visible")).toHaveText("Svenska");
  await page.locator("[data-testid=language-switch]:visible").click();
  await expect(page).toHaveURL(/\/om$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Om O-Tid");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tävlingar");
  await page.locator("[data-testid=language-switch]:visible").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events");
  await english.close();

  const swedish = await browser.newContext();
  const svPage = await swedish.newPage();
  await svPage.goto("/");
  await expect(svPage.getByRole("heading", { level: 1 })).toHaveText("Tävlingar");
  await expect(svPage.locator("[data-testid=language-switch]:visible")).toHaveText("English");
  await swedish.close();
});
