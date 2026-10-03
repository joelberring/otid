import { expect, test } from "@playwright/test";
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const otherId = "20000000-0000-4000-8000-000000000002";
const identity = { id: entryId, displayName: "Åsa Exempel" };
const readout = { id: "30000000-0000-4000-8000-000000000001", cardNumber: "123456",
  readAt: "2026-09-09T10:00:00Z", entry: identity, firstServerAssessment: null };
const roster = { formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm", generatedAt: "2026-09-09T08:00:00Z",
  classes: [{ id: raceId, name: "D21", startRule: "FIXED", entries: [{ ...identity, organisationName: "Testklubben",
    fixedStartTime: "2026-09-09T08:00:00Z", cardNumber: "123456", multipleActiveAssignments: false }] }] };
for (const width of [1366, 390]) {
  test(`entry history ${width}: scoped pages, empty state and independent auth`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let sourceAuth = false, historyAuth = false, empty = false, foreign = false;
    const scopedRequests: string[] = [];
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path.endsWith("/start-list-session")) {
        sourceAuth = true;
        return route.fulfill({ json: { formatVersion: 1, raceId, capability: "VIEW_START_LIST", expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (path.endsWith("/start-list")) return route.fulfill({ status: sourceAuth ? 200 : 401, json: roster });
      if (path.endsWith("/readout-result-history-session")) {
        historyAuth = request.method() === "POST";
        return route.fulfill({ json: { formatVersion: 1, raceId, capability: "VIEW_READOUT_RESULT_HISTORY", expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (path === `/api/admin/races/${raceId}/entries/${entryId}/readouts`) {
        scopedRequests.push(url.search);
        if (!historyAuth) return route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
        const older = url.searchParams.get("cursor") === "older";
        return route.fulfill({ json: { formatVersion: 1, raceId, entry: foreign ? { id: otherId, displayName: "Bo Exempel" } : identity,
          page: { formatVersion: 10, raceId, items: empty ? [] : [{ ...readout,
            ...(older ? { id: "30000000-0000-4000-8000-000000000002", cardNumber: "987654" } : {}) }],
          nextCursor: empty || older ? null : "older" } } });
      }
      if (path === `/api/admin/races/${raceId}/readouts`) return route.fulfill({ status: historyAuth ? 200 : 401,
        json: { formatVersion: 10, raceId, items: [{ ...readout, entry: { id: otherId, displayName: "Bo Exempel" } }], nextCursor: null } });
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/start-list`);
    await expect(page.getByRole("status")).toContainText("Logga in med startlistebehörighet");
    await page.getByLabel("Startlistebehörighet").fill(`otid_org_start_list_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await page.locator(".start-list-corrections summary").click();
    await page.getByRole("button", { name: "Visa avläsningshistorik", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${raceId}/history$`));
    await expect(page.getByRole("status")).toContainText("Inloggning med historikbehörighet krävs");
    expect(scopedRequests).toEqual([]);
    await expect(page.getByText(identity.displayName, { exact: true })).toHaveCount(0);
    async function login() {
      await page.getByLabel("Accesscredential för avläsningshistorik").fill(`otid_org_readout_result_history_v1.${raceId}.${"b".repeat(43)}`);
      await page.getByRole("button", { name: "Logga in säkert", exact: true }).click();
    }
    await login();
    await page.getByRole("button", { name: "Visa deltagarens avläsningar", exact: true }).click();
    const cards = page.locator(".readout-history-list > article");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(identity.displayName);
    await expect(page.locator(".readout-history-admin")).not.toContainText("Bo Exempel");
    await page.getByRole("button", { name: "Visa äldre avläsningar", exact: true }).click();
    await expect(cards).toHaveCount(2);
    expect(scopedRequests.some(query => query.includes("cursor=older"))).toBe(true);
    await expect(page.getByRole("button", { name: "Visa äldre avläsningar", exact: true })).toHaveCount(0);
    await expect(page.locator(".readout-history-admin")).toContainText("Manuella resultat utan avläsning ingår inte");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`entry-history-${width}.png`), fullPage: true });
    historyAuth = false;
    await page.getByRole("button", { name: "Uppdatera uttryckligen", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Inloggning med historikbehörighet krävs");
    await expect(cards).toHaveCount(0);
    await expect(page.locator(".readout-history-admin")).not.toContainText(identity.displayName);
    empty = true;
    await login();
    await page.getByRole("button", { name: "Visa deltagarens avläsningar", exact: true }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.locator(".readout-history-admin")).toContainText(identity.displayName);
    await expect(page.locator(".readout-history-admin")).toContainText("Inga kopplade avläsningar");
    foreign = true;
    await page.getByRole("button", { name: "Uppdatera uttryckligen", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("ogiltigt historiksvar");
    await expect(page.locator(".readout-history-admin")).not.toContainText("Bo Exempel");
    await expect(page.locator(".readout-history-admin")).not.toContainText("Inga kopplade avläsningar");
    await page.getByRole("button", { name: "Visa alla avläsningar", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Bo Exempel");
    await expect(page).toHaveURL(new RegExp(`/admin/${raceId}/history$`));
  });
}
