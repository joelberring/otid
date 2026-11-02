import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Locator, type Page, type Route } from "@playwright/test";
import { addPerson, createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0181 beslut 8 (ägarens synpunkter 2026-11-02): notiser med ritning och kartfel. På datorn: rita ett kartfel (dra
 * och klicka), spara, välj det på kartan, filtrera på slag, exportera till kartritaren (utan banor, kontrollkoder,
 * bannamn eller vem som skrev), markera klart och ta bort en notis som en annan öppen editor då inte längre ser. På
 * telefonen (390 px): "Rita kartfel" under Mer, rita med fingret, två fingrar zoomar utan att rita, spara och ta bort
 * utan nät genom kön. Skärmbilder i 1280 och 390 px när E2E_SCREENSHOT_DIR är satt.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
type Point = { x: number; y: number };
type Document = { controls: Record<string, { kind: string; code?: string; at: Point }>; courses: { id: string; name: string }[] };
type Notes = { notes: { id: string; text: string; kind: string; status: string; target: { kind: string; shapes?: { intent: string | null }[] } }[] };

async function screenOf(map: Locator, point: Point) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (point.x - centerX) * scale, y: box.y + box.height / 2 - (point.y - centerY) * scale };
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

/** Kartan och banorna: kartfilen och .ppen läses in av ägaren. */
async function setUp(owner: Page, raceId: string) {
  await warmCourseSetting(owner, raceId);
  const admin = `/api/admin/races/${raceId}/administrator`;
  const id = "00000000-0000-4000-8000-000000000000";
  await warmRoute(owner, `/admin/${raceId}/course-setting/map-errors`);
  await owner.request.fetch(`${admin}/course-setting/notes/${id}`, { method: "DELETE", failOnStatusCode: false, timeout: 120_000 });
  await owner.request.fetch(`${admin}/course-setting/notes/${id}/replies/${id}`, { method: "DELETE", failOnStatusCode: false, timeout: 120_000 });
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });
  return admin;
}

