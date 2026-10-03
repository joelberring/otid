import { expect, test } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const ownerEventId = "22222222-2222-4222-8222-222222222222";
const adminEventId = "33333333-3333-4333-8333-333333333333";
const now = "2026-09-29T12:00:00Z";
const addedGrantId = "77777777-7777-4777-8777-777777777777";
const events = [
  { eventId: ownerEventId, eventName: "Ägarens testtävling", role: "OWNER", startsOn: "2026-10-01",
    timeZone: "Europe/Stockholm", races: [{ raceId: "44444444-4444-4444-8444-444444444444",
      raceName: "Lång", raceDate: "2026-10-01" }] },
  { eventId: adminEventId, eventName: "Annans testtävling", role: "ADMIN", startsOn: "2026-10-02",
    timeZone: "Europe/Stockholm", races: [] }
];
const existingGrant = { grantId: "66666666-6666-4666-8666-666666666666",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", loginName: "redan.admin",
  displayName: "Redan Admin", role: "ADMIN", grantedAt: now, revokedAt: null };
const invitations = [
  { invitationId: "10000000-0000-4000-8000-000000000001", loginName: "cilla.ny",
    displayName: "Cilla Ny", issuedAt: now, expiresAt: "2026-10-01T00:00:00Z", status: "REDEEMED" },
  { invitationId: "10000000-0000-4000-8000-000000000002", loginName: "redan.admin",
    displayName: "Redan Admin", issuedAt: now, expiresAt: "2026-10-01T00:00:00Z", status: "REDEEMED" },
  { invitationId: "10000000-0000-4000-8000-000000000003", loginName: "pelle.vantar",
    displayName: "Pelle Väntar", issuedAt: now, expiresAt: "2026-10-01T00:00:00Z", status: "PENDING" },
  { invitationId: "10000000-0000-4000-8000-000000000004", loginName: "rita.sparrad",
    displayName: "Rita Spärrad", issuedAt: now, expiresAt: "2026-10-01T00:00:00Z", status: "REVOKED" },
  { invitationId: "10000000-0000-4000-8000-000000000005", loginName: "erik.utgangen",
    displayName: "Erik Utgången", issuedAt: now, expiresAt: "2026-10-01T00:00:00Z", status: "EXPIRED" }
];

test("TASK276 aktiverat konto leder bara till explicit eventgrant-granskning", async ({ page }) => {
  await page.context().addCookies([{ name: "otid_organizer_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3114" }]);
  const keys: string[] = [];
  const bodies: string[] = [];
  let granted = false;
  let invitationWrites = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/organizer/session" && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, accountId, displayName: "Syntetisk ägare",
        expiresAt: "2026-10-01T00:00:00Z" } });
    }
    if (path === "/api/organizer/events" && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, events } });
    }
    if (path === `/api/organizer/events/${ownerEventId}/administrators` && request.method() === "GET") {
      const grants = granted ? [existingGrant, { grantId: addedGrantId,
        accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", loginName: "cilla.ny",
        displayName: "Cilla Ny", role: "ADMIN", grantedAt: now, revokedAt: null }] : [existingGrant];
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
        accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", loginName: "cilla.ny",
        displayName: "Cilla Ny", role: "ADMIN", grantedAt: now } });
    }
    if (path === `/api/organizer/events/${ownerEventId}/account-invitations` && request.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, eventId: ownerEventId, invitations } });
    }
    if (path.includes("account-invitations") && request.method() === "POST") invitationWrites += 1;
    return route.abort();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/organizer");
  const owner = page.getByRole("heading", { name: "Ägarens testtävling" }).locator("../..");
  const admin = page.getByRole("heading", { name: "Annans testtävling" }).locator("../..");
  await expect(admin.getByRole("button", { name: /medadministratörer/i })).toHaveCount(0);
  await owner.getByRole("button", { name: "Visa medadministratörer" }).click();
  await owner.getByRole("button", { name: "Bjud in nytt konto" }).click();
  const invitation = owner.locator('section[class*="invitationPanel"]');
  const cilla = invitation.locator("li").filter({ hasText: "Cilla Ny" });
  const already = invitation.locator("li").filter({ hasText: "Redan Admin" });
  await expect(cilla.getByRole("button", { name: "Granska eventåtkomst" })).toBeVisible();
  await expect(already.getByRole("button", { name: "Granska eventåtkomst" })).toHaveCount(0);
  for (const name of ["Pelle Väntar", "Rita Spärrad", "Erik Utgången"]) {
    await expect(invitation.locator("li").filter({ hasText: name })
      .getByRole("button", { name: "Granska eventåtkomst" })).toHaveCount(0);
  }
  await page.screenshot({ path: test.info().outputPath("invitation-grant-list-1280.png") });

  await cilla.getByRole("button", { name: "Granska eventåtkomst" }).click();
  expect(keys).toHaveLength(0);
  expect(invitationWrites).toBe(0);
  const grantInput = owner.locator('form[class*="adminForm"] input');
  await expect(grantInput).toHaveValue("cilla.ny");
  await expect(owner.getByText(/kontrollera mottagaren/i)).toBeVisible();
  const review = owner.locator('[class*="adminReview"][tabindex="-1"]');
  await expect(review).toBeFocused();
  await grantInput.fill("manuell.admin");
  await expect(owner.locator('[class*="adminInvitationReview"]')).toHaveCount(0);
  await cilla.getByRole("button", { name: "Granska eventåtkomst" }).click();
  await expect(grantInput).toHaveValue("cilla.ny");
  await expect(review).toBeFocused();
  expect(keys).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("invitation-grant-review-390.png") });

  await owner.getByRole("button", { name: "Ge eventåtkomst" }).click();
  const pending = owner.getByRole("alert").filter({ hasText: "Åtgärden saknar bekräftat svar" });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText("cilla.ny");
  expect(keys).toHaveLength(1);
  expect(JSON.parse(bodies[0]!) as object).toMatchObject({ eventId: ownerEventId,
    loginName: "cilla.ny", role: "ADMIN" });
  await expect(cilla.getByRole("button", { name: "Granska eventåtkomst" })).toBeDisabled();
  await pending.getByRole("button", { name: "Retry samma försök" }).click();
  await expect(pending).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(bodies[0]).toBe(bodies[1]);
  await expect(cilla.getByRole("button", { name: "Granska eventåtkomst" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("invitation-grant-confirmed-390.png") });
});
