import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0218 (B5): banläggningen öppnas två gånger och kartfilen hämtas från servern bara första gången. Andra gången kommer
 * filen ur webbläsarens lager för kartfiler (IndexedDB per sha256); utan det ur HTTP-cachen (adressen bär filens sha256 och
 * svaret får sparas privat, oföränderligt, med ETag).
 * Nätverksanropen räknas med Chromes egna besked (CDP), eftersom Playwrights `route` stänger av cachen.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const MAP_SOURCE = /\/map\/source\/[0-9a-f]{64}$/;

async function countMapDownloads(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const fromCache = new Set<string>();
  const seen: { requestId: string; status: number; cached: boolean; cacheControl: string }[] = [];
  cdp.on("Network.requestServedFromCache", event => { fromCache.add(event.requestId); });
  cdp.on("Network.responseReceived", event => {
    if (!MAP_SOURCE.test(event.response.url)) return;
    const headers = Object.fromEntries(Object.entries(event.response.headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
    seen.push({ requestId: event.requestId, status: event.response.status, cached: event.response.fromDiskCache === true,
      cacheControl: headers["cache-control"] ?? "" });
  });
  return {
    /** Svar på kartfilens adress som kom från servern (inte ur webbläsarens cache). */
    downloads: () => seen.filter(item => item.status === 200 && !item.cached && !fromCache.has(item.requestId)),
    requests: () => seen.length,
    cached: () => seen.filter(item => item.cached || fromCache.has(item.requestId)).length
  };
}

async function mapReady(page: Page) {
  await expect(page.getByTestId("course-setting-map")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await expect(page.getByText("Kartfilen kunde inte läsas i webbläsaren.")).toHaveCount(0);
}

test("banläggningen öppnas två gånger: kartfilen hämtas från servern bara första gången", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartcache.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Kartcache ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  const network = await countMapDownloads(owner);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });

  // Första öppningen: kartfilen från servern, en gång, med sin sha256 i adressen och privat cache.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await mapReady(owner);
  await expect.poll(() => network.downloads().length).toBe(1);
  expect(network.downloads()[0]!.cacheControl).toBe("private, max-age=86400, immutable");

  // Andra öppningen: samma fil ur webbläsarens lager för kartfiler (IndexedDB per sha256), inget anrop alls.
  const before = network.requests();
  await owner.goto(`/admin/${raceId}/course-setting`);
  await mapReady(owner);
  expect(network.requests()).toBe(before);
  expect(network.downloads()).toHaveLength(1);

  // Utan det lagret (t.ex. full lagring): webbläsarens HTTP-cache ger filen, ingen ny hämtning från servern. Mot driftmiljön
  // i CI (https med självsignerat certifikat) sparar Chromium inga svar i HTTP-cachen alls, så den delen provas bara mot
  // utvecklingsservern; där räcker svarets huvuden.
  if (process.env.E2E_BASE_URL?.startsWith("https://")) return;
  await owner.evaluate(() => new Promise<void>((resolve, reject) => {
    const removal = indexedDB.deleteDatabase("otid-map-cache");
    removal.onsuccess = () => resolve();
    removal.onerror = () => reject(new Error("IndexedDB"));
    removal.onblocked = () => resolve();
  }));
  await owner.goto(`/admin/${raceId}/course-setting`);
  await mapReady(owner);
  await expect.poll(() => network.requests()).toBeGreaterThan(before);
  expect(network.downloads()).toHaveLength(1);
  expect(network.cached()).toBeGreaterThanOrEqual(1);
});
