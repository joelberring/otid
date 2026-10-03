import { expect, test, type Page } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";
const uploadId = "10000000-0000-4000-8000-000000000002";
const publicationId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const sourceHash = "a".repeat(64);
const decidedAt = "2026-09-27T10:00:00.000Z";
const candidate = { uploadId, title: "Syntetisk skärgårdskarta", mediaType: "image/png",
  sha256: sourceHash, byteLength: 1024, storedAt: decidedAt };
const secondUploadId = "10000000-0000-4000-8000-000000000005";
const secondCandidate = { ...candidate, uploadId: secondUploadId, title: "Syntetisk reservkarta" };
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vZ8AAAAASUVORK5CYII=", "base64");

async function installSyntheticAdminApi(page: Page, stored: boolean, loadFails = false, twoCandidates = false) {
  let revision = 0;
  let active: null | { publicationId: string; revision: number; uploadId: string; title: string;
    mediaType: string; sha256: string; byteLength: number; publishedAt: string } = null;
  const writes: string[] = [];
  const unexpected: string[] = [];
  await page.route(`**/api/admin/races/${raceId}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/map") && method === "GET") {
      return route.fulfill(loadFails ? { status: 503, json: { error: "unavailable" } } : { status: 200, json: {
        formatVersion: 1, raceId, latestPublicationRevision: revision,
        activePublication: active, storedCandidates: stored ? twoCandidates ? [candidate, secondCandidate] : [candidate] : []
      } });
    }
    if (path.endsWith("/map/georeferences") && method === "GET") return route.fulfill({ status: 200,
      json: { formatVersion: 1, raceId, latestGeoreferenceRevision: 0, georeferences: [] } });
    if (path.endsWith("/course-control-geometries") && method === "GET") return route.fulfill({ status: 200,
      json: { formatVersion: 1, raceId, courses: [], geometries: [] } });
    if (path.endsWith("/map/publications") && method === "POST") {
      const body = route.request().postDataJSON() as { uploadId: string; expectedPublicationRevision: number };
      expect(body).toMatchObject({ uploadId, expectedPublicationRevision: revision });
      writes.push("publish");
      revision += 1;
      active = { publicationId, revision, uploadId, title: candidate.title, mediaType: candidate.mediaType,
        sha256: sourceHash, byteLength: candidate.byteLength, publishedAt: decidedAt };
      return route.fulfill({ status: 201, json: { formatVersion: 1, publicationId, requestId, raceId,
        revision, action: "PUBLISH", manifestId: uploadId, sourceHash, decidedAt, replayed: false } });
    }
    if (path.endsWith("/map/withdrawals") && method === "POST") {
      const body = route.request().postDataJSON() as { publicationId: string; expectedPublicationRevision: number };
      expect(body).toMatchObject({ publicationId, expectedPublicationRevision: revision });
      writes.push("withdraw");
      revision += 1;
      active = null;
      return route.fulfill({ status: 201, json: { formatVersion: 1, publicationId, requestId, raceId,
        revision, action: "WITHDRAW", decidedAt, replayed: false } });
    }
    unexpected.push(`${method} ${path}`);
    return route.abort();
  });
  await page.context().addCookies([{ name: "otid_race_administrator_csrf", value: "a".repeat(43),
    url: "http://127.0.0.1:3131" }]);
  return { writes, unexpected };
}

test("TASK242 kartarbete är kompakt och utan sidspill vid 390/1280 px", async ({ page }) => {
  const api = await installSyntheticAdminApi(page, false);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/admin/${raceId}/map`);
    await expect(page.getByRole("heading", { name: "Kartsläpp", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ladda upp karta", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kartkalibrering", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Banans kontrollpositioner", exact: true })).toBeVisible();
    await expect(page.getByText("Visa kalibrering och sparade versioner", { exact: true })).toBeVisible();
    await expect(page.getByText("Visa kontrollpositioner och sparade versioner", { exact: true })).toBeVisible();
    await expect(page.getByText("Ingen karta är publicerad just nu.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`private-map-${width}.png`), fullPage: true });
  }
  expect(api.writes).toEqual([]);
  expect(api.unexpected).toEqual([]);
  expect(await page.content()).not.toMatch(/storeId|objectKey|versionId|bucket|secretKey/i);
});

test("TASK244 vald privat kandidat granskas utan publicering och fel visas tydligt", async ({ page }) => {
  const api = await installSyntheticAdminApi(page, true, false, true);
  const reads: string[] = [];
  await page.route(`**/api/admin/races/${raceId}/map/previews/*`, route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    reads.push(id);
    return id === uploadId
      ? route.fulfill({ status: 200, contentType: "image/png", body: tinyPng })
      : route.fulfill({ status: 503, body: "Bild tillfälligt otillgänglig" });
  });

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/admin/${raceId}/map`);
    const preview = page.getByRole("button", { name: "Granska vald karta" });
    expect(reads).toHaveLength(width === 390 ? 0 : 2);
    await preview.click();
    const image = page.getByRole("img", { name: "Privat förhandsvisning av Syntetisk skärgårdskarta" });
    await expect(image).toBeVisible();
    await expect(page.getByText("Privat förhandsvisning. Kartan är inte publicerad genom granskningen.")).toBeVisible();
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
    await expect(page.getByRole("button", { name: "Publicera karta" })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath(`private-map-preview-ready-${width}.png`), fullPage: true });
    await page.getByRole("checkbox", { name: /blir synlig utan inloggning/ }).check();
    await page.locator(".map-asset-admin select").selectOption(secondUploadId);
    await expect(page.getByRole("checkbox", { name: /blir synlig utan inloggning/ })).not.toBeChecked();
    await expect(image).toHaveCount(0);
    await preview.click();
    await expect(page.getByRole("alert").filter({ hasText: "Den privata kartbilden kunde inte visas." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicera karta" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`private-map-preview-${width}.png`), fullPage: true });
  }
  expect(reads).toEqual([uploadId, secondUploadId, uploadId, secondUploadId]);
  expect(api.writes).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("TASK242 privat kandidat kräver bekräftelse för publicering och återtagande", async ({ page }) => {
  const api = await installSyntheticAdminApi(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${raceId}/map`);
  await expect(page.locator(".map-asset-admin select option")).toHaveCount(1);
  await expect(page.locator(".map-asset-admin select option")).toContainText("Syntetisk skärgårdskarta");
  const publish = page.getByRole("button", { name: "Publicera karta", exact: true });
  await expect(publish).toBeDisabled();
  await expect(page.getByText("Jag förstår att kartan blir synlig utan inloggning på resultatsidan.")).toBeVisible();
  expect(api.writes).toEqual([]);
  await page.getByRole("checkbox", { name: /blir synlig utan inloggning/ }).check();
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByText("Kartan är publicerad på den publika resultatsidan.")).toBeVisible();
  await expect(page.getByText(/Kartsläppsversion 1/)).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Bredd" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("private-map-published-390.png"), fullPage: true });
  await page.getByText("Visa kalibrering och sparade versioner", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Bredd" })).toBeVisible();
  await page.getByText("Visa kontrollpositioner och sparade versioner", { exact: true }).click();
  await expect(page.getByText("Det finns inga banversioner med kontroller ännu.")).toBeVisible();
  const withdraw = page.getByRole("button", { name: "Återta kartsläpp", exact: true });
  await expect(withdraw).toBeDisabled();
  await expect(page.getByText("Jag förstår att nya publika hämtningar av kartan stoppas.")).toBeVisible();
  await page.getByRole("checkbox", { name: /publika hämtningar/ }).check();
  await withdraw.click();
  await expect(page.getByText("Kartsläppet är återtaget. Den privata historiken bevaras.")).toBeVisible();
  await expect(page.getByText("Ingen karta är publicerad just nu.", { exact: true })).toBeVisible();
  expect(api.writes).toEqual(["publish", "withdraw"]);
  expect(api.unexpected).toEqual([]);
});

test("TASK242 misslyckad kartstatus ger inte falskt tomläge", async ({ page }) => {
  const api = await installSyntheticAdminApi(page, false, true);
  await page.goto(`/admin/${raceId}/map`);
  await expect(page.getByRole("status").filter({ hasText: "Kartutgångsläget kunde inte hämtas." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Kalibreringsläget kunde inte hämtas." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Underlaget kunde inte hämtas." })).toBeVisible();
  await expect(page.getByText("Ingen karta är publicerad just nu.", { exact: true })).toHaveCount(0);
  await page.getByText("Visa kalibrering och sparade versioner", { exact: true }).click();
  await expect(page.getByText("Ladda först upp en privat PNG- eller JPEG-karta ovan.")).toHaveCount(0);
  expect(api.writes).toEqual([]);
  expect(api.unexpected).toEqual([]);
});
