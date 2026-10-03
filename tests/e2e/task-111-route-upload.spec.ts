import { expect, test } from "@playwright/test";

const csrf = "a".repeat(43);
const grantId = "10000000-0000-4000-8000-000000000001";
const uploadId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.3" lon="18.0"/><trkpt lat="59.4" lon="18.1"/></trkseg></trk></gpx>');

test("TASK111 private GPX form retries an unknown reservation at 390px without exposing identifiers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "otid_route_upload_csrf", value: csrf, url: test.info().project.use.baseURL as string }]);
  await page.route("**/api/route-upload/status", route => route.fulfill({ status: 200, json: { formatVersion: 1, status: "not-uploaded" } }));
  await page.route("**/api/route-upload/publication-consent", route => route.fulfill({ status: 200, json: {
    formatVersion: 1, status: "stored", consent: "PRIVATE", revision: 0, decidedAt: null
  } }));
  let reservations = 0, firstKey: string | undefined;
  await page.route("**/api/route-upload/reservations", async route => {
    if (route.request().method() !== "POST") return route.abort();
    reservations += 1;
    const key = route.request().headers()["idempotency-key"];
    if (reservations === 1) { firstKey = key; return route.abort("failed"); }
    expect(key).toBe(firstKey);
    expect(route.request().headers()["x-otid-csrf"]).toBe(csrf);
    return route.fulfill({ status: 201, json: { formatVersion: 1, uploadId, requestId, grantId, reservedAt: "2026-09-20T12:00:00.000Z", replayed: false } });
  });
  await page.route(`**/api/route-upload/reservations/${uploadId}`, route => route.fulfill({ status: 201, json: {
    formatVersion: 1, uploadId, storedAt: "2026-09-20T12:01:00.000Z", pointCount: 2, segmentCount: 1,
    firstRecordedAt: null, lastRecordedAt: null, replayed: false
  } }));
  await page.goto("/route-upload");
  await page.locator('input[type="file"]').setInputFiles({ name: "min-rutt.gpx", mimeType: "application/gpx+xml", buffer: gpx });
  await page.getByRole("button", { name: "Ladda upp rutt", exact: true }).click();
  await expect(page.locator(".route-upload-form [role=alert]")).toContainText("Rutten kunde inte laddas upp");
  await page.getByRole("button", { name: "Försök igen", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Rutten är sparad privat.");
  await expect(page.getByText(/2 registrerade punkter/)).toBeVisible();
  expect(reservations).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.content()).not.toMatch(/10000000-0000-4000-8000-00000000000[123]|storeId|versionId|secretHash/i);
});

test("TASK112 reopening a private route link shows its anonymous receipt at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/route-upload/status", route => route.fulfill({ status: 200, json: { formatVersion: 1, status: "stored", receipt: {
    storedAt: "2026-09-20T12:01:00.000Z", pointCount: 2, segmentCount: 1,
    firstRecordedAt: "2026-09-20T10:00:00.000Z", lastRecordedAt: "2026-09-20T10:01:00.000Z"
  } } }));
  await page.route("**/api/route-upload/publication-consent", route => route.fulfill({ status: 200, json: {
    formatVersion: 1, status: "stored", consent: "PRIVATE", revision: 0, decidedAt: null
  } }));
  await page.goto("/route-upload");
  await expect(page.getByRole("status")).toContainText("Rutten är sparad privat.");
  await expect(page.getByText("Första tidsstämpel")).toBeVisible();
  await expect(page.getByText("Sista tidsstämpel")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.content()).not.toMatch(/uploadId|grantId|entryId|sessionId|storeId|objectKey|versionId|secretHash/i);
});

test("TASK116 participant can explicitly grant and withdraw future-publication consent at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "otid_route_upload_csrf", value: csrf, url: test.info().project.use.baseURL as string }]);
  let publicRequests = 0;
  await page.route("**/api/public/**", route => { publicRequests += 1; return route.abort(); });
  await page.route("**/api/route-upload/status", route => route.fulfill({ status: 200, json: { formatVersion: 1, status: "stored", receipt: {
    storedAt: "2026-09-20T12:01:00.000Z", pointCount: 2, segmentCount: 1, firstRecordedAt: null, lastRecordedAt: null
  } } }));
  let consent = "PRIVATE", revision = 0;
  await page.route("**/api/route-upload/publication-consent", async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: {
      formatVersion: 1, status: "stored", consent, revision, decidedAt: revision === 0 ? null : "2026-09-20T12:02:00.000Z"
    } });
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-otid-csrf"]).toBe(csrf);
    expect(route.request().headers()["idempotency-key"]).toMatch(/^route-publication-consent:[0-9a-f-]{36}$/);
    const body = route.request().postDataJSON() as { decision: "GRANT" | "WITHDRAW" };
    consent = body.decision === "GRANT" ? "READY_FOR_FUTURE_PUBLICATION" : "PRIVATE";
    revision += 1;
    return route.fulfill({ status: 201, json: {
      formatVersion: 1, status: "stored", consent, revision, decidedAt: "2026-09-20T12:02:00.000Z", replayed: false
    } });
  });
  await page.goto("/route-upload");
  await page.getByRole("button", { name: "Godkänn för framtida publicering", exact: true }).click();
  await expect(page.getByText(/Du har godkänt att arrangören kan använda denna exakta rutt/, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ta tillbaka godkännandet", exact: true }).click();
  await expect(page.getByText("Rutten är privat. Den visas inte för andra deltagare eller publik.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(publicRequests).toBe(0);
  expect(await page.content()).not.toMatch(/uploadId|grantId|entryId|manifestId|sourceHash|objectKey|versionId|secretHash/i);
});
