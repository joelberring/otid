import { expect, test } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const invitationId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-29T12:00:00Z";
const events = [{ eventId, eventName: "Ägarens testtävling", role: "OWNER", startsOn: "2026-10-01",
  timeZone: "Europe/Stockholm", races: [{ raceId: "44444444-4444-4444-8444-444444444444",
    raceName: "Lång", raceDate: "2026-10-01" }] }];

test("TASK275 kontoinbjudan är separat, fryst vid okänt svar och privat i sidminnet", async ({ page }) => {
  await page.context().addCookies([{ name: "otid_organizer_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3114" }]);
  const keys: string[] = [];
  const bodies: string[] = [];
  let listReads = 0;
  let confirmed = false;
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
    if (path === `/api/organizer/events/${eventId}/administrators` && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, eventId, grants: [] } });
    }
    if (path === `/api/organizer/events/${eventId}/account-invitations` && request.method() === "GET") {
      listReads += 1;
      const invitations = confirmed ? [{ invitationId, loginName: "cilla.ny", displayName: "Cilla Ny",
        issuedAt: now, expiresAt: "2026-09-30T12:00:00Z", status: "PENDING" }] : [];
      return route.fulfill({ json: { formatVersion: 1, eventId, invitations } });
    }
    if (path === `/api/organizer/events/${eventId}/account-invitations` && request.method() === "POST") {
      keys.push(request.headers()["idempotency-key"] ?? "");
      bodies.push(request.postData() ?? "");
      if (keys.length === 1) return route.fulfill({ status: 503,
        json: { formatVersion: 1, error: "INTERNAL_ERROR" } });
      confirmed = true;
      const body = JSON.parse(request.postData() ?? "{}") as { requestId: string };
      return route.fulfill({ status: 201, json: { formatVersion: 1, replayed: true,
        requestId: body.requestId, eventId, invitationId, loginName: "cilla.ny",
        displayName: "Cilla Ny", expiresAt: "2026-09-30T12:00:00Z" } });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/organizer");
  const owner = page.getByRole("heading", { name: "Ägarens testtävling" }).locator("../..");
  await owner.getByRole("button", { name: /visa medadministratörer/i }).click();
  const invitationToggle = owner.getByRole("button", { name: /bjud in nytt konto|dölj kontoinbjudningar/i });
  await expect(invitationToggle).toBeVisible();
  expect(listReads).toBe(0);
  await page.screenshot({ path: test.info().outputPath("invitation-closed-1280.png") });
  await invitationToggle.click();
  const invitation = owner.locator('section[class*="invitationPanel"]');
  await expect(invitation).toBeVisible();
  await expect(invitation.getByText(/kontot får ingen eventåtkomst/i)).toBeVisible();
  await expect(invitation.getByText("Inga kontoinbjudningar ännu.")).toBeVisible();
  expect(listReads).toBeGreaterThanOrEqual(1);
  await invitation.getByRole("textbox", { name: /inloggningsnamn/i }).fill("CILLA.Ny");
  await invitation.getByRole("textbox", { name: /visningsnamn/i }).fill("Cilla Ny");
  await invitation.getByRole("button", { name: "Skapa engångskod" }).click();
  const pending = invitation.getByRole("alert").filter({ hasText: "Inbjudan saknar bekräftat svar" });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText(eventId);
  await expect(pending).toContainText("cilla.ny");
  await expect(pending).toContainText("Cilla Ny");
  await expect(invitation.locator('form[class*="invitationForm"]')).toHaveCount(0);
  expect(keys).toHaveLength(1);
  const requestBody = JSON.parse(bodies[0]!) as Record<string, unknown>;
  expect(requestBody).toMatchObject({ eventId, loginName: "cilla.ny", displayName: "Cilla Ny" });
  expect(requestBody).not.toHaveProperty("code");
  expect(requestBody.codeHash).toMatch(/^[a-f0-9]{64}$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await pending.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("invitation-pending-390.png") });
  await pending.getByRole("button", { name: "Retry samma försök" }).click();
  await expect(pending).toHaveCount(0);
  const code = invitation.locator('code[class*="invitationCode"]');
  await expect(code).toBeVisible();
  const secret = await code.textContent();
  expect(secret?.length).toBe(43);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(bodies[0]).toBe(bodies[1]);
  await expect(invitation.locator('form[class*="invitationForm"]')).toHaveCount(0);
  const readsBeforeCollapse = listReads;
  await invitationToggle.click();
  await expect(code).toBeHidden();
  await invitationToggle.click();
  await expect(code).toBeVisible();
  expect((await code.textContent()) === secret).toBe(true);
  expect(listReads).toBe(readsBeforeCollapse);
  expect(await page.evaluate((value) => {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && storage.getItem(key)?.includes(value)) return false;
      }
    }
    return true;
  }, secret ?? "")).toBe(true);
  await invitation.getByRole("button", { name: /rensa koden från sidan/i }).click();
  await expect(code).toHaveCount(0);
  await expect(invitation.locator('form[class*="invitationForm"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("invitation-cleared-390.png") });
});
