import { expect, test } from "@playwright/test";
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const otherId = "20000000-0000-4000-8000-000000000002";
const entry = { id: entryId, displayName: "Åsa Exempel", organisationName: "Testklubben",
  fixedStartTime: "2026-09-09T08:00:00Z", cardNumber: "123456", multipleActiveAssignments: false };
const list = { formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm", generatedAt: "2026-09-09T08:00:00Z",
  classes: [ { id: raceId, name: "D21", startRule: "FIXED", entries: [entry] },
    { id: otherId, name: "Öppen", startRule: "PUNCH", entries: [{ ...entry, id: otherId, displayName: "Bo Exempel", fixedStartTime: null }] } ] };
for (const width of [1366, 390]) for (const destination of ["cards", "start-times", "classes"] as const) {
  test(`${destination} ${width}: separate auth and explicit linked selection`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let sourceAuth = false, targetAuth = false, stale = false;
    const mutationRequests: string[] = [];
    const targetSession = destination === "classes" ? "entry-class-session" : destination === "cards" ? "entry-card-session" : "entry-start-time-session";
    const targetList = destination === "classes" ? "entry-classes" : destination === "cards" ? "entry-cards" : "entry-start-times";
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === "PATCH") mutationRequests.push(path);
      if (path.endsWith("/start-list-session")) {
        sourceAuth = true;
        return route.fulfill({ json: { formatVersion: 1, raceId, capability: "VIEW_START_LIST", expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (path.endsWith("/start-list")) return route.fulfill({ status: !sourceAuth ? 401 : stale ? 503 : 200, json: list });
      if (path.endsWith(`/${targetSession}`)) {
        targetAuth = true;
        return route.fulfill({ json: { formatVersion: 1, raceId,
          capability: destination === "classes" ? "CHANGE_ENTRY_CLASS" : destination === "cards" ? "CHANGE_ENTRY_CARD" : "CHANGE_ENTRY_START_TIME", expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (destination === "classes" && path.endsWith(`/${targetList}`)) return route.fulfill({ status: targetAuth ? 200 : 401,
        json: { formatVersion: 1, raceId, snapshotVersion: 7,
          classes: [{ id: raceId, name: "D21" }, { id: otherId, name: "Öppen" }],
          entries: [{ id: entryId, displayName: entry.displayName, organisationName: "Testklubben", classId: raceId, version: 1 },
            { id: otherId, displayName: "Bo Exempel", organisationName: null, classId: otherId, version: 1 }] } });
      if (path.endsWith(`/${targetList}`)) return route.fulfill({ status: targetAuth ? 200 : 401,
        json: { formatVersion: 1, raceId, snapshotVersion: 7,
          ...(destination === "start-times" ? { timeZone: "Europe/Stockholm" } : {}),
          entries: [{ id: entryId, displayName: entry.displayName, classId: raceId, className: "D21", version: 1,
            ...(destination === "cards" ? { activeAssignment: { id: otherId, cardNumber: "123456" }, multipleActiveAssignments: false }
              : { fixedStartTime: entry.fixedStartTime }) }] } });
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/start-list`);
    await expect(page.getByRole("status")).toContainText("Logga in med startlistebehörighet");
    await page.getByLabel("Startlistebehörighet").fill(`otid_org_start_list_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    const rows = page.locator(".start-list-table tbody tr");
    await expect(rows).toHaveCount(2);
    await rows.nth(1).locator("summary").click();
    await expect(rows.nth(1).getByRole("button", { name: "Ändra starttid", exact: true })).toHaveCount(0);
    stale = true;
    await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    await expect(page.locator(".start-list-admin").getByRole("alert")).toBeVisible();
    await expect(rows.locator("details")).toHaveCount(0);
    stale = false;
    await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    await rows.first().locator("summary").click();
    await rows.first().getByRole("button", { name: destination === "classes" ? "Ändra klass" : destination === "cards" ? "Ändra bricka" : "Ändra starttid", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${raceId}/${destination}$`));
    await expect(page.getByRole("status")).toContainText(destination === "classes" ? "Inloggning med klassbehörighet krävs" : "Behörighet saknas");
    await expect(page.getByText(entry.displayName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Välj länkad deltagare", exact: true })).toHaveCount(0);
    const credentialLabel = destination === "classes" ? "Accesscredential för klassändring" : destination === "cards" ? "Brickbytesbehörighet" : "Starttidsbehörighet";
    const prefix = destination === "classes" ? "otid_org_entry_class_v1" : destination === "cards" ? "otid_org_entry_card_v1" : "otid_org_entry_start_time_v1";
    await page.getByLabel(credentialLabel).fill(`${prefix}.${raceId}.${"b".repeat(43)}`);
    await page.getByRole("button", { name: destination === "classes" ? "Logga in säkert" : "Logga in", exact: true }).click();
    const select = page.getByRole("combobox", { name: "Deltagare", exact: true });
    if (destination === "classes") await expect(page.locator(".entry-class-entry")).toHaveCount(2);
    else await expect(select).toHaveValue("");
    await page.getByRole("button", { name: "Välj länkad deltagare", exact: true }).click();
    if (destination === "classes") {
      await expect(page.locator(".entry-class-entry")).toHaveCount(1);
      await expect(page.locator(".entry-class-entry")).toContainText(entry.displayName);
      await expect(page.getByRole("combobox", { name: "Ny klass", exact: true })).toHaveValue(raceId);
      await expect(page.getByRole("button", { name: "Ändra klass", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Visa alla deltagare", exact: true }).click();
      await expect(page.locator(".entry-class-entry")).toHaveCount(2);
    } else await expect(select).toHaveValue(entryId);
    expect(mutationRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`participant-${destination}-${width}.png`), fullPage: true });
    await page.reload();
    if (destination === "classes") await expect(page.locator(".entry-class-entry")).toHaveCount(2);
    else await expect(select).toHaveValue("");
    await expect(page.getByRole("button", { name: "Välj länkad deltagare", exact: true })).toHaveCount(0);
  });
}
