import { expect, test } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const ownerEventId = "22222222-2222-4222-8222-222222222222";
const otherEventId = "33333333-3333-4333-8333-333333333333";
const addedGrantId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-29T12:00:00Z";
const events = [
  { eventId: ownerEventId, eventName: "Ägarens testtävling", role: "OWNER", startsOn: "2026-10-01",
    timeZone: "Europe/Stockholm", races: [{ raceId: "44444444-4444-4444-8444-444444444444",
      raceName: "Lång", raceDate: "2026-10-01" }] },
  { eventId: otherEventId, eventName: "Administrerad testtävling", role: "ADMIN", startsOn: "2026-10-02",
    timeZone: "Europe/Stockholm", races: [{ raceId: "55555555-5555-4555-8555-555555555555",
      raceName: "Medel", raceDate: "2026-10-02" }] }
];
const initialGrants = [
  { grantId: "66666666-6666-4666-8666-666666666666", accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    loginName: "anna.admin", displayName: "Anna Aktiv", role: "ADMIN", grantedAt: now, revokedAt: null },
  { grantId: "88888888-8888-4888-8888-888888888888", accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    loginName: "bert.admin", displayName: "Bert Historik", role: "ADMIN", grantedAt: now,
    revokedAt: "2026-09-29T13:00:00Z" }
];

test("TASK274 eventbunden medadministration visar historik och fryst tilldelning", async ({ page }) => {
  await page.context().addCookies([{ name: "otid_organizer_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3114" }]);
  const keys: string[] = [];
  const bodies: string[] = [];
  let granted = false;
  let wrongScopeCalls = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/organizer/session" && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, accountId, displayName: "Syntetisk arrangör",
        expiresAt: "2026-10-01T00:00:00Z" } });
    }
    if (path === "/api/organizer/events" && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, events } });
    }
    if (path.includes(otherEventId) && path.includes("administrators")) wrongScopeCalls += 1;
    if (path === `/api/organizer/events/${ownerEventId}/administrators` && request.method() === "GET") {
      const grants = granted ? [...initialGrants, { grantId: addedGrantId,
        accountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", loginName: "cilla.admin",
        displayName: "Cilla Ny", role: "ADMIN", grantedAt: now, revokedAt: null }] : initialGrants;
      return route.fulfill({ json: { formatVersion: 1, eventId: ownerEventId, grants } });
    }
    if (path === `/api/organizer/events/${ownerEventId}/administrators` && request.method() === "POST") {
      keys.push(request.headers()["idempotency-key"] ?? "");
      bodies.push(request.postData() ?? "");
      if (keys.length === 1) return route.fulfill({ status: 503,
        json: { formatVersion: 1, error: "INTERNAL_ERROR" } });
      granted = true;
      const body = JSON.parse(request.postData() ?? "{}") as { requestId: string };
      return route.fulfill({ status: 201, json: { formatVersion: 1, replayed: true,
        requestId: body.requestId, eventId: ownerEventId, grantId: addedGrantId,
        accountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", loginName: "cilla.admin",
        displayName: "Cilla Ny", role: "ADMIN", grantedAt: now } });
    }
    if (path === `/api/organizer/events/${ownerEventId}/account-invitations` && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, eventId: ownerEventId, invitations: [] } });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/organizer");
  const owner = page.getByRole("heading", { name: "Ägarens testtävling" }).locator("../..");
  const admin = page.getByRole("heading", { name: "Administrerad testtävling" }).locator("../..");
  await expect(admin.getByRole("button", { name: /medadministratörer/i })).toHaveCount(0);
  await owner.getByRole("button", { name: /medadministratörer/i }).click();
  await expect(owner.getByText("Anna Aktiv")).toBeVisible();
  await expect(owner.getByText("Bert Historik")).toBeVisible();
  await expect(owner.getByText("anna.admin", { exact: false })).toBeVisible();
  await expect(owner.getByText("bert.admin", { exact: false })).toBeVisible();
  await expect(owner.getByText("Återkallade: 1")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("coadmin-1280.png") });

  const grantInput = owner.locator('form[class*="adminForm"] input');
  await grantInput.fill("CILLA.Admin");
  await expect(owner.getByText(/cilla\.admin/)).toBeVisible();
  await owner.getByRole("button", { name: "Ge eventåtkomst" }).click();
  const pending = owner.getByRole("alert").filter({ hasText: "Åtgärden saknar bekräftat svar" });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText(ownerEventId);
  await expect(pending).toContainText("cilla.admin");
  await expect(grantInput).toHaveCount(0);
  expect(keys).toHaveLength(1);
  expect(JSON.parse(bodies[0]!) as object).toMatchObject({ eventId: ownerEventId, loginName: "cilla.admin", role: "ADMIN" });

  await owner.getByRole("button", { name: /Dölj medadministratörer/ }).click();
  await expect(pending).toBeHidden();
  await owner.getByRole("button", { name: /Visa medadministratörer/ }).click();
  await expect(pending).toBeVisible();
  expect(keys).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await pending.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("coadmin-pending-390.png") });
  await pending.getByRole("button", { name: "Retry samma försök" }).click();
  await expect(pending).toHaveCount(0);
  await expect(owner.getByText("Cilla Ny")).toBeVisible();
  await expect(owner.getByText("Bert Historik")).toBeVisible();
  await expect(grantInput).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(bodies[0]).toBe(bodies[1]);
  expect(wrongScopeCalls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("coadmin-confirmed-390.png") });
});
