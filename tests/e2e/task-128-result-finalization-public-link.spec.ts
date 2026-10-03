import { expect, test } from "@playwright/test";
import { resultFinalizationCandidateResponseSchema, resultFinalizationResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const finalizationId = "10000000-0000-4000-8000-000000000003";
const basisHash = "a".repeat(64);

const candidates = resultFinalizationCandidateResponseSchema.parse({
  formatVersion: 1,
  raceId,
  snapshotVersion: 7,
  race: {
    entryCount: 1,
    nonEmptyClassCount: 1,
    unresolvedUnknownCardReadoutCount: 0,
    blockerCodes: [],
    basisHash,
    latestFinalization: null
  },
  classes: [{
    classId,
    className: "H21",
    entryCount: 1,
    blockerCodes: [],
    basisHash,
    latestFinalization: null
  }]
});

test("TASK128: loppfinalisering ger en kopierbar publik slutresultatlänk utan intern metadata", async ({ page, context }) => {
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => { copied = value; },
        readText: async () => copied
      }
    });
  });
  await context.addCookies([{
    name: "otid_finalization_admin_csrf",
    value: "c".repeat(43),
    url: "http://127.0.0.1:3127"
  }]);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/admin/races/${raceId}/result-finalizations/candidates`) {
      return route.fulfill({ status: 200, json: candidates });
    }
    if (url.pathname === `/api/admin/races/${raceId}/result-finalizations` && request.method() === "POST") {
      const intent = JSON.parse(request.postData() ?? "{}") as { scope?: string; classId?: unknown; expectedSnapshotVersion?: unknown; expectedBasisHash?: unknown; expectedLatestScopeRevision?: unknown };
      expect(intent).toEqual({
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: 7,
        expectedBasisHash: basisHash,
        expectedLatestScopeRevision: null
      });
      const requestId = request.headers()["idempotency-key"]?.slice("result-finalization:".length);
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      return route.fulfill({ status: 200, json: resultFinalizationResponseSchema.parse({
        formatVersion: 1,
        replayed: false,
        requestId,
        finalization: {
          id: finalizationId,
          raceId,
          scope: "RACE",
          classId: null,
          scopeRevision: 1,
          sourceSnapshotVersion: 7,
          basisHash,
          frozenProjectionHash: "b".repeat(64),
          entryCount: 1,
          classCount: 1,
          completeXmlSha256: "c".repeat(64),
          finalizedAt: "2026-09-21T15:00:00.000Z"
        }
      }) });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/finalization`);
  await expect(page.getByRole("button", { name: "Frys loppet som IOF Complete", exact: true })).toBeEnabled();
  await expect(page.getByText("H21", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("finalization-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const raceActionHeight = await page.getByRole("button", { name: "Frys loppet som IOF Complete", exact: true })
    .evaluate(element => element.getBoundingClientRect().height);
  expect(raceActionHeight).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("finalization-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Frys loppet som IOF Complete", exact: true }).click();

  const expectedPath = `/results/${raceId}/finalizations/${finalizationId}`;
  const publicLink = page.getByRole("link", { name: "Öppna publikt slutresultat", exact: true });
  await expect(publicLink).toHaveAttribute("href", expectedPath);
  await page.getByRole("button", { name: "Kopiera publik länk", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Den publika slutresultatlänken är kopierad.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`http://127.0.0.1:3127${expectedPath}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK253: flera klasser och blockerare förblir överskådliga utan sidspill", async ({ page }) => {
  const blocked = resultFinalizationCandidateResponseSchema.parse({ ...candidates,
    race: { ...candidates.race, entryCount: 8, nonEmptyClassCount: 8,
      blockerCodes: ["MISSING_CLASS_FINALIZATION"] },
    classes: Array.from({ length: 8 }, (_, index) => ({ ...candidates.classes[0],
      classId: `10000000-0000-4000-8000-${(index + 10).toString(16).padStart(12, "0")}`,
      className: `D${index + 21}`, blockerCodes: index === 1 ? ["MISSING_RESULT_REVISION"] : [] }))
  });
  await page.route("**/api/**", route => {
    if (new URL(route.request().url()).pathname === `/api/admin/races/${raceId}/result-finalizations/candidates`) {
      return route.fulfill({ status: 200, json: blocked });
    }
    return route.abort();
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/finalization`);
  await expect(page.locator(".result-finalization-scope")).toHaveCount(8);
  await expect(page.getByText("Minst en deltagare saknar resultatrevision.")).toBeVisible();
  await expect(page.locator(".result-finalization-scope").nth(1).getByRole("button", { name: "Frys klassen" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Frys loppet som IOF Complete" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("finalization-blocked-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("finalization-blocked-mobile.png"), fullPage: true });
});
