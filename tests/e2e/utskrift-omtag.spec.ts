import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0211: utskriftssidan om. Färgprofilen som en rad, Skriv ut med skrivaren och PDF:en bredvid varandra, översikten med
 * ett kort per ark, papperet direkt på arket (dubbelklick skriver i texten, dra med fästning och hjälplinjer, ram, logotyp,
 * vitt på utskriften), mallen sparad och använd på alla banor, och ringklippen över detaljer i förhandsvisningen och PDF:en.
 * En mindre runda i 390 px. Syntetiska filer: kartfil.omap med en stig rakt genom kontroll 36.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string, part?: Locator) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    if (part) { await part.scrollIntoViewIfNeeded(); await part.screenshot({ path: `${shots}/utskrift-omtag-${name}-${width}.png` }); }
    else await page.screenshot({ path: `${shots}/utskrift-omtag-${name}-${width}.png`, fullPage: width === 390 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${name} i ${width} px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

function pdfStreams(bytes: Buffer): string {
  const text = bytes.toString("latin1");
  const out: string[] = [];
  const pattern = /\/FlateDecode[^]*?stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].length;
    try { out.push(inflateSync(bytes.subarray(start, text.indexOf("endstream", start))).toString("latin1")); } catch { /* typsnitt och bilder */ }
  }
  return out.join("\n");
}

/** En liten PNG (logotypen), 40 × 20 bildpunkter. */
function png(width = 40, height = 20): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from([200, 40, 120])))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

type Item = { id: string; kind: string; text?: string; at: { corner: string; x: number; y: number } };
type Doc = { courses: { id: string; name: string }[]; event: { paperLayouts?: Record<string, { template?: string; items?: Item[]; whiteAreas?: unknown[] }>;
  paperTemplates?: { id: string; name: string }[] } };

