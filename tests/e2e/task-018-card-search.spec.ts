import { expect, test } from "@playwright/test";
import { entryCardAdminListResponseSchema, entryCardChangeRequestSchema } from "@o-tid/contracts";
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const data = entryCardAdminListResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: 7, entries: [
  { id: entryId, displayName: "Åsa Exempel", classId: raceId, className: "D21", version: 2,
    activeAssignment: { id: "30000000-0000-4000-8000-000000000001", cardNumber: "123456" }, multipleActiveAssignments: false },
  { id: "20000000-0000-4000-8000-000000000002", displayName: "Åsa Exempel", classId: "10000000-0000-4000-8000-000000000002",
    className: "Öppen", version: 1, activeAssignment: null, multipleActiveAssignments: true }
] });

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`TASK248 card search ${viewport.width}: explicit target and immutable retry`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let authorized = false;
    const requests: { url: string; key: string; body: string }[] = [];
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith("/entry-card-session")) {
        authorized = request.method() === "POST";
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId,
          capability: "CHANGE_ENTRY_CARD", expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (path.endsWith("/entry-cards")) return route.fulfill({ status: authorized ? 200 : 401,
        json: authorized ? data : { formatVersion: 1, error: "UNAUTHORIZED" } });
      if (path === `/api/races/${raceId}/entries/${entryId}/card` && request.method() === "PATCH") {
        const key = request.headers()["idempotency-key"]!;
        requests.push({ url: path, key, body: request.postData()! });
        const body = entryCardChangeRequestSchema.parse(request.postDataJSON());
        if (requests.length === 1) return route.fulfill({ status: 500, json: { error: "SYNTHETIC_UNKNOWN" } });
        return route.fulfill({ status: 200, json: { formatVersion: 1, replayed: true, requestId: key.slice("entry-card-change:".length),
          raceId, entryId, classId: body.expectedClassId, previousAssignment: body.expectedAssignment,
          activeAssignment: { id: "30000000-0000-4000-8000-000000000003", cardNumber: body.cardNumber },
          entryVersionBefore: body.expectedEntryVersion, entryVersionAfter: body.expectedEntryVersion + 1,
          snapshotVersionBefore: body.expectedSnapshotVersion, snapshotVersionAfter: body.expectedSnapshotVersion + 1,
          changedAt: "2026-09-09T10:00:00Z" } });
      }
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/cards`);
    await expect(page.getByRole("status")).toContainText("Behörighet saknas");
    await page.getByLabel("Brickbytesbehörighet").fill(`otid_org_entry_card_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    const search = page.getByRole("searchbox"), select = page.getByRole("combobox", { name: "Deltagare", exact: true });
    await expect(select).toHaveValue("");
    await search.fill("a\u030asa");
    await expect(select.locator("option")).toHaveCount(3);
    await search.fill("öPPEN");
    await expect(select.locator("option")).toHaveCount(2);
    await select.selectOption(data.entries[1]!.id);
    await expect(page.locator(".entry-card-admin").getByRole("alert")).toContainText("Flera aktiva brickkopplingar");
    await search.fill("123456");
    await expect(select).toHaveValue("");
    await select.selectOption(entryId);
    await page.getByLabel("Ny bricka", { exact: true }).fill("987654");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cardBox = await page.getByLabel("Ny bricka", { exact: true }).boundingBox();
    expect(cardBox?.height).toBeGreaterThanOrEqual(viewport.width === 390 ? 52 : 32);
    await page.screenshot({ path: test.info().outputPath(`card-edit-${viewport.width}.png`), fullPage: true });
    await search.fill("ingen träff");
    await expect(select.locator("option")).toHaveCount(1);
    await expect(page.getByLabel("Ny bricka", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Rensa sökning", exact: true }).click();
    await expect(search).toHaveValue("");
    await select.selectOption(entryId);
    await page.getByLabel("Ny bricka", { exact: true }).fill("987654");
    await page.getByRole("button", { name: "Granska brickbyte", exact: true }).click();
    await expect(search).toBeDisabled();
    await expect(select).toBeDisabled();
    await page.context().addCookies([{ name: "otid_entry_card_admin_csrf", value: "c".repeat(43),
      url: test.info().project.use.baseURL as string }]);
    await page.getByRole("button", { name: "Bekräfta och byt bricka", exact: true }).click();
    const retry = page.getByRole("button", { name: "Försök igen med samma begäran", exact: true });
    await expect(retry).toBeVisible();
    await expect(search).toBeDisabled();
    expect(requests).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`card-search-${viewport.width}.png`), fullPage: true });
    await retry.click();
    await expect(page.getByRole("link", { name: "Gå till explicit omräkning" })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await search.fill("Åsa"); authorized = false;
    await page.getByRole("button", { name: "Läs in aktuella brickor", exact: true }).click();
    await expect(search).toHaveCount(0);
    await page.getByLabel("Brickbytesbehörighet").fill(`otid_org_entry_card_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await expect(search).toHaveValue("");
  });
}
