import { expect, test } from "@playwright/test";

/**
 * Demoläget del 2 (ägaren 2026-11-09): "Prova arbetsytan" på startsidan ger ett gästkonto med en egen övningstävling med
 * påhittade löpare. Gästläget syns vid kontomenyn, kontots sidor är stängda, tävlingen kan inte publiceras och "Avsluta provet"
 * loggar ut. Också på 390 px.
 */
for (const width of [1280, 390]) {
  test(`demoläget: prova arbetsytan utan konto (${width} px)`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    const form = page.getByTestId("home-guest-demo");
    await expect(form).toContainText("påhittade löpare");
    await form.screenshot({ path: `test-results/demolage-start-${width}.png` });
    await form.getByRole("button", { name: "Prova arbetsytan" }).click();
    await page.waitForURL(/\/admin\/[0-9a-f-]{36}\/manage$/, { timeout: 60_000 });
    const raceId = page.url().split("/admin/")[1]!.split("/")[0]!;
    await expect(page.getByTestId("guest-notice")).toContainText("Ingenting syns utåt");
    await expect(page.getByText("10 anmälda").first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `test-results/demolage-arbetsytan-${width}.png`, fullPage: false });

    // Banläggningen (med kontomenyn): gästläget vid menyn, bara "Skapa ett eget konto" och "Avsluta provet".
    await page.goto(`/admin/${raceId}/course-setting`);
    await expect(page.getByTestId("guest-badge")).toHaveText("Gästläge", { timeout: 30_000 });
    await page.getByRole("button", { name: "Konto: Gäst" }).click();
    const menu = page.getByTestId("account-menu");
    await expect(menu).toContainText("Ingenting syns utåt");
    await expect(menu.getByRole("link", { name: "Skapa ett eget konto" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Mitt konto" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Avsluta provet" })).toBeVisible();
    await page.screenshot({ path: `test-results/demolage-meny-${width}.png`, fullPage: false });
    await page.keyboard.press("Escape");

    // Ingen publicering och inga kontosidor för gästen.
    const csrf = (await context.cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
    const publish = await page.request.put(`/api/admin/races/${raceId}/administrator/race-publication`, {
      headers: { origin: baseURL!, "x-otid-csrf": csrf } });
    expect(publish.status()).toBe(403);
    expect((await (await page.request.get("/api/organizer/events")).json() as { error?: string }).error).toBeTruthy();

    await page.getByRole("button", { name: "Konto: Gäst" }).click();
    await page.getByTestId("account-menu").getByRole("button", { name: "Avsluta provet" }).click();
    await expect.poll(async () => (await (await page.request.get("/api/organizer/session")).json() as { authenticated?: boolean }).authenticated)
      .toBe(false);
    await context.close();
  });
}

test("demoläget: formuläret från en annan webbplats vägras", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-guest-demo")).toBeVisible();
  const response = await page.request.post("/api/demo/guest", { headers: { origin: "https://annan.example" }, maxRedirects: 0 });
  expect(response.status()).toBe(403);
});
