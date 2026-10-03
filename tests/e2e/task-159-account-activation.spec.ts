import { expect, test } from "@playwright/test";
import { accountInvitationActivationRequestSchema } from "@o-tid/contracts";

for (const width of [390, 1280]) {
  test(`TASK159 mottagaraktivering ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const requests: unknown[] = [];
    await page.route("**/api/account/activation", async route => {
      requests.push(route.request().postDataJSON() as unknown);
      return route.fulfill({ status: requests.length === 1 ? 400 : 201,
        json: requests.length === 1 ? { formatVersion: 1, error: "INVITATION_UNAVAILABLE" }
          : { formatVersion: 1, accountId: "10000000-0000-4000-8000-000000000001", loginName: "runner.test" } });
    });
    await page.goto("/activate");
    await expect(page.getByRole("heading", { name: "Aktivera ditt konto" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel("Användarnamn").fill("Runner.Test");
    await page.getByLabel("Engångskod").fill("A".repeat(43));
    await page.getByRole("button", { name: "Skapa mitt lösenord" }).click();
    const generated = await page.getByLabel("Ditt nya lösenord").textContent();
    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole("button", { name: "Aktivera konto" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Jag har sparat eller kopierat lösenordet/ }).check();
    await page.getByRole("button", { name: "Aktivera konto" }).click();
    await expect(page.locator("main [role='alert']")).toContainText("Aktiveringen kunde inte bekräftas");
    await page.getByRole("button", { name: "Försök igen med samma uppgifter" }).click();
    await expect(page.getByRole("heading", { name: "Kontot är aktiverat" })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    const parsed = accountInvitationActivationRequestSchema.parse(requests[0]);
    expect(parsed.loginName).toBe("runner.test");
    expect(parsed.password).toBe(generated);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await expect(page.getByRole("link", { name: "Logga in som arrangör" })).toHaveAttribute("href", "/organizer");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
