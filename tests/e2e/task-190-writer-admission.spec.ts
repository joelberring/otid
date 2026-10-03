import { expect, test } from "@playwright/test";

test.skip(process.platform !== "darwin", "This fail-closed browser check is scoped to macOS; Linux needs installation acceptance");

test("TASK195 pinned Linux admission fails closed on macOS before routes", async ({ request }) => {
  const page = "/activate";
  const closedPage = await request.get(page);
  expect(closedPage.status()).toBe(503);
  expect(closedPage.headers()["cache-control"]).toBe("no-store");
  expect(await closedPage.text()).toContain("tillfälligt pausad");

  const closedMutation = await request.post("/api/organizer/login", { data: {} });
  expect(closedMutation.status()).toBe(503);
  expect((await request.get("/checkin/sw.js")).status()).toBe(503);
});
