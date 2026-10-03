import { expect, test } from "@playwright/test";

const session = {
  formatVersion: 1,
  accountId: "11111111-1111-4111-8111-111111111111",
  displayName: "Syntetisk arrangör",
  expiresAt: "2026-10-01T00:00:00Z"
};

test("TASK272 utloggad, felaktig inloggning och tomt konto på dator och mobil", async ({ page }) => {
  const requests: string[] = [];
  let loginAttempts = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    if (request.method() === "GET" && path === "/api/organizer/session") {
      return route.fulfill({ status: 401, json: { formatVersion: 1, error: "UNAUTHORIZED" } });
    }
    if (request.method() === "POST" && path === "/api/organizer/login") {
      loginAttempts += 1;
      return loginAttempts % 2 === 1
        ? route.fulfill({ status: 401, json: { formatVersion: 1, error: "UNAUTHORIZED" } })
        : route.fulfill({ json: session });
    }
    if (request.method() === "GET" && path === "/api/organizer/events") {
      return route.fulfill({ json: { formatVersion: 1, events: [] } });
    }
    return route.abort();
  });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/organizer");
    const loginPanel = page.getByRole("heading", { name: "Logga in" }).locator("xpath=ancestor::section[1]");
    await expect(loginPanel).toBeVisible();
    await expect(loginPanel.getByRole("link", { name: "Aktivera konto med inbjudningskod" }))
      .toHaveAttribute("href", "/activate");
    await expect(loginPanel.getByRole("link", { name: "Glömt lösenordet?" }))
      .toHaveAttribute("href", "/recover");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`organizer-login-${width}.png`) });

    await loginPanel.getByLabel("Inloggningsnamn").fill("syntetisk.arrangor");
    await loginPanel.getByLabel("Lösenord").fill("syntetiskt-ogiltigt-losenord");
    await loginPanel.getByRole("button", { name: "Logga in" }).click();
    await expect(loginPanel.getByRole("alert")).toHaveText("Inloggningsnamn eller lösenord stämmer inte.");
    await expect(loginPanel.getByLabel("Lösenord")).toHaveValue("");
    expect(page.url()).not.toContain("syntetiskt-ogiltigt-losenord");
    const storedSecrets = await page.evaluate(() => [localStorage, sessionStorage]
      .flatMap((storage) => Array.from({ length: storage.length }, (_, index) =>
        storage.getItem(storage.key(index) ?? "") ?? ""))
      .some((value) => value.includes("syntetiskt-ogiltigt-losenord")));
    expect(storedSecrets).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`organizer-login-error-${width}.png`) });

    await loginPanel.getByLabel("Lösenord").fill("syntetiskt-giltigt-losenord");
    await loginPanel.getByRole("button", { name: "Logga in" }).click();
    await expect(page.getByText("Inga tävlingar ännu")).toBeVisible();
    await expect(page.getByText(/be en eventägare ge ditt konto medadministratörsåtkomst/)).toBeVisible();
    const createLink = page.getByRole("link", { name: "Gå till Skapa tävling" });
    await expect(createLink).toHaveAttribute("href", "#organizer-create-event");
    await page.screenshot({ path: test.info().outputPath(`organizer-empty-${width}.png`) });
    await createLink.click();
    await expect(page).toHaveURL(/#organizer-create-event$/);
    await expect(page.getByRole("heading", { name: "Skapa tävling" })).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    const buttonHeights = await page.locator("main button").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height));
    expect(buttonHeights.every((height) => height >= 44)).toBe(true);
    const inputHeights = await page.locator("main input").evaluateAll((inputs) =>
      inputs.map((input) => input.getBoundingClientRect().height));
    expect(inputHeights.every((height) => height >= 48)).toBe(true);
  }

  expect(loginAttempts).toBe(4);
  expect(requests.every((request) => ["GET /api/organizer/session", "POST /api/organizer/login",
    "GET /api/organizer/events"].includes(request))).toBe(true);
  expect(requests).toContain("GET /api/organizer/events");
});
