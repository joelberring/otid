import { expect, test } from "@playwright/test";
import { createRace, publishRaceViaApi, registerAccount, unique } from "./helpers";

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

/** Del 2: tävlingssidan och resultatlistan på engelska för en besökare med engelska (tävlingen skapas på svenska). */
test("språk: tävlingssidan och resultatlistan på engelska", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `sprak.${suffix}@exempel.se`, "Sune Språk");
  const name = `Evening training ${suffix}`;
  const raceId = await createRace(owner, name, undefined, "Träning");
  await publishRaceViaApi(owner, raceId);
  const visitor = await (await browser.newContext({ locale: "en-GB" })).newPage();
  await visitor.goto(`/?q=${suffix}`);
  await visitor.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(visitor.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(visitor.getByRole("link", { name: /^Results/ })).toContainText("The results show here when the first runners have read out.");
  await expect(visitor.getByText("Training", { exact: false }).first()).toBeVisible();
  await visitor.getByRole("link", { name: /^Results/ }).click();
  await expect(visitor.getByRole("link", { name: "‹ Event page" })).toBeVisible();
  await expect(visitor.getByRole("toolbar", { name: "List tools" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "By class" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Print" })).toBeVisible();
  // Del 3: Live.
  await visitor.getByRole("link", { name: "‹ Event page" }).click();
  await visitor.getByRole("link", { name: /^Live/ }).click();
  await expect(visitor.getByRole("heading", { name: "No finishers yet – the page updates by itself." })).toBeVisible();
  // Del 5: QR-sidan.
  await visitor.goto(visitor.url().replace(/\/live$/, "/qr"));
  await expect(visitor.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(visitor.getByText("Results and split times")).toBeVisible();
});

/** Del 4: inloggningen och Skapa konto på engelska. */
test("språk: inloggningen på engelska", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "en-US" })).newPage();
  await page.goto("/organizer");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("button", { name: "No account? Create one" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.goto("/recover");
  await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();
  await page.goto("/verify");
  await expect(page.getByText("The link is missing its key. Open the link in the email again.")).toBeVisible();
});

/** Del 7: Mitt konto och kontomenyn på engelska för den som valt engelska. */
test("språk: Mitt konto på engelska", async ({ browser }) => {
  const owner = await registerAccount(browser, `konto.${unique()}@exempel.se`, "Kim Konto");
  await owner.goto(`/sprak?till=en&tillbaka=${encodeURIComponent("/konto")}`);
  await expect(owner.getByRole("heading", { name: "My account", level: 1 })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Sign out from all devices" })).toBeVisible();
  await owner.getByRole("button", { name: "Account: Kim Konto" }).click();
  await expect(owner.getByRole("link", { name: "My events" }).first()).toBeVisible();
  await owner.goto(`/sprak?till=sv&tillbaka=${encodeURIComponent("/konto")}`);
  await expect(owner.getByRole("heading", { name: "Mitt konto", level: 1 })).toBeVisible();
});