test("utskrift-omtag: färgerna på en rad, översikten, papperet direkt på arket, mallen på alla banor och ringklippen i PDF:en", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `omtag.${suffix}@exempel.se`, "Olle Omtag");
  const raceId = await createRace(owner, `Omtag ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  const doc = async (): Promise<Doc> => {
    const read = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Doc } }).setting.document;
    try { return await read(); } catch { return await read(); }
  };

  // Kartan med en stig genom kontroll 36 (50, 18) och banorna; klipp över detaljer på.
  const omap = (await readFile(fixture("maps/kartfil.omap"), "utf8")).replace('<objects count="11">', '<objects count="12">')
    .replace("</objects></part>", '<object type="1" symbol="5"><coords count="2">50000 -8000;50000 -28000;</coords></object>\n</objects></part>');
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles({ name: "kartfil.omap", mimeType: "application/octet-stream", buffer: Buffer.from(omap) });
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
  const csrf = async () => (await owner.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
  const version = ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { version: number } }).setting.version;
  const edited = await owner.request.post(`${admin}/course-setting/edits`, { headers: { origin: new URL(owner.url()).origin, "x-otid-csrf": await csrf() },
    data: { formatVersion: 1, requestId: crypto.randomUUID(), baseVersion: version, edits: [{ type: "SET_EVENT", changes: { circleCutting: { overlap: false, details: true } } }] } });
  expect(edited.status()).toBe(200);
  const courses = (await doc()).courses;

  // Utskriftssidan: färgerna på en rad med status, Skriv ut och PDF:en bredvid varandra.
  await owner.goto(`/admin/${raceId}/course-setting/print?course=1`);
  const sheet = owner.getByTestId("print-sheet").first();
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  const colors = owner.getByTestId("print-profile");
  await expect(colors).toHaveAttribute("data-open", "no");
  await expect(colors.getByTestId("print-profile-status")).toBeVisible();
  const output = owner.getByTestId("print-output");
  await expect(output.getByRole("button", { name: "Skriv ut på skrivare" })).toBeVisible();
  await expect(output.getByTestId("print-pdf")).toContainText("Skapa PDF för tryckeriet");

  // Ringklippen över detaljer: ringen vid 36 är två bågar (två "M" i vägen) i förhandsvisningen.
  await expect.poll(async () => {
    const paths = await sheet.locator("path[data-role=CONTROL]").evaluateAll(items => items.map(item => (item.getAttribute("d") ?? "").split("M").length - 1));
    return Math.max(0, ...paths);
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);

  // Översikten: ett kort per ark; ett klick öppnar arket för redigering.
  const cards = owner.getByTestId("print-card");
  await expect(cards).toHaveCount(1);
  await cards.first().getByTestId("print-card-open").click();
  await expect(owner.locator("[id^=print-sheet-][data-open]")).toHaveCount(1);
  await shot(owner, "oversikt");

  // Text: läggs till, dubbelklick skriver i den på arket med en variabel.
  const panel = owner.getByTestId("paper-space");
  await panel.getByTestId("paper-add-TEXT").click();
  const text = sheet.locator("[data-testid=paper-item][data-kind=TEXT]");
  await expect(text).toHaveCount(1, { timeout: 15_000 });
  await text.locator("rect[fill=transparent]").dblclick();
  const editor = owner.getByTestId("paper-text-editor");
  await expect(editor).toBeVisible();
  await editor.getByTestId("paper-text-inplace").fill("Natt-KM ");
  await editor.getByTestId("paper-text-inplace-variable").selectOption("bana");
  await editor.getByTestId("paper-text-inplace-done").click();
  await expect(text).toContainText("Natt-KM Lång", { timeout: 15_000 });
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.items!.find(item => item.kind === "TEXT")!.text).toBe("Natt-KM {bana}");
  await shot(owner, "text-pa-arket", sheet);

  // Dra texten nära kartramens vänsterkant: den fäster mot kanten (hjälplinjen syns medan den dras).
  await owner.getByTestId("paper-snap-enabled").check();
  const frame = (await sheet.getByTestId("print-frame").first().locator("image").first().boundingBox())!;
  const box = (await text.locator("rect[fill=transparent]").boundingBox())!;
  const mmPerPx = 297 / (await sheet.boundingBox())!.width;
  await owner.mouse.move(box.x + 4, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(frame.x + 4 + 0.6 / mmPerPx, box.y + box.height / 2 - 40, { steps: 10 });
  await expect(sheet.getByTestId("paper-guide").first()).toBeAttached();
  await owner.mouse.up();
  await expect(sheet.getByTestId("paper-guide")).toHaveCount(0);
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.items!.find(item => item.kind === "TEXT")!.at)
    .toMatchObject({ x: 0 });

  // En ram och en logotyp.
  await panel.getByTestId("paper-add-RECT").click();
  await expect(sheet.locator("[data-testid=paper-item][data-kind=RECT]")).toHaveCount(1, { timeout: 15_000 });
  await panel.getByTestId("paper-image-file").setInputFiles({ name: "logga.png", mimeType: "image/png", buffer: png() });
  await expect(sheet.locator("[data-testid=paper-item][data-kind=IMAGE]")).toHaveCount(1, { timeout: 30_000 });

  // Vitt på utskriften: en rektangel; hörnen dras på arket.
  await panel.getByTestId("paper-white-add-RECT").click();
  await expect(sheet.getByTestId("print-white-area")).toHaveCount(1, { timeout: 15_000 });
  await expect(sheet.getByTestId("paper-white-handles")).toBeVisible();
  const handle = sheet.getByTestId("paper-white-handle").first();
  await handle.scrollIntoViewIfNeeded();
  const corner = (await handle.boundingBox())!;
  const whiteBefore = JSON.stringify((await doc()).event.paperLayouts!["1"]!.whiteAreas);
  await owner.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(corner.x - 20, corner.y + 15, { steps: 5 });
  await owner.mouse.up();
  await expect.poll(async () => JSON.stringify((await doc()).event.paperLayouts!["1"]!.whiteAreas)).not.toBe(whiteBefore);
  await shot(owner, "papperet", sheet);

  // Mallen: spara banans papper som mall och använd den på alla banor i översikten.
  await panel.getByTestId("paper-template-name").fill("Natt A4");
  await panel.getByTestId("paper-template-save").click();
  await expect.poll(async () => (await doc()).event.paperTemplates?.map(row => row.name)).toEqual(["Natt A4"]);
  await owner.getByTestId("print-output").getByLabel("Alla", { exact: true }).check();
  await expect(cards).toHaveCount(courses.length + 1);
  await owner.getByTestId("print-overview-apply-all").click();
  await expect.poll(async () => {
    const layouts = (await doc()).event.paperLayouts ?? {};
    return courses.every(course => layouts[course.id]?.template !== undefined);
  }, { timeout: 30_000 }).toBe(true);
  await expect(cards.filter({ has: owner.getByTestId("print-card-template") })).toHaveCount(courses.length, { timeout: 30_000 });
  await expect(owner.getByTestId("print-sheet").locator("[data-testid=paper-item][data-kind=RECT]")).toHaveCount(courses.length, { timeout: 30_000 });
  await shot(owner, "mallen-pa-alla");

  // PDF:en för kontorsskrivaren har ringklippen (öppna bågar "c S") och den vita ytan.
  await owner.getByTestId("print-output").getByLabel("Alla", { exact: true }).uncheck();
  await owner.getByTestId("print-output").getByLabel("Lång", { exact: true }).check();
  const pdfPanel = owner.getByTestId("print-pdf");
  await pdfPanel.getByTestId("print-pdf-office").click();
  const job = pdfPanel.locator("[data-testid=print-job][data-kind=OFFICE]").first();
  await expect(job).toHaveAttribute("data-status", "DONE", { timeout: 180_000 });
  const href = (await job.getByTestId("print-job-download").getAttribute("href"))!;
  const content = pdfStreams(Buffer.from(await (await owner.request.get(href)).body()));
  expect(content).toMatch(/\d c S/);
  expect(content).toMatch(/ W\* n/);
});

test("utskrift-omtag i telefonen: listan, tryck på ett element och dra det", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `omtagt.${suffix}@exempel.se`, "Tea Telefon");
  const raceId = await createRace(owner, `Omtag tel ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });

  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting/print?course=1`);
  const sheet = phone.getByTestId("print-sheet").first();
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await expect(phone.getByTestId("print-card")).toHaveCount(1);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await phone.getByTestId("paper-space").getByTestId("paper-add-NORTH_ARROW").click();
  const arrow = sheet.locator("[data-testid=paper-item][data-kind=NORTH_ARROW]");
  await expect(arrow).toHaveCount(1, { timeout: 15_000 });
  // Markeringen: fälten i ett ark nere på skärmen.
  const inspector = phone.getByTestId("paper-inspector");
  await expect(inspector).toBeVisible();
  const sheetBox = (await inspector.boundingBox())!;
  expect(sheetBox.y + sheetBox.height).toBeGreaterThan(800);
  // Dra pilen med fingret (pekhändelser): den flyttas.
  await phone.getByTestId("paper-deselect").click();
  await arrow.scrollIntoViewIfNeeded();
  const before = (await arrow.boundingBox())!;
  await arrow.locator("rect[fill=transparent]").dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0,
    clientX: before.x + before.width / 2, clientY: before.y + before.height / 2 });
  await arrow.locator("rect[fill=transparent]").dispatchEvent("pointermove", { pointerId: 7, pointerType: "touch", isPrimary: true,
    clientX: before.x + before.width / 2 - 40, clientY: before.y + before.height / 2 + 30 });
  await arrow.locator("rect[fill=transparent]").dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", isPrimary: true,
    clientX: before.x + before.width / 2 - 40, clientY: before.y + before.height / 2 + 30 });
  await expect.poll(async () => {
    const read = ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Doc } }).setting.document;
    return read.event.paperLayouts?.["1"]?.items?.find(item => item.kind === "NORTH_ARROW")?.at;
  }, { timeout: 30_000 }).not.toMatchObject({ corner: "TOP_RIGHT", x: 3, y: 30 });
  if (shots) await phone.screenshot({ path: `${shots}/utskrift-omtag-telefon-390.png`, fullPage: true });
  await phoneContext.close();
});
