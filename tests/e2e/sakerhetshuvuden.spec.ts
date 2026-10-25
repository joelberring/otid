import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { createRace, openStep, publishRaceViaApi, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 46: de riktiga svarshuvudena på en publik sida, en adminsida, avläsningen, fest-sidan och en API-rutt.
 * Alla svar: nosniff, Referrer-Policy och X-Frame-Options DENY. Next-sidorna har en CSP med nonce (script-src
 * 'strict-dynamic'), och sidorna fungerar ändå: inga CSP-fel i konsolen och knapparna svarar (React har startat).
 */
function expectBase(response: APIResponse, referrer = "strict-origin-when-cross-origin") {
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe(referrer);
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
}

function expectPageCsp(response: APIResponse): string {
  const csp = response.headers()["content-security-policy"]!;
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce, csp).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  for (const part of ["object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(part);
  return nonce!;
}

/** Sidans skript har noncen ur svarshuvudet, och en ny förfrågan får en ny nonce. */
async function expectNoncedHtml(page: Page, path: string, referrer?: string) {
  const first = await page.request.get(path);
  expect(first.status(), path).toBe(200);
  expectBase(first, referrer);
  const nonce = expectPageCsp(first);
  const html = await first.text();
  expect(html).toContain(`nonce="${nonce}"`);
  const second = expectPageCsp(await page.request.get(path));
  expect(second).not.toBe(nonce);
}

function cspErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) errors.push(message.text()); });
  return errors;
}

test("säkerhetshuvuden: publika sidor, admin, avläsningen, festen och API:t", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `huvuden.${suffix}@exempel.se`, "Hugo Huvud");
  const ownerErrors = cspErrors(owner);
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of [`/admin/${none}/manage`, `/api/admin/races/${none}/administrator/session`,
    `/api/admin/races/${none}/administrator/transfer-candidates`, `/api/admin/races/${none}/administrator/party`,
    `/api/admin/races/${none}/administrator/readout-package`, `/api/admin/races/${none}/administrator/unknown-readout-resolution`,
    "/readout/index.html"]) await warmRoute(owner, path);
  const raceId = await createRace(owner, `Huvudfest ${suffix}`, undefined, "Fest");
  for (const path of ["/fest/aaaaaa", `/api/public/parties/${raceId}`, "/om", "/integritet"]) await warmRoute(owner, path);

  // Publika sidor.
  await expectNoncedHtml(owner, "/");
  await expectNoncedHtml(owner, "/om");
  await expectNoncedHtml(owner, "/integritet");

  // Adminsidan: privat, ingen referer, CSP med nonce; arbetsytan fungerar (knappen öppnar Publicera).
  await expectNoncedHtml(owner, `/admin/${raceId}/manage`, "no-referrer");
  await owner.reload();
  await owner.getByRole("button", { name: "Publicera", exact: true }).first().click();
  await expect(owner.getByRole("button", { name: "Publicera tävlingen" })).toBeVisible();

  // Avläsningen och bardisken: adressen i arbetsytan leder till skalet, som får Web Serial och WebUSB.
  const redirect = await owner.request.get(`/admin/${raceId}/readout`, { maxRedirects: 0 });
  expect([307, 308]).toContain(redirect.status());
  expect(redirect.headers()["permissions-policy"]).toContain("serial=(self)");
  expect(redirect.headers()["permissions-policy"]).toContain("usb=(self)");
  const shell = await owner.request.get("/readout/index.html");
  expectBase(shell, "no-referrer");
  expect(shell.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=(), serial=(self), usb=(self)");
  expect(shell.headers()["content-security-policy"]).toContain("script-src 'self'");
  const desk = await owner.context().newPage();
  const deskErrors = cspErrors(desk);
  await desk.goto(`/admin/${raceId}/readout`);
  await desk.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(desk.getByRole("heading", { name: "Bardisken" })).toBeVisible();
  await desk.close();
  expect(deskErrors).toEqual([]);

  // Fest-sidan: CSP med nonce, inte för robotar, och statistiken hämtas (skripten körs).
  await publishRaceViaApi(owner, raceId);
  await openStep(owner, "Fest");
  const publicPath = await owner.getByRole("link", { name: "Visa den publika sidan" }).getAttribute("href");
  const visitor = await (await browser.newContext()).newPage();
  const visitorErrors = cspErrors(visitor);
  await expectNoncedHtml(visitor, publicPath!);
  expect((await visitor.request.get(publicPath!)).headers()["x-robots-tag"]).toContain("noindex");
  await visitor.goto(publicPath!);
  await expect(visitor.getByTestId("party-numbers")).toBeVisible();
  await visitor.goto("/organizer");
  await visitor.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await expect(visitor.getByLabel("Ditt namn")).toBeVisible();
  expect(visitorErrors).toEqual([]);

  // API-rutt: egen strikt CSP och privat.
  const api = await visitor.request.get(`/api/public/parties/${raceId}`);
  expect(api.status()).toBe(200);
  expectBase(api, "no-referrer");
  expect(api.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  expect((await visitor.request.get(`/api/public/parties/${raceId}/logo`)).headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect(ownerErrors).toEqual([]);
});
