import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * Översynen 2026-11-02 (ADR-0181 beslut 9): telefonen utan nät med många ändringar. Två kontroller flyttas i många steg,
 * en kontroll kollas och en notis skrivs; posten i telefonen skrivs efter varje ändring. När nätet kommer tillbaka sparas
 * ändringarna först och sedan kön, inget stryks, och servern har alla flyttar, bocken och notisen på rätt kontroll.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
type Document = { controls: Record<string, { id: string; kind: string; code?: string; at: { x: number; y: number } }> };
const STEPS = 30;

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function tapControl(page: Page, x: number, y: number, label: string) {
  const at = await screenOf(page.getByTestId("course-setting-map"), x, y);
  await page.touchscreen.tap(at.x, at.y);
  await expect(page.getByTestId("course-setting-field-selected")).toHaveText(`Vald: kontroll ${label}`);
}

test("utan nät: många ändringar, en bock och en notis sparas i ordning när nätet kommer tillbaka", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `sparande.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Sparande ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });
  const before = ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document; version: number } }).setting;
  const byCode = (document: Document, code: string) => Object.values(document.controls).find(control => control.code === code)!;

  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  await expect(phone.getByTestId("course-setting-field")).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await expect(phone.getByTestId("course-setting-map")).toHaveAttribute("data-px-per-mm", /\d/);
  await phone.getByTestId("course-setting-field-course").selectOption({ label: "Lång" });
  await phone.getByRole("button", { name: "Visa hela kartan" }).click();
  await phone.waitForTimeout(400);
  const status = phone.getByTestId("course-setting-field-status");

  // Utan nät (också service workerns egna anrop).
  const noNetwork = (route: Route) => route.abort("internetdisconnected");
  await phoneContext.setOffline(true);
  await phoneContext.route("**/*", noNetwork);
  await tapControl(phone, 76, 52, "33");
  for (let step = 0; step < STEPS; step += 1) await phone.getByRole("button", { name: "Flytta 1 m österut" }).click();
  await phone.getByTestId("course-setting-inspect").click();
  await expect(phone.getByTestId("course-setting-inspected-by")).toContainText("väntar på nät");
  await tapControl(phone, 42, 61, "32");
  for (let step = 0; step < STEPS; step += 1) await phone.getByRole("button", { name: "Flytta 1 m norrut" }).click();
  const chooser = phone.waitForEvent("filechooser");
  if (!(await phone.getByTestId("course-setting-note-here-button").isVisible())) {
    const more = phone.getByTestId("course-setting-field-more");
    if (await more.getAttribute("aria-expanded") !== "true") await more.click();
  }
  await phone.getByTestId("course-setting-note-here-button").click();
  await (await chooser).setFiles([]);
  const sheet = phone.getByTestId("course-setting-note-here");
  await sheet.getByLabel("Text (valfritt med foto)").fill("Stenen är högre än på kartan");
  await sheet.getByRole("button", { name: "Spara notisen" }).click();
  await expect(status).toHaveText(`Utan nät – ${2 * STEPS + 2} ändringar väntar`, { timeout: 15_000 });
  // Posten i telefonen: loggen med alla flyttar, grunden skriven en gång (posten skrivs strax efter senaste ändringen).
  await phone.waitForTimeout(800);
  const stored = await phone.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open("otid-course-setting"); open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error(open.error?.message ?? "IndexedDB")); });
    const get = <T,>(store: string) => new Promise<T>((resolve, reject) => { const request = db.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result as T); request.onerror = () => reject(new Error(request.error?.message ?? "IndexedDB")); });
    const record = await get<{ formatVersion: number; log: unknown[]; document?: unknown }>("record");
    const base = await get<{ version: number } | undefined>("base");
    return { format: record.formatVersion, log: record.log.length, hasDocument: record.document !== undefined, base: base?.version };
  }, raceId);
  expect(stored).toEqual({ format: 2, log: 2 * STEPS, hasDocument: false, base: before.version });

  // Nätet tillbaka: allt sparas, inget stryks.
  await phoneContext.unroute("**/*", noNetwork);
  await phoneContext.setOffline(false);
  await expect(status).toHaveText("Sparat", { timeout: 60_000 });
  await expect(phone.getByText(/^Nätet är tillbaka: /)).toBeVisible();
  await expect(phone.getByText(/kunde inte sparas/)).toHaveCount(0);
  const after = ((await (await phone.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document;
  // 1 m = 0,1 mm på kartan i 1:10 000.
  expect(byCode(after, "33").at.x).toBeCloseTo(byCode(before.document, "33").at.x + STEPS * 0.1, 1);
  expect(byCode(after, "32").at.y).toBeCloseTo(byCode(before.document, "32").at.y + STEPS * 0.1, 1);
  await expect.poll(async () => ((await (await phone.request.get(`${admin}/course-setting/inspections`)).json()) as { inspections: { control: string }[] })
    .inspections.map(row => row.control)).toEqual([byCode(after, "33").id]);
  await expect.poll(async () => ((await (await phone.request.get(`${admin}/course-setting/notes`)).json()) as { notes: { text: string;
    target: { kind: string; control?: string } }[] }).notes.map(note => [note.text, note.target.control]))
    .toEqual([["Stenen är högre än på kartan", byCode(after, "32").id]]);
  await phoneContext.close();
});
