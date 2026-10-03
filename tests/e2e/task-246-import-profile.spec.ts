import { expect, test } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";
const grantId = "10000000-0000-4000-8000-000000000002";

for (const profile of [
  { environment: "testeventor-se", label: "Testeventor" },
  { environment: "production-se", label: "Eventor Sverige – produktion" },
] as const) {
  test(`TASK246 visar verifierad ${profile.label} på neutral importsida`, async ({ page }) => {
    await page.setViewportSize({ width: profile.environment === "testeventor-se" ? 390 : 1280, height: 850 });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/admin/races/${raceId}/import-session` && route.request().method() === "GET") {
        return route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
      }
      if (path === `/api/admin/races/${raceId}/eventor-entry-import/preview` && route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({ formatVersion: 1, grantId });
        return route.fulfill({ status: 200, json: {
          formatVersion: 2, grantId, environment: profile.environment,
          eventClassesSourceHash: "a".repeat(64), entriesSourceHash: "b".repeat(64),
          entriesCount: 2,
          sourceClasses: [{ externalClassId: "D21", name: "D21", entryCount: 2 }],
          targetClasses: [{ classId: "10000000-0000-4000-8000-000000000003", name: "D21" }],
        } });
      }
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/imports`);
    const panel = page.getByRole("region", { name: "Importera deltagare från Eventor" });
    await expect(panel).toBeVisible();
    const iofLogin = page.getByRole("heading", { name: "Logga in för IOF-import" });
    const iofBox = await iofLogin.boundingBox(), eventorBox = await panel.boundingBox();
    expect(iofBox && eventorBox && (profile.environment === "production-se"
      ? eventorBox.x > iofBox.x : eventorBox.y > iofBox.y)).toBe(true);
    await expect(panel.getByText("Verifierad källa")).toHaveCount(0);
    await panel.getByRole("textbox", { name: "Importbidragets UUID" }).fill(grantId);
    await panel.getByRole("button", { name: "Hämta förhandsvisning" }).click();
    await expect(panel.getByText(`Verifierad källa: ${profile.label}`)).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Koppla klasser" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const input = panel.getByRole("textbox", { name: "Importbidragets UUID" });
    expect((await input.boundingBox())?.height).toBeGreaterThanOrEqual(profile.environment === "testeventor-se" ? 44 : 36);
    await page.screenshot({ path: test.info().outputPath(`imports-${profile.environment}.png`), fullPage: true });
  });
}
