import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createDatabase } from "@o-tid/database";
import { createRace, daysFromToday, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0214: länken till kartritaren. Banläggaren skapar länken i Kartfel (utan tidsgräns), kartritaren öppnar den i en ny
 * webbläsare utan konto (390 px), ser kartan och kartfelen men inga banor, svarar och trycker "Åtgärdat i kartan"; banläggaren
 * ser det direkt i Kartfel. Beslut 9: banläggaren redigerar sitt svar och båda ser "(ändrad …)". Avstängd, ersatt och utgången
 * länk ger samma besked. Skärmbilder i 1280 och 390 px när E2E_SCREENSHOT_DIR är satt. Bara syntetiska data (kartfil.omap).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const INVALID = "Länken gäller inte längre – be banläggaren om en ny.";
type Document = { controls: Record<string, { kind: string; code?: string; at: { x: number; y: number } }>; courses: { id: string; name: string }[] };

async function screenshot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

/** Kartfilen och banorna (som i notistestet), två kartfel och en notis på en kontroll som kartritaren inte får se. */
async function setUp(owner: Page, raceId: string): Promise<Document> {
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/map-errors`);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-setting/map-link`);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });
  const admin = `/api/admin/races/${raceId}/administrator`;
  const document = ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document;
  const control = Object.entries(document.controls).find(([, row]) => row.kind === "NORMAL")![0];
  const headers = { origin: new URL(owner.url()).origin, "x-otid-csrf": await csrf(owner), "content-type": "application/json" };
  const note = (target: unknown, text: string, kind?: string) => owner.request.post(`${admin}/course-setting/notes`, { headers, data: {
    formatVersion: 1, requestId: crypto.randomUUID(), target, at: null, course: null, text, photo: null, ...(kind ? { kind } : {}) } });
  for (const response of [
    await note({ kind: "POINT", at: { x: 30, y: 40 } }, "Stigen saknas vid stenen", "MAP_ERROR"),
    await note({ kind: "SKETCH", shapes: [{ kind: "LINE", style: "MAP_ERROR", intent: "WRONG", points: [{ x: 60, y: 60 }, { x: 66, y: 63 }, { x: 72, y: 61 }] }] },
      "Beståndsgränsen ligger fel", "MAP_ERROR"),
    await note({ kind: "CONTROL", control }, "Flytta kontrollen hemligt")
  ]) expect(response.ok(), await response.text()).toBe(true);
  return document;
}

/** Kartfel med "Dela med kartritaren": skapar länken och ger adressen. */
async function createLink(owner: Page, options: { limit?: boolean } = {}): Promise<string> {
  const panel = owner.getByTestId("map-link-panel");
  await panel.getByRole("button", { name: "Dela med kartritaren" }).click();
  if (options.limit) {
    await panel.getByLabel("Begränsa tiden").check();
    await expect(panel.getByLabel("Gäller till och med")).toHaveValue(daysFromToday(7));
  }
  await panel.getByRole("button", { name: "Skapa länken" }).click();
  const field = panel.getByTestId("map-link-url");
  await expect(field).toHaveValue(/\/kartfel\/[A-Za-z0-9_-]{43}$/);
  return field.inputValue();
}

/** Kartritarens webbläsare: ny kontext utan session, telefonens storlek. */
async function mapMaker(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return context.newPage();
}

/** Länken ut: lokalt i testdatabasen, mot driftmiljön i dess PostgreSQL (ADR-0214: utgången länk). */
async function expireLinks(raceId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(raceId)) throw new Error("Ogiltigt id");
  const statement = `update course_setting_map_link set created_at = now() - interval '3 days', expires_at = now() - interval '1 day'
    where race_id = '${raceId}' and revoked_at is null`;
  if (process.env.E2E_BASE_URL) {
    execFileSync("docker", ["compose", "-f", "docker-compose.prod.yml", "exec", "-T", "postgres", "psql", "-U", "otid", "-d", "otid", "-c", statement],
      { cwd: root, stdio: "pipe" });
    return;
  }
  const { pool } = createDatabase(process.env.E2E_DATABASE_URL!);
  try { await pool.query(statement); } finally { await pool.end(); }
}

