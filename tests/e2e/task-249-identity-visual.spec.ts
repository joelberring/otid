import { expect, test } from "@playwright/test";
import { entryIdentityAdminListResponseSchema, entryIdentityHistoryResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const identity = { givenName: "Anna", familyName: "Lindell", organisationName: "Gustavsbergs OK" };
const list = entryIdentityAdminListResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: 5, entries: [
  { id: entryId, classId: raceId, className: "D55", version: 3, identity },
  { id: "20000000-0000-4000-8000-000000000002", classId: raceId, className: "H21", version: 1,
    identity: { givenName: "Erik", familyName: "Exempel", organisationName: null } }
] });
const history = entryIdentityHistoryResponseSchema.parse({ formatVersion: 1, raceId, entryId, nextCursor: null, items: [
  { requestId: "30000000-0000-4000-8000-000000000001", classId: raceId,
    previousIdentity: { givenName: "Anna", familyName: "Lynell", organisationName: "Gustavsbergs OK" },
    identity, entryVersionBefore: 2, entryVersionAfter: 3, snapshotVersionBefore: 4, snapshotVersionAfter: 5,
    changedAt: "2026-09-01T12:00:00Z" }
] });

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`TASK249 neutral identity ${viewport.width}: compact correction and history`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let patches = 0;
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === `/api/admin/races/${raceId}/entry-identity/session` && request.method() === "GET")
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId,
          capability: "CHANGE_ENTRY_IDENTITY", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } });
      if (path === `/api/admin/races/${raceId}/entry-identity` && request.method() === "GET")
        return route.fulfill({ status: 200, json: list });
      if (path === `/api/admin/races/${raceId}/entries/${entryId}/identity/history` && request.method() === "GET")
        return route.fulfill({ status: 200, json: history });
      if (request.method() === "PATCH") patches++;
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/entry-identity`);
    const search = page.getByRole("searchbox", { name: "Sök namn, klubb eller klass" });
    const select = page.getByRole("combobox", { name: "Deltagare" });
    await expect(search).toBeVisible();
    await search.fill("lindell");
    await expect(select.locator("option")).toHaveCount(2);
    await select.selectOption(entryId);
    await expect(page.getByRole("heading", { name: "Rättningshistorik" })).toBeVisible();
    await expect(page.locator(".entry-identity-history")).toContainText("Lynell");
    await page.getByLabel("Efternamn", { exact: true }).fill("Lindéll");
    await expect(page.getByLabel("Klubb", { exact: true })).toHaveValue("Gustavsbergs OK");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const fieldHeight = await page.getByLabel("Efternamn", { exact: true }).evaluate(element => element.getBoundingClientRect().height);
    expect(fieldHeight).toBeGreaterThanOrEqual(viewport.width === 390 ? 52 : 40);
    const buttonColor = await page.getByRole("button", { name: "Granska rättning" }).evaluate(element => getComputedStyle(element).backgroundColor);
    const channels = buttonColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
    expect(channels).toHaveLength(3);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(30);
    await page.screenshot({ path: test.info().outputPath(`identity-edit-${viewport.width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Granska rättning" }).click();
    await expect(page.locator(".entry-identity-review")).toContainText("Lindéll");
    await expect(search).toBeDisabled();
    expect(patches).toBe(0);
    await page.context().addCookies([{ name: "otid_entry_identity_admin_csrf", value: "c".repeat(43),
      url: test.info().project.use.baseURL as string }]);
    await page.getByRole("button", { name: "Bekräfta och spara" }).click();
    await expect(page.getByRole("button", { name: "Försök igen med samma begäran" })).toBeVisible();
    await expect(page.locator('.entry-identity-review[data-tone="uncertain"]')).toContainText("Svaret är okänt");
    expect(patches).toBe(1);
    await page.screenshot({ path: test.info().outputPath(`identity-unknown-${viewport.width}.png`), fullPage: true });
  });
}
