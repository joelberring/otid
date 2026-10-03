import { expect, test } from "@playwright/test";
import { entryStartTimeAdminListResponseSchema, entryStartTimeChangeRequestSchema } from "@o-tid/contracts";
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const data = entryStartTimeAdminListResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm", entries: [
  { id: entryId, displayName: "Åsa Exempel", classId: raceId, className: "D21", version: 2, fixedStartTime: "2026-09-09T08:00:00Z" },
  { id: "20000000-0000-4000-8000-000000000002", displayName: "Åsa Exempel", classId: raceId,
    className: "Öppen", version: 1, fixedStartTime: null }
] });
for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`TASK247 start time search ${viewport.width}: explicit selection and immutable UTC retry`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let authorized = false;
    const requests: { url: string; key: string; body: string }[] = [];
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith("/entry-start-time-session")) {
        authorized = request.method() === "POST";
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId,
          capability: "CHANGE_ENTRY_START_TIME", expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (path.endsWith("/entry-start-times")) return route.fulfill({ status: authorized ? 200 : 401,
        json: authorized ? data : { error: "UNAUTHORIZED" } });
      if (path === `/api/races/${raceId}/entries/${entryId}/start-time` && request.method() === "PATCH") {
        const key = request.headers()["idempotency-key"]!;
        requests.push({ url: path, key, body: request.postData()! });
        const body = entryStartTimeChangeRequestSchema.parse(request.postDataJSON());
        if (requests.length === 1) return route.fulfill({ status: 500, json: { error: "SYNTHETIC_UNKNOWN" } });
        return route.fulfill({ status: 200, json: { formatVersion: 1, replayed: true,
          requestId: key.slice("entry-start-time-change:".length), raceId, entryId, classId: body.expectedClassId,
          previousFixedStartTime: body.expectedFixedStartTime, fixedStartTime: body.fixedStartTime,
          entryVersionBefore: body.expectedEntryVersion, entryVersionAfter: body.expectedEntryVersion + 1,
          snapshotVersionBefore: body.expectedSnapshotVersion, snapshotVersionAfter: body.expectedSnapshotVersion + 1,
          changedAt: "2026-09-09T10:00:00Z" } });
      }
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/start-times`);
    await expect(page.getByRole("status")).toContainText("Behörighet saknas");
    async function login() {
      await page.getByLabel("Starttidsbehörighet").fill(`otid_org_entry_start_time_v1.${raceId}.${"a".repeat(43)}`);
      await page.getByRole("button", { name: "Logga in", exact: true }).click();
    }
    await login();
    const search = page.getByRole("searchbox"), select = page.getByRole("combobox", { name: "Deltagare", exact: true });
    await search.fill("a\u030asa");
    await expect(select.locator("option")).toHaveCount(3);
    await expect(select).toHaveValue("");
    await search.fill("öPPEN");
    await expect(select.locator("option")).toHaveCount(2);
    expect(await page.getByRole("button", { name: "Rensa sökning", exact: true })
      .evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
    await select.selectOption(data.entries[1]!.id);
    await expect(page.locator(".entry-start-time-admin")).toContainText("Nuvarande starttid: Saknas");
    async function fillTime() {
      await page.getByLabel("Startdatum", { exact: true }).fill("2026-09-09");
      await page.getByLabel("Klockslag", { exact: true }).fill("11:00");
      await page.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
    }
    await fillTime();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dateBox = await page.getByLabel("Startdatum", { exact: true }).boundingBox();
    expect(dateBox?.height).toBeGreaterThanOrEqual(viewport.width === 390 ? 44 : 32);
    await page.screenshot({ path: test.info().outputPath(`start-time-edit-${viewport.width}.png`), fullPage: true });
    await search.fill("ingen träff");
    await expect(select).toHaveValue("");
    await expect(select.locator("option")).toHaveCount(1);
    await expect(page.getByLabel("Klockslag", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Rensa sökning", exact: true }).click();
    await select.selectOption(entryId);
    for (const label of ["Startdatum", "Klockslag", "UTC-offset"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
    await fillTime();
    await page.getByLabel("UTC-offset", { exact: true }).fill("+15:00");
    await page.getByRole("button", { name: "Granska ändring", exact: true }).click();
    await expect(page.locator(".entry-start-time-admin").getByRole("alert")).toHaveCount(0);
    expect(requests).toHaveLength(0);
    await page.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
    await page.getByRole("button", { name: "Granska ändring", exact: true }).click();
    await expect(search).toBeDisabled();
    await expect(select).toBeDisabled();
    for (const label of ["Startdatum", "Klockslag", "UTC-offset"]) await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    await expect(page.locator(".entry-start-time-admin").getByRole("alert")).toContainText("11:00:00 GMT+02:00");
    await expect(page.locator(".entry-start-time-admin").getByRole("alert")).toContainText("Europe/Stockholm");
    await page.context().addCookies([{ name: "otid_entry_start_time_admin_csrf", value: "c".repeat(43),
      url: test.info().project.use.baseURL as string }]);
    await page.getByRole("button", { name: "Bekräfta och spara starttid", exact: true }).click();
    const retry = page.getByRole("button", { name: "Försök igen med samma begäran", exact: true });
    await expect(retry).toBeVisible();
    await expect(search).toBeDisabled();
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ fixedStartTime: "2026-09-09T09:00:00.000Z" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`start-time-search-${viewport.width}.png`), fullPage: true });
    await retry.click();
    await expect(page.getByRole("link", { name: "Gå till explicit omräkning" })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await search.fill("Åsa"); authorized = false;
    await page.getByRole("button", { name: "Läs in aktuella tider", exact: true }).click();
    await expect(search).toHaveCount(0);
    await login();
    await expect(search).toHaveValue("");
  });
}