async function documentOf(page: Page, admin: string): Promise<Document> {
  return ((await (await page.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document;
}
const notesOf = async (page: Page, admin: string) => ((await (await page.request.get(`${admin}/course-setting/notes`)).json()) as Notes).notes;

/** En punkt på kartan så långt från alla kontroller som möjligt (inom kartans ruta, med marginal). */
function freePoint(document: Document, avoid: readonly Point[] = []): Point {
  const controls = [...Object.values(document.controls).map(control => control.at), ...avoid];
  let best = { x: 60, y: 50 }, bestDistance = -1;
  for (let x = 15; x <= 95; x += 2.5) for (let y = 15; y <= 85; y += 2.5) {
    const distance = Math.min(...controls.map(at => Math.hypot(at.x - x, at.y - y)));
    if (distance > bestDistance) { best = { x, y }; bestDistance = distance; }
  }
  return best;
}

/** Texten får inte nämna banorna, kontrollkoderna eller vem som skrev (kontrollkoder som egna ord). */
function expectNothingSecret(text: string, document: Document, label: string) {
  for (const course of document.courses) expect(text, `${label}: banan ${course.name}`).not.toContain(course.name);
  for (const control of Object.values(document.controls)) {
    if (control.code) expect(text, `${label}: kod ${control.code}`).not.toMatch(new RegExp(`(^|[^0-9.])${control.code}([^0-9.]|$)`));
  }
  for (const word of ["Bea", "Banläggare", "Kim", "2026", "Kontroll", "kontroll 3", "Sträckan"]) expect(text, `${label}: ${word}`).not.toContain(word);
}

async function openEditor(page: Page, raceId: string) {
  await page.goto(`/admin/${raceId}/course-setting`);
  const map = page.getByTestId("course-setting-map");
  await expect(map).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await expect(map).toHaveAttribute("data-px-per-mm", /\d/);
  return map;
}

test("notiser på datorn: rita ett kartfel, välj det på kartan, filtrera, exportera utan banor, markera klart och ta bort", async ({ browser }) => {
  test.setTimeout(480_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `notiser.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Notiser ${suffix}`, today(), "Tävling");
  const admin = await setUp(owner, raceId);
  const kimEmail = `kim.${suffix}@exempel.se`, miaEmail = `mia.${suffix}@exempel.se`;
  const kim = await registerAccount(browser, kimEmail, "Kim Kontrollant");
  const mia = await registerAccount(browser, miaEmail, "Mia Kartritare");
  const manage = await owner.context().newPage();
  await manage.goto(`/admin/${raceId}/manage`);
  await addPerson(manage, kimEmail, "Banläggning: läsa och kommentera");
  await addPerson(manage, miaEmail, "Kartritare: bara kartan och kartfelen");
  await manage.close();

  const document = await documentOf(owner, admin);
  const map = await openEditor(owner, raceId);
  await owner.getByRole("button", { name: "Visa hela kartan" }).click();
  await owner.waitForTimeout(400);
  owner.on("dialog", dialog => void dialog.accept());

  // 1. Rita ett kartfel: en streckad frihandslinje ("är fel") och en linje punkt för punkt med pil ("ska vara här").
  await owner.getByRole("tab", { name: /Notiser/ }).click();
  const panel = owner.getByTestId("course-setting-notes");
  await panel.getByRole("button", { name: "Rita kartfel" }).click();
  const sketch = owner.getByTestId("course-setting-sketch");
  await expect(sketch).toBeVisible();
  await expect(sketch.getByRole("button", { name: "Kartfel" })).toHaveAttribute("aria-pressed", "true");
  await sketch.getByRole("button", { name: "Är fel (streckad)" }).click();
  const at = freePoint(document);
  const start = await screenOf(map, at), scale = Number(await map.getAttribute("data-px-per-mm"));
  await owner.mouse.move(start.x, start.y);
  await owner.mouse.down();
  for (let i = 1; i <= 12; i += 1) await owner.mouse.move(start.x + i * scale, start.y - Math.sin(i / 3) * 2 * scale);
  await owner.mouse.up();
  await expect(owner.getByTestId("course-setting-sketch-count")).toContainText("1 del");
  await sketch.getByRole("button", { name: "Ska vara här (pil)" }).click();
  await owner.mouse.click(start.x, start.y + 4 * scale);
  await owner.mouse.click(start.x + 6 * scale, start.y + 5 * scale);
  await owner.mouse.click(start.x + 12 * scale, start.y + 4 * scale);
  await owner.keyboard.press("Enter");
  await expect(owner.getByTestId("course-setting-sketch-count")).toContainText("2 delar");
  // Ctrl+Z ångrar i ritningen, inte i banorna.
  await owner.keyboard.press("Control+z");
  await expect(owner.getByTestId("course-setting-sketch-count")).toContainText("1 del");
  for (const x of [0, 6, 12]) await owner.mouse.click(start.x + x * scale, start.y + (x === 6 ? 5 : 4) * scale);
  await owner.keyboard.press("Enter");
  await expect(owner.getByTestId("course-setting-sketch-count")).toContainText("2 delar");
  await expect(owner.getByTestId("course-setting-status")).toHaveText("Sparat");
  await screenshot(owner, "notiser-rita-1280");
  await sketch.getByRole("button", { name: "Klar – skriv text" }).click();
  const form = owner.getByTestId("course-setting-note-form");
  await expect(form.getByRole("button", { name: "Kartfel" })).toHaveAttribute("aria-pressed", "true");
  await form.getByLabel("Text").fill("Stigen går söder om kullen, beståndsgränsen ligger fel");
  await form.getByRole("button", { name: "Spara notisen" }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await notesOf(owner, admin)).map(note => [note.kind, note.target.kind,
    note.target.shapes?.map(shape => shape.intent)])).toEqual([["MAP_ERROR", "SKETCH", ["WRONG", "RIGHT"]]]);

  // 2. Ritningen är notisens markering: ett klick på linjen väljer den.
  const line = await screenOf(map, { x: at.x + 6, y: at.y + Math.sin(2) * 2 });
  await owner.mouse.click(line.x, line.y);
  await expect(panel.getByTestId("course-setting-note").first().getByRole("button", { expanded: true })).toBeVisible();
  await screenshot(owner, "notiser-vald-1280");

  // 3. En vanlig notis på en kontroll och ett kartfel på en punkt nära en kontroll, med foto.
  const c31 = Object.values(document.controls).find(control => control.code === "31")!;
  await owner.keyboard.press("n");
  const c31Screen = await screenOf(map, c31.at);
  await owner.mouse.click(c31Screen.x, c31Screen.y);
  await expect(form).toContainText(/Kontroll: .*31/);
  await expect(form.getByRole("button", { name: "Kartfel" })).toHaveCount(0);
  await form.getByLabel("Text").fill("Flytta närmare stigen");
  await form.getByRole("button", { name: "Spara notisen" }).click();
  await expect(form).toHaveCount(0);
  // Nära 31 (48 m), åt det håll som ligger längst från andra kontroller och ritningen, men inte upp till höger där
  // notisens flagga sitter.
  const others = [...Object.values(document.controls).filter(control => control !== c31).map(control => control.at), at, { x: at.x + 12, y: at.y }];
  const near = [90, 135, 180, 225, 270, 315].map(degrees => ({ x: c31.at.x + Math.cos(degrees * Math.PI / 180) * 4.8,
    y: c31.at.y + Math.sin(degrees * Math.PI / 180) * 4.8 }))
    .map(point => ({ point, distance: Math.min(...others.map(other => Math.hypot(other.x - point.x, other.y - point.y))) }))
    .sort((a, b) => b.distance - a.distance)[0]!.point;
  const nearScreen = await screenOf(map, near);
  await owner.mouse.click(nearScreen.x, nearScreen.y);
  await expect(form).toContainText("Punkt på kartan");
  await form.getByRole("button", { name: "Kartfel" }).click();
  await form.getByLabel("Text").fill("Sten saknas");
  await form.getByLabel("Foto (valfritt)").setInputFiles(fixture("maps/strackanalys.png"));
  await owner.waitForTimeout(500);
  await form.getByRole("button", { name: "Spara notisen" }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await notesOf(owner, admin)).length).toBe(3);
  await owner.keyboard.press("v");

  // 4. Filtret på slag och status (listan och kartan).
  const items = panel.getByTestId("course-setting-note");
  await expect(items).toHaveCount(3);
  await panel.getByRole("group", { name: "Slag" }).getByRole("button", { name: "Kartfel" }).click();
  await expect(items).toHaveCount(2);
  await panel.getByRole("group", { name: "Slag" }).getByRole("button", { name: "Banläggning" }).click();
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Flytta närmare stigen");
  await panel.getByRole("button", { name: "Båda slagen" }).click();
  await screenshot(owner, "notiser-lista-1280");

  // 5. Exporten till kartritaren: bara kartan och kartfelen; nära en kontroll inte med som förval; fotot av som förval.
  await panel.getByRole("link", { name: "Kartfel till kartritaren …" }).click();
  await expect(owner.getByRole("heading", { name: "Kartfel till kartritaren" })).toBeVisible({ timeout: 30_000 });
  const choices = owner.getByTestId("map-errors-choices").getByRole("listitem");
  await expect(choices).toHaveCount(2);
  const nearChoice = choices.filter({ hasText: "Sten saknas" });
  await expect(nearChoice).toContainText(/Nära en kontroll \(ca \d+ m\)/);
  await expect(nearChoice.getByRole("checkbox", { name: /Ta med: Sten saknas/ })).not.toBeChecked();
  await expect(owner.getByText("Kontrollera att texten inte avslöjar kontrollplatser.")).toBeVisible();
  const sheet = owner.getByTestId("map-errors-sheet");
  await expect(sheet.getByRole("img", { name: "Kartutsnitt för kartfel 1" })).toBeVisible({ timeout: 60_000 });
  await expect(sheet).not.toContainText("Sten saknas");
  await nearChoice.getByRole("checkbox", { name: /Ta med: Sten saknas/ }).check();
  await expect(sheet.getByRole("img", { name: "Kartutsnitt för kartfel 2" })).toBeVisible({ timeout: 60_000 });
  await expect(sheet.getByRole("img", { name: "Foto till kartfel 2" })).toHaveCount(0);
  await nearChoice.getByRole("checkbox", { name: "Ta med fotot" }).check();
  await expect(sheet.getByRole("img", { name: "Foto till kartfel 2" })).toBeVisible();
  await screenshot(owner, "notiser-export-1280");
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.waitForTimeout(300);
  await screenshot(owner, "notiser-export-390");
  await owner.setViewportSize({ width: 1280, height: 720 });
  const sheetText = await sheet.innerText();
  expect(sheetText).toContain("Stigen går söder om kullen");
  expectNothingSecret(sheetText, document, "utskriften");
  const [download] = await Promise.all([owner.waitForEvent("download"), owner.getByTestId("map-errors-geojson").click()]);
  expect(download.suggestedFilename()).toBe("kartfel.geojson");
  const geojson = JSON.parse(await readFile((await download.path()), "utf8")) as { features: { properties: Record<string, unknown>;
    geometry: { type: string } }[] };
  expect(geojson.features.map(feature => feature.geometry.type)).toEqual(["LineString", "LineString", "Point"]);
  expectNothingSecret(JSON.stringify(geojson.features.map(feature => feature.properties)), document, "GeoJSON");
  expect(JSON.stringify(geojson)).not.toContain("Flytta närmare stigen");
  await owner.getByRole("link", { name: /Tillbaka till banläggningen/ }).click();
  await openEditor(owner, raceId);

  // 6. Klar: döljs med förvalet Öppna, syns under Klara.
  await owner.getByRole("tab", { name: /Notiser/ }).click();
  await items.filter({ hasText: "Stigen går söder" }).getByRole("button").first().click();
  await panel.getByRole("button", { name: "Klar", exact: true }).click();
  await expect(items).toHaveCount(2);
  await panel.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Klara" }).click();
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Stigen går söder");
  await panel.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Alla" }).click();

  // 7. Ta bort (med bekräftelse); bankontrollanten som har editorn öppen ser att den är borta, och får inte ta bort ägarens.
  await openEditor(kim, raceId);
  await kim.getByRole("tab", { name: /Notiser/ }).click();
  const kimPanel = kim.getByTestId("course-setting-notes");
  await kimPanel.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Alla" }).click();
  const kimItems = kimPanel.getByTestId("course-setting-note");
  await expect(kimItems).toHaveCount(3);
  await kimItems.filter({ hasText: "Flytta närmare stigen" }).getByRole("button").first().click();
  await expect(kimPanel.getByRole("button", { name: "Ta bort", exact: true })).toHaveCount(0);
  await items.filter({ hasText: "Flytta närmare stigen" }).getByRole("button").first().click();
  await panel.getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect(items).toHaveCount(2);
  await expect(kimItems).toHaveCount(2, { timeout: 15_000 });
  await expect.poll(async () => (await notesOf(owner, admin)).map(note => note.text).sort()).toEqual(["Sten saknas",
    "Stigen går söder om kullen, beståndsgränsen ligger fel"]);
  await kim.context().close();

  // 8. Kartritaren: Mina tävlingar leder till kartfelen; inget av banläggningen, svarar och markerar klart.
  await mia.goto("/organizer");
  await mia.getByRole("button", { name: "Öppna kartfelen" }).click();
  await expect(mia.getByRole("heading", { name: "Kartfel till kartritaren" })).toBeVisible({ timeout: 30_000 });
  expect((await mia.request.get(`${admin}/course-setting`)).status()).toBe(403);
  expect((await mia.request.get(`${admin}/course-setting/suggestions`)).status()).toBe(403);
  const miaSheet = mia.getByTestId("map-errors-sheet");
  await expect(miaSheet).toContainText("Sten saknas");
  await expect(miaSheet.getByRole("img", { name: "Kartutsnitt för kartfel 1" })).toBeVisible({ timeout: 60_000 });
  await mia.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Alla" }).click();
  await expect(miaSheet).toContainText("Stigen går söder om kullen");
  expectNothingSecret(await mia.locator("main").innerText(), document, "kartritaren");
  await screenshot(mia, "notiser-kartritare-1280");
  const stone = miaSheet.locator("section").filter({ hasText: "Sten saknas" });
  await stone.getByLabel("Svar").fill("Stenen finns, ritad som liten sten");
  await stone.getByRole("button", { name: "Skicka svaret" }).click();
  await expect(stone).toContainText("Stenen finns, ritad som liten sten");
  await stone.getByRole("button", { name: "Klart – rättat" }).click();
  await expect.poll(async () => (await notesOf(owner, admin)).find(note => note.text === "Sten saknas")?.status).toBe("DONE");
  await mia.context().close();
});

async function touchStroke(page: Page, points: readonly Point[]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: points[0]!.x, y: points[0]!.y }] });
  for (const point of points.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function pinch(page: Page, center: Point) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: center.x - 20, y: center.y, id: 1 }, { x: center.x + 20, y: center.y, id: 2 }] });
  for (let i = 1; i <= 8; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: center.x - 20 - i * 8, y: center.y, id: 1 },
      { x: center.x + 20 + i * 8, y: center.y, id: 2 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function openMore(page: Page) {
  const more = page.getByTestId("course-setting-field-more");
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
}

async function phoneOf(browser: Browser, owner: Page) {
  const context = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true });
  return { context, phone: await context.newPage() };
}