test("kartritarens länk: dela utan tidsgräns, svara och åtgärda utan konto, redigera, stäng av", async ({ browser }) => {
  test.setTimeout(480_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartlank.${suffix}@exempel.se`, "Bea Banläggare");
  await owner.setViewportSize({ width: 1280, height: 900 });
  const raceId = await createRace(owner, `Kartritarlänk ${suffix}`, today(), "Tävling");
  const document = await setUp(owner, raceId);
  owner.on("dialog", dialog => void dialog.accept());

  await owner.goto(`/admin/${raceId}/course-setting/map-errors`);
  await expect(owner.getByTestId("map-link-panel")).toBeVisible({ timeout: 30_000 });
  const url = await createLink(owner);
  const token = url.split("/").at(-1)!;
  const panel = owner.getByTestId("map-link-panel");
  await expect(panel.getByTestId("map-link-status")).toContainText("Länken gäller tills du stänger av den.");
  await expect(panel.getByTestId("map-link-status")).toContainText("Inte öppnad än.");
  await expect(panel.getByRole("button", { name: "Kopiera länken" })).toBeVisible();
  // Alla kartfel i listan, så att det som kartritaren gör syns direkt (också det som blir klart).
  await owner.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Alla" }).click();
  await screenshot(owner, "kartfel-dela-1280");

  // Kartritaren: ny webbläsare utan konto, telefonen.
  const mapper = await mapMaker(browser);
  await mapper.goto(new URL(url).pathname);
  await expect(mapper.getByRole("heading", { name: "Kartfel", level: 1 })).toBeVisible();
  await expect(mapper.getByTestId("map-link-error")).toHaveCount(2);
  await expect(mapper.getByTestId("course-setting-map")).toBeVisible({ timeout: 90_000 });
  await expect(mapper.getByTestId("course-setting-overprint")).toHaveAttribute("data-marks", /notes:1/);
  const text = await mapper.locator("main").innerText();
  for (const course of document.courses) expect(text, course.name).not.toContain(course.name);
  for (const control of Object.values(document.controls)) {
    if (control.code) expect(text, control.code).not.toMatch(new RegExp(`(^|[^0-9.])${control.code}([^0-9.]|$)`));
  }
  for (const word of ["Flytta kontrollen", "Kartritarlänk", "Bea"]) expect(text, word).not.toContain(word);
  // Med nyckeln finns inga banor att hämta, och arbetsytans API kräver inloggning.
  for (const path of [`/api/public/map-link/${token}/courses`, `/api/public/map-link/${token}/course-setting`]) {
    expect((await mapper.request.get(path)).status(), path).toBe(404);
  }
  expect([401, 403]).toContain((await mapper.request.get(`/api/admin/races/${raceId}/administrator/course-setting`)).status());
  const view = await (await mapper.request.get(`/api/public/map-link/${token}`)).json() as Record<string, unknown>;
  expect(Object.keys(view).sort()).toEqual(["formatVersion", "map", "mapErrors", "raceName"]);
  expect(view.raceName).toBeNull();
  await screenshot(mapper, "kartritare-lista-390");

  // Svara med namn, och "Åtgärdat i kartan" med en kommentar.
  await mapper.getByLabel("Ditt namn (valfritt)").fill("Kim Karta");
  const first = mapper.getByTestId("map-link-error").first();
  await first.getByRole("button", { name: /Kartfel 1/ }).click();
  await first.getByLabel("Svar").fill("Vilken sten menar ni?");
  await first.getByRole("button", { name: "Skicka svaret" }).click();
  await expect(first.getByTestId("map-link-reply")).toContainText("Vilken sten menar ni?");
  await expect(first.getByTestId("map-link-reply")).toContainText("Kim Karta");
  await first.getByLabel("Kommentar (valfri)").fill("Stigen inritad");
  await first.getByRole("button", { name: "Åtgärdat i kartan" }).click();
  await expect(first).toHaveAttribute("data-status", "DONE");
  await expect(first.getByTestId("map-link-reply").last()).toContainText("Åtgärdat i kartan");
  await screenshot(mapper, "kartritare-trad-390");

  // Banläggaren ser det direkt (strömmen), utan att läsa om sidan.
  const thread = owner.getByTestId("map-errors-choices").getByTestId("map-errors-thread").first();
  await expect(thread).toContainText("Vilken sten menar ni?", { timeout: 20_000 });
  await expect(thread).toContainText("Kim Karta");
  await expect(thread).toContainText("Åtgärdat i kartan");
  await expect(owner.getByTestId("map-errors-status").first()).toHaveText("Klar");

  // Beslut 9: banläggaren svarar, redigerar sitt svar och båda ser "(ändrad …)".
  await thread.getByLabel("Svar").fill("Tack, gäller den gamla stigen");
  await thread.getByRole("button", { name: "Skicka svaret" }).click();
  const own = thread.getByTestId("map-errors-reply").filter({ hasText: "Tack, gäller den gamla stigen" });
  await expect(own).toBeVisible();
  // Kartritarens svar går inte att redigera för banläggaren.
  await expect(thread.getByTestId("map-errors-reply").filter({ hasText: "Vilken sten" }).getByRole("button", { name: "Redigera" })).toHaveCount(0);
  await own.getByRole("button", { name: "Redigera" }).click();
  await own.getByLabel("Text").fill("Tack, gäller den gamla stigen norr om stenen");
  await own.getByRole("button", { name: "Spara" }).click();
  await expect(own.getByTestId("note-edited")).toContainText("(ändrad");
  await expect(own).toContainText("norr om stenen");
  await mapper.reload();
  await mapper.getByTestId("map-link-error").first().getByRole("button", { name: /Kartfel 1/ }).click();
  const edited = mapper.getByTestId("map-link-reply").filter({ hasText: "norr om stenen" });
  await expect(edited.getByTestId("note-edited")).toContainText("(ändrad");
  await expect(mapper.getByText("Tack, gäller den gamla stigen", { exact: true })).toHaveCount(0);
  await screenshot(mapper, "kartritare-andrad-390");

  // "Senast öppnad" efter att kartritaren öppnat länken.
  await owner.reload();
  await expect(owner.getByTestId("map-link-status")).toContainText("Senast öppnad", { timeout: 30_000 });
  await screenshot(owner, "kartfel-oppnad-1280");
  await owner.setViewportSize({ width: 390, height: 844 });
  await screenshot(owner, "kartfel-dela-390");
  await owner.setViewportSize({ width: 1280, height: 900 });
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(new URL(url).pathname);
  await expect(desktop.getByTestId("course-setting-map")).toBeVisible({ timeout: 90_000 });
  await screenshot(desktop, "kartritare-1280");
  await desktop.context().close();

  // Stäng av: gäller direkt.
  await owner.getByTestId("map-link-panel").getByRole("button", { name: "Stäng av länken" }).click();
  await expect(owner.getByTestId("map-link-panel")).toContainText("Länken är avstängd.");
  await mapper.reload();
  await expect(mapper.getByText(INVALID)).toBeVisible();
  await screenshot(mapper, "kartritare-avstangd-390");
  expect((await mapper.request.get(`/api/public/map-link/${token}`)).status()).toBe(404);
  await mapper.context().close();
});

test("kartritarens länk: ny länk stänger den gamla, och en utgången länk ger samma besked", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartlank2.${suffix}@exempel.se`, "Bea Banläggare");
  await owner.setViewportSize({ width: 390, height: 844 });
  const raceId = await createRace(owner, `Kartritarlänk tid ${suffix}`, today(), "Tävling");
  await setUp(owner, raceId);
  owner.on("dialog", dialog => void dialog.accept());
  await owner.goto(`/admin/${raceId}/course-setting/map-errors`);
  await expect(owner.getByTestId("map-link-panel")).toBeVisible({ timeout: 30_000 });
  const old = await createLink(owner);
  // "Skapa ny länk" med "Begränsa tiden" (förslaget: tävlingsdagen plus en vecka).
  await owner.getByTestId("map-link-panel").getByRole("button", { name: "Skapa ny länk" }).click();
  await owner.getByTestId("map-link-panel").getByLabel("Begränsa tiden").check();
  await expect(owner.getByTestId("map-link-panel").getByLabel("Gäller till och med")).toHaveValue(daysFromToday(7));
  await owner.getByTestId("map-link-panel").getByRole("button", { name: "Skapa länken" }).click();
  const field = owner.getByTestId("map-link-url");
  await expect(field).not.toHaveValue(old);
  const url = await field.inputValue();
  await expect(owner.getByTestId("map-link-status")).toContainText("Länken gäller till och med");
  await screenshot(owner, "kartfel-tidsgrans-390");

  const mapper = await mapMaker(browser);
  await mapper.goto(new URL(old).pathname);
  await expect(mapper.getByText(INVALID)).toBeVisible();
  await mapper.goto(new URL(url).pathname);
  await expect(mapper.getByTestId("map-link-error")).toHaveCount(2);

  // Tiden har gått ut (sätts i databasen): samma besked som en avstängd eller okänd länk.
  await expireLinks(raceId);
  await mapper.reload();
  await expect(mapper.getByText(INVALID)).toBeVisible();
  await mapper.goto(`/kartfel/${"Z".repeat(43)}`);
  await expect(mapper.getByText(INVALID)).toBeVisible();
  await owner.reload();
  await expect(owner.getByTestId("map-link-status")).toContainText("Länken har gått ut.", { timeout: 30_000 });
  await owner.setViewportSize({ width: 1280, height: 900 });
  await screenshot(owner, "kartfel-utgangen-1280");
  await mapper.context().close();
});
