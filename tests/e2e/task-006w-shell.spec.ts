import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { StartCheckinRecoveryManifestSchema } from "@o-tid/contracts";
import type { StartCheckinReceipt, StartCheckinSyncRequest } from "@o-tid/contracts";

test("byggt persondatafritt appskal startar om offline och cachar endast exakt byggallowlist", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/checkin/index.html#10000000-0000-4000-8000-000000000002");
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'none'");
  await page.getByRole("button", { name: "Förbered offline-appskal" }).click();
  await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskal kontrollerat:");
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return Promise.all(names.map(async (name) => ({ name, urls: (await (await caches.open(name)).keys()).map((request) => request.url) })));
  });
  expect(cached).toHaveLength(1);
  const urls = cached[0]!.urls;
  expect(urls).toHaveLength(3);
  expect(urls.filter((url) => /\/checkin\/app-[A-Z0-9]+\.(js|css)$/.test(url))).toHaveLength(2);
  expect(urls.some((url) => url.endsWith("/checkin/index.html"))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveURL(/#10000000-0000-4000-8000-000000000002$/);
  await expect(page.getByRole("heading", { name: "O-Tid – start och mål" })).toBeVisible();
  await page.getByRole("button", { name: "Förbered offline-appskal" }).click();
  await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskal kontrollerat:");
  const misses = await page.evaluate(async () => {
    const denied = [];
    for (const url of ["/api/private-probe#fragment", "/checkin/index.html?private=1#fragment", "/checkin/unknown.js#fragment"]) {
      try { await fetch(url); denied.push(false); } catch { denied.push(true); }
    }
    return denied;
  });
  expect(misses).toEqual([true, true, true]);
  expect(await page.evaluate(async () => (await (await caches.open((await caches.keys())[0]!)).keys()).map((request) => request.url))).toEqual(urls);
  expect(errors).toEqual([]);
});

test("skadad shellcache får inte ge offline redo", async ({ page }) => {
  await page.goto("/checkin/index.html");
  await page.getByRole("button", { name: "Förbered offline-appskal" }).click();
  await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskal kontrollerat:");
  await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys())[0]!);
    const css = (await cache.keys()).find((request) => request.url.endsWith(".css"))!;
    await cache.put(css, new Response("altered", { headers: { "content-type": "text/css" } }));
  });
  await page.getByRole("button", { name: "Förbered offline-appskal" }).click();
  await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskalet kunde inte förberedas");
});