test("notiser i telefonen: Rita kartfel under Mer, rita med fingret, två fingrar zoomar, spara och ta bort utan nät", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `notiser.mobil.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Notiser mobil ${suffix}`, today(), "Tävling");
  const admin = await setUp(owner, raceId);
  const document = await documentOf(owner, admin);
  const { context, phone } = await phoneOf(browser, owner);
  phone.on("dialog", dialog => void dialog.accept());
  const map = await openEditor(phone, raceId);
  await expect(phone.getByTestId("course-setting-field")).toBeVisible();
  await phone.getByRole("button", { name: "Visa hela kartan" }).click();
  await phone.waitForTimeout(400);

  // 1. Mer → Rita kartfel → ett streck med fingret.
  await openMore(phone);
  await phone.getByTestId("course-setting-sketch-button").click();
  const sketch = phone.getByTestId("course-setting-sketch");
  await expect(sketch).toBeVisible();
  await expect(sketch).toContainText("Rita med ett finger. Två fingrar flyttar och zoomar kartan.");
  await expect(phone.getByTestId("course-setting-field")).toHaveCount(0);
  const at = freePoint(document);
  const start = await screenOf(map, at), scale = Number(await map.getAttribute("data-px-per-mm"));
  await touchStroke(phone, Array.from({ length: 14 }, (_, i) => ({ x: start.x + i * scale, y: start.y + Math.sin(i / 3) * 2 * scale })));
  await expect(phone.getByTestId("course-setting-sketch-count")).toContainText("1 del");
  await screenshot(phone, "notiser-rita-390");
  const center = (await map.getAttribute("data-center"))!;

  // 2. Två fingrar zoomar och ritar inget.
  const box = (await map.boundingBox())!;
  await pinch(phone, { x: box.x + box.width / 2, y: box.y + box.height / 3 });
  await expect.poll(async () => Number(await map.getAttribute("data-px-per-mm"))).toBeGreaterThan(scale * 1.2);
  await expect(phone.getByTestId("course-setting-sketch-count")).toContainText("1 del");
  expect(await map.getAttribute("data-center")).not.toBe(center);

  // 3. Klar → text → spara utan nät; kön skickar när nätet kommer.
  await sketch.getByRole("button", { name: "Klar – skriv text" }).click();
  const form = phone.getByTestId("course-setting-note-form");
  await expect(form.getByRole("button", { name: "Kartfel" })).toHaveAttribute("aria-pressed", "true");
  await form.getByLabel("Text").fill("Stigen saknas på kartan");
  await screenshot(phone, "notiser-text-390");
  const noNetwork = (route: Route) => route.abort("internetdisconnected");
  await context.setOffline(true);
  await context.route("**/*", noNetwork);
  await form.getByRole("button", { name: "Spara notisen" }).click();
  await expect(form).toHaveCount(0);
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText(/Utan nät – 1 ändring väntar/, { timeout: 15_000 });
  await context.unroute("**/*", noNetwork);
  await context.setOffline(false);
  await expect.poll(async () => (await notesOf(owner, admin)).map(note => [note.kind, note.target.kind, note.text]), { timeout: 30_000 })
    .toEqual([["MAP_ERROR", "SKETCH", "Stigen saknas på kartan"]]);
  await expect(phone.getByTestId("course-setting-field-status")).toHaveText("Sparat", { timeout: 30_000 });

  // 4. Ta bort utan nät: borta i telefonen direkt, på servern när nätet är tillbaka.
  await openMore(phone);
  await phone.getByRole("tab", { name: /Notiser/ }).click();
  const panel = phone.getByTestId("course-setting-notes");
  const items = panel.getByTestId("course-setting-note");
  await expect(items).toHaveCount(1, { timeout: 15_000 });
  await items.first().getByRole("button").first().click();
  await screenshot(phone, "notiser-lista-390");
  await context.setOffline(true);
  await context.route("**/*", noNetwork);
  await panel.getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect(items).toHaveCount(0);
  expect(await notesOf(owner, admin)).toHaveLength(1);
  await context.unroute("**/*", noNetwork);
  await context.setOffline(false);
  await expect.poll(async () => (await notesOf(owner, admin)).length, { timeout: 30_000 }).toBe(0);
  await expect(items).toHaveCount(0);
  await context.close();
});