test("privat förberedelse kräver samtycke och offline reload visar inga namn före lokal upplåsning", async ({ page, context }, testInfo) => {
  const raceId = "10000000-0000-4000-8000-000000000001", actorId = "10000000-0000-4000-8000-000000000002";
  const passphrase = "En helt separat lokal provlösenfras", name = "Syntetisk Startperson";
  let deviceId = "", deviceLabel = "";
  const sent: string[] = [];
  let stored: StartCheckinReceipt | null = null;
  await page.route(`**/api/admin/races/${raceId}/start-checkin-session`, async (route) => {
    await route.fulfill({ status: 200, headers: { "content-type": "application/json", "cache-control": "private, no-store",
      "set-cookie": `otid_start_checkin_admin_csrf=${"c".repeat(43)}; Path=/; SameSite=Strict` },
      body: JSON.stringify({ formatVersion: 1, raceId, capability: "START_CHECKIN", expiresAt: "2026-09-06T10:00:00Z" }) });
  });
  await page.route(`**/api/admin/races/${raceId}/start-checkin/devices`, async (route) => {
    const data = route.request().postDataJSON() as { deviceId: string; label: string };
    deviceId = data.deviceId; deviceLabel = data.label;
    await route.fulfill({ json: { formatVersion: 1, raceId, deviceId, label: deviceLabel, actorCredentialId: actorId,
      capability: "START_CHECKIN", registeredAt: "2026-09-05T10:00:00.000Z" } });
  });
  await page.route(`**/api/admin/races/${raceId}/start-checkin/roster?reviewDetails=1`, async (route) => {
    await route.fulfill({ json: { formatVersion: 1, raceId, snapshotVersion: 1, timeZone: "Europe/Stockholm",
      generatedAt: "2026-09-05T10:00:00.000Z", knowledge: "LAST_SYNCED_ONLY",
      entries: [{ entryId: "10000000-0000-4000-8000-000000000003", entryVersion: 1,
        classId: "10000000-0000-4000-8000-000000000004", className: "Öppen", displayName: name, organisationName: null,
        startRule: "PUNCH", fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false,
        revision: stored ? 1 : 0, startState: stored ? "STARTED" : "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false,
        activeDns: false, conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true },
      { entryId: "10000000-0000-4000-8000-000000000005", entryVersion: 1,
        classId: "10000000-0000-4000-8000-000000000006", className: "D21", displayName: "Syntetisk Minutstart", organisationName: "OK Minut",
        startRule: "FIXED", fixedStartTime: "2026-09-05T10:30:00.000Z", cardNumber: null, multipleActiveAssignments: true,
        revision: 0, startState: "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false,
        activeDns: false, conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true }],
      devices: [{ deviceId, label: deviceLabel, capability: "START_CHECKIN", lastReceivedAt: stored?.receivedAt ?? null, lastSequence: stored ? 1 : 0 }] } });
  });
  await page.route(`**/api/admin/races/${raceId}/start-checkin/sync`, async (route) => {
    const body = route.request().postData()!; sent.push(body);
    const request = route.request().postDataJSON() as StartCheckinSyncRequest;
    stored ??= { formatVersion: 1, storage: "STORED", requestId: request.operation.requestId, deviceId,
      raceId, entryId: request.operation.entryId, localSequence: 1, contentHash: request.contentHash,
      receivedAt: "2026-09-05T10:02:00.000Z", effect: { kind: "APPLIED", revision: 1, revisionId: "10000000-0000-4000-8000-000000000099" } };
    if (sent.length === 1) { await route.abort("failed"); return; }
    await route.fulfill({ json: stored });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkin/index.html");
  await page.getByRole("button", { name: "Förbered offline-appskal" }).click();
  await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskal kontrollerat:");
  await page.getByRole("button", { name: "Kontrollera beständig lagring" }).click();
  await page.getByLabel("Loppets interna id").fill(raceId);
  await page.getByLabel("Mobilens namn").fill("Provstart mobil");
  await page.getByLabel("Personlig arbetsbehörighet").fill(`otid_org_start_checkin_v1.${actorId}.${"a".repeat(43)}`);
  await page.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
  await page.getByRole("button", { name: "Förbered privat startlista" }).click();
  expect(deviceId).toBe("");
  await page.getByLabel("Jag godkänner att den privata listan", { exact: false }).check();
  const risk = page.getByLabel("Jag accepterar den risken", { exact: false });
  if (await risk.isVisible()) await risk.check();
  await page.getByRole("button", { name: "Förbered privat startlista" }).click();
  const card = page.getByRole("article", { name });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Klassfilter", { exact: true }).selectOption("10000000-0000-4000-8000-000000000006");
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.checkinPrint = "called"; }; });
  await page.getByRole("button", { name: "Skriv ut aktuellt startunderlag", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.checkinPrint)).toBe("called");
  expect(sent).toHaveLength(0);
  await page.emulateMedia({ media: "print" });
  const paper = page.getByRole("region", { name: "Privat pappersunderlag för start" });
  await expect(paper).toContainText("Syntetisk Minutstart");
  await expect(paper).not.toContainText("Syntetisk Startperson");
  await expect(paper).toContainText("Flera aktiva brickkopplingar – kontrollera");
  await expect(paper).toContainText("Pappersnotering");
  await expect(page.getByRole("button", { name: "Synka väntande markeringar", exact: true })).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("Klassfilter", { exact: true }).selectOption("");
  await page.screenshot({ path: testInfo.outputPath("prepared-mobile.png"), fullPage: true });
  await context.setOffline(true);
  await expect(card.getByRole("button", { name: "Markera startat", exact: true })).toBeDisabled();
  await page.getByLabel("Aktivera skrivläge", { exact: true }).check();
  await card.getByRole("button", { name: "Markera startat", exact: true }).click();
  await expect(page.getByRole("status", { name: "Avprickning och synk" })).toContainText("Markeringen är sparad lokalt");
  await expect(card).toContainText("Väntar på serverkvittens: 1");
  expect(sent).toHaveLength(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: "Exportera privat återhämtningsunderlag", exact: true }).click()
  ]);
  const exportedText = readFileSync(await download.path(), "utf8");
  const exported = StartCheckinRecoveryManifestSchema.parse(JSON.parse(exportedText));
  expect(exported.raceId).toBe(raceId); expect(exported.items).toHaveLength(1);
  expect(exportedText).not.toContain(name); expect(exportedText).not.toContain(passphrase);
  await expect(card).toContainText("Väntar på serverkvittens: 1");
  await expect(page.getByLabel("Aktivera skrivläge", { exact: true })).not.toBeChecked();
  await page.reload();
  await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  const unlockForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Lås upp lokal lista" }) });
  await unlockForm.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill("Fel men lång nog lokal lösenfras");
  await unlockForm.getByRole("button").click();
  await expect(page.getByText("Åtgärden misslyckades", { exact: false })).toBeVisible();
  await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  await unlockForm.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
  await unlockForm.getByRole("button").click();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Lokalt sparad avsikt: Startat");
  await expect(card).toContainText("Serverns startmarkering: Omarkerad");
  await expect(page.getByLabel("Aktivera skrivläge", { exact: true })).not.toBeChecked();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Synka väntande markeringar", exact: true }).click();
  await expect(page.getByRole("status", { name: "Avprickning och synk" })).toContainText("Synken stoppades");
  await expect(card).toContainText("Väntar på serverkvittens: 1");
  await page.reload();
  await unlockForm.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
  await unlockForm.getByRole("button").click();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Synka väntande markeringar", exact: true }).click();
  await expect(page.getByRole("status", { name: "Avprickning och synk" })).toContainText("Synk klar");
  expect(sent).toHaveLength(2); expect(sent[0]).toBe(sent[1]);
  const sentRequest = JSON.parse(sent[0]!) as StartCheckinSyncRequest;
  expect(exported.items[0]).toEqual({ requestId: sentRequest.operation.requestId, localSequence: 1, contentHash: sentRequest.contentHash });
  await expect(card).toContainText("Väntar på serverkvittens: 0");
  await expect(card).toContainText("Serverns startmarkering: Startat");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Lås lokal lista" }).click();
  await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  const cacheContent = await page.evaluate(async () => {
    const texts: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) texts.push(await (await cache.match(request))!.text());
    }
    return texts.join("\n");
  });
  expect(cacheContent).not.toContain(name);
  expect(cacheContent).not.toContain(passphrase);
  expect(cacheContent).not.toContain(actorId);
  await page.screenshot({ path: testInfo.outputPath("locked-offline.png"), fullPage: true });
});
