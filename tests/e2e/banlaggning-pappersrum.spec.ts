import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0197: papperet ("paper space") i förhandsvisningen. Text med variabler (fet, mitten, vit bakgrund), logotyp (PNG och
 * SVG) med täckning, skalstock och nordpil; dra, piltangenter, Delete, ångra och klick på tomt papper; klippning av kartan
 * (rektangel, tonad utanför); mall för papperet som alla banor ärver och kontots bibliotek; editorn ("model space") visar
 * inget av det, och .ppen får Purple Pens text- och bildobjekt. Skärmbilder i 1280 och 390 px till E2E_SCREENSHOT_DIR.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string, part?: Locator) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    if (part) { await part.scrollIntoViewIfNeeded(); await part.screenshot({ path: `${shots}/${name}-${width}.png` }); }
    else await page.screenshot({ path: `${shots}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** En liten PNG (bredd × höjd, ljusblå). */
function png(width: number, height: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from([40, 120, 200])))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#0a5"/>
<text x="60" y="27" font-size="20" text-anchor="middle" fill="#fff" font-family="Arial">OK</text></svg>`;

type Item = { id: string; kind: string; at: { corner: string; x: number; y: number }; text?: string; opacity?: number; pages?: string };
type Layout = { template?: string; items?: Item[]; hidden?: string[]; clip?: { shape: string; outside: string } | "NONE" };
type Doc = { courses: { id: string; name: string }[]; event: { paperLayouts?: Record<string, Layout>; paperTemplates?: { id: string; name: string; items: Item[] }[];
  paperValues?: { date?: string; contourInterval?: string } } };

test("banläggning-pappersrum: texter, bilder, skalstock, nordpil, klippning och mallar på papperet", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `papper.${suffix}@exempel.se`, "Petra Papper");
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  await warmRoute(owner, "/api/admin/races/00000000-0000-4000-8000-000000000000/administrator/session");
  const raceId = await createRace(owner, `Pappersrum ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  // Utvecklingsservern stänger ibland en återanvänd anslutning (ECONNRESET): läs om en gång.
  const doc = async (): Promise<Doc> => {
    const read = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Doc } }).setting.document;
    try { return await read(); } catch { return await read(); }
  };
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await warmRoute(owner, `${admin}/course-setting/paper-library`);

  // Kartfil och .ppen (syntetiska).
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });

  // Förhandsvisningen med banan Lång.
  await owner.goto(`/admin/${raceId}/course-setting/print?course=1`);
  const sheet = owner.getByTestId("print-sheet").first();
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  const panel = owner.getByTestId("paper-space");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("paper-course")).toHaveValue("1");
  await expect(sheet.getByTestId("paper-item")).toHaveCount(0);

  // 1. Text: rubrik med variabler, fet, i mitten, vit bakgrund.
  await panel.getByTestId("paper-add-TEXT").click();
  const text = sheet.locator("[data-testid=paper-item][data-kind=TEXT]");
  await expect(text).toHaveCount(1, { timeout: 15_000 });
  const inspector = owner.getByTestId("paper-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByTestId("paper-text").fill("{tävling}\nBana {bana}  {längd}  {skala}");
  await inspector.getByTestId("paper-text").press("Tab");
  await expect(text).toContainText("Bana Lång", { timeout: 15_000 });
  await expect(text).toContainText("Kvällsträning på kartfilen");
  await inspector.getByTestId("paper-align").selectOption("center");
  await inspector.getByTestId("paper-size").fill("5");
  await inspector.getByTestId("paper-size").press("Enter");
  await expect(text.locator("text").first()).toHaveAttribute("text-anchor", "middle", { timeout: 15_000 });
  await expect(text.locator("text").first()).toHaveAttribute("font-size", "5");
  // Datum och ekvidistans för variablerna (hopfällt, ADR-0211 tillägg).
  await expect(panel.getByTestId("paper-values-fold")).not.toHaveAttribute("open", "");
  await panel.getByTestId("paper-values-fold").locator("summary").click();
  await panel.getByTestId("paper-date").fill("9 december 2026");
  await panel.getByTestId("paper-contour").fill("2,5 m");
  await panel.getByTestId("paper-contour").press("Tab");
  await expect.poll(async () => (await doc()).event.paperValues).toEqual({ date: "9 december 2026", contourInterval: "2,5 m" });
  await inspector.getByTestId("paper-variable").selectOption("datum");
  await expect(text).toContainText("9 december 2026", { timeout: 15_000 });
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.items!.find(item => item.kind === "TEXT")!.text)
    .toBe("{tävling}\nBana {bana}  {längd}  {skala} {datum}");
  let saved = await doc();
  const textItem = saved.event.paperLayouts!["1"]!.items!.find(item => item.kind === "TEXT")!;

  // Piltangenten flyttar 1 mm, Skift 5 mm.
  await text.focus();
  await owner.keyboard.press("ArrowRight");
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.items!.find(item => item.id === textItem.id)!.at.x).toBe(textItem.at.x + 1);
  await owner.keyboard.press("Shift+ArrowUp");
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.items!.find(item => item.id === textItem.id)!.at.y).toBe(textItem.at.y + 5);

  // Dra texten på arket: den står kvar där den släpptes.
  const box = (await text.boundingBox())!;
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 80, { steps: 8 });
  await owner.mouse.up();
  await expect.poll(async () => JSON.stringify((await doc()).event.paperLayouts!["1"]!.items!.find(item => item.id === textItem.id)!.at))
    .not.toBe(JSON.stringify({ ...textItem.at, x: textItem.at.x + 1, y: textItem.at.y + 5 }));
  const moved = (await text.boundingBox())!;
  expect(moved.x - box.x).toBeGreaterThan(30);

  // 2. Bilder: PNG och SVG (görs om till PNG), med täckning.
  await panel.getByTestId("paper-image-file").setInputFiles({ name: "logga.png", mimeType: "image/png", buffer: png(60, 30) });
  const logo = sheet.locator("[data-testid=paper-item][data-kind=IMAGE]");
  await expect(logo).toHaveCount(1, { timeout: 30_000 });
  await inspector.getByTestId("paper-opacity").fill("50");
  await inspector.getByTestId("paper-opacity").press("Enter");
  await expect(logo.getByTestId("paper-image")).toHaveAttribute("opacity", "0.5", { timeout: 15_000 });
  // Arket visar den nyss uppladdade bilden ur webbläsarens kopia (ADR-0211 beslut 10); servern har den under sin sha256.
  await expect(logo.getByTestId("paper-image")).toHaveAttribute("href", /^blob:/);
  const imageOf = async () => ((await doc()).event.paperLayouts?.["1"]?.items?.find(item => item.kind === "IMAGE") as unknown as { image?: string } | undefined)?.image;
  await expect.poll(imageOf, { timeout: 15_000 }).toMatch(/^[0-9a-f]{64}$/);
  const fetched = await owner.request.get(`${admin}/course-setting/paper-images/${await imageOf()}`);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()["content-type"]).toBe("image/png");
  await panel.getByTestId("paper-image-file").setInputFiles({ name: "sponsor.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
  await expect(logo).toHaveCount(2, { timeout: 30_000 });
  // Proportionerna låsta: SVG:n 120 × 40 blir tre gånger så bred som hög.
  const sponsor = (await logo.nth(1).getByTestId("paper-image").boundingBox())!;
  expect(sponsor.width / sponsor.height).toBeCloseTo(3, 1);

  // 3. Skalstock och nordpil; Delete tar bort, Ångra tar tillbaka, klick på tomt papper släpper markeringen.
  await panel.getByTestId("paper-add-SCALE_BAR").click();
  await expect(sheet.locator("[data-testid=paper-item][data-kind=SCALE_BAR]")).toContainText(/\d+ m/, { timeout: 15_000 });
  await panel.getByTestId("paper-add-NORTH_ARROW").click();
  const arrow = sheet.locator("[data-testid=paper-item][data-kind=NORTH_ARROW]");
  await expect(arrow).toHaveCount(1, { timeout: 15_000 });
  await arrow.focus();
  await owner.keyboard.press("Delete");
  await expect(arrow).toHaveCount(0, { timeout: 15_000 });
  await panel.getByTestId("paper-undo").click();
  await expect(arrow).toHaveCount(1, { timeout: 15_000 });
  await arrow.click();
  await expect(inspector).toBeVisible();
  await expect(arrow).toHaveAttribute("data-selected", "");
  await shot(owner, "01-papperet-element", sheet);
  await shot(owner, "02-papperet-panel", panel);
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(inspector).toBeVisible();
  // Telefonen: fälten i ett ark nere på skärmen.
  const sheetBox = (await inspector.boundingBox())!;
  expect(sheetBox.y + sheetBox.height).toBeGreaterThan(800);
  if (shots) await owner.screenshot({ path: `${shots}/03-papperet-telefon-390.png` });
  await owner.setViewportSize({ width: 1280, height: 720 });
  await sheet.scrollIntoViewIfNeeded();
  const sheetArea = (await sheet.boundingBox())!;
  await owner.mouse.click(sheetArea.x + sheetArea.width * 0.5, sheetArea.y + sheetArea.height * 0.5);
  await expect(inspector).toHaveCount(0);

  // 4. Klippning (hopfälld): rektangel, tonad karta utanför.
  await panel.getByTestId("paper-clip-fold").locator("summary").click();
  await panel.getByTestId("paper-clip-RECT").check();
  await expect(sheet.getByTestId("paper-clip-handles")).toBeVisible({ timeout: 15_000 });
  await panel.getByTestId("paper-clip-outside").selectOption("FADED");
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.clip).toMatchObject({ shape: "RECT", outside: "FADED" });
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await shot(owner, "04-papperet-klippning", sheet);

  // 4b. Ägaren 2026-11-03: markeringar (förbjudet område, vätska) utanför utsnittet syns inte, ett område som delvis ligger
  // innanför klipps vid kanten; banan står hel. "Visa markeringar utanför utsnittet" visar allt.
  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { version: number } };
  const csrf = (await owner.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
  const added = await owner.request.post(`${admin}/course-setting/edits`, { headers: { origin: new URL(owner.url()).origin, "x-otid-csrf": csrf },
    data: { formatVersion: 1, requestId: crypto.randomUUID(), baseVersion: state.setting.version, edits: [
      { type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 40, y: 10 }, { x: 95, y: 10 }, { x: 95, y: 45 }, { x: 40, y: 45 }] } },
      { type: "ADD_SPECIAL", special: { kind: "water", points: [{ x: 90, y: 40 }] } }] } });
  expect(added.status()).toBe(200);
  await owner.reload();
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  // Utsnittet mindre: 80 × 60 mm uppe till vänster i ramen.
  for (const [key, value] of [["width", "80"], ["height", "60"]] as const) {
    await panel.getByTestId(`paper-clip-${key}`).fill(value);
    await panel.getByTestId(`paper-clip-${key}`).press("Enter");
  }
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.clip).toMatchObject({ rect: { width: 80, height: 60 } });
  const frame = sheet.getByTestId("print-frame").first();
  await expect(frame).toHaveAttribute("data-marking-clip", "", { timeout: 15_000 });
  await expect(frame.getByTestId("print-marking-clipped").first()).toBeAttached();
  const courseParts = await frame.locator("[data-role=CONTROL], [data-role=START], [data-role=FINISH], [data-role=LEG]").count();
  expect(courseParts).toBeGreaterThan(3);
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await shot(owner, "06-papperet-markeringar-dolda", sheet);
  await panel.getByTestId("paper-clip-markings").check();
  await expect(frame).not.toHaveAttribute("data-marking-clip", "", { timeout: 15_000 });
  await expect(frame.getByTestId("print-marking-clipped")).toHaveCount(0);
  expect(await frame.locator("[data-role=CONTROL], [data-role=START], [data-role=FINISH], [data-role=LEG]").count()).toBe(courseParts);
  await shot(owner, "06-papperet-markeringar-visas", sheet);
  await panel.getByTestId("paper-clip-markings").uncheck();
  await expect(frame).toHaveAttribute("data-marking-clip", "", { timeout: 15_000 });
  // Flera sidor: texten på alla sidor.
  await text.click();
  await owner.getByTestId("paper-inspector").getByTestId("paper-pages").selectOption("ALL");
  await expect.poll(async () => (await doc()).event.paperLayouts!["1"]!.items!.find(item => item.kind === "TEXT")!.pages).toBe("ALL");
  await shot(owner, "06-papperet-alla-sidor", owner.getByTestId("paper-inspector"));
  await owner.getByTestId("paper-deselect").click();
  await expect(owner.getByTestId("paper-inspector")).toHaveCount(0);

  // 5. Mall: banans papper som "Klubbens träningsmall", på alla valda banor; biblioteket.
  await panel.getByTestId("paper-clip-edit").uncheck();
  await panel.getByTestId("paper-template-name").fill("Klubbens träningsmall");
  await panel.getByTestId("paper-template-save").click();
  await expect(panel.getByTestId("paper-template")).toHaveValue(/^t/, { timeout: 15_000 });
  await expect(panel.getByTestId("paper-item-row").first()).toHaveAttribute("data-source", "TEMPLATE");
  await expect.poll(async () => (await doc()).event.paperLayouts?.["1"]?.template ?? "").toMatch(/^t/);
  saved = await doc();
  const template = saved.event.paperTemplates!.find(row => row.name === "Klubbens träningsmall")!;
  expect(template.items.map(item => item.kind).sort()).toEqual(["IMAGE", "IMAGE", "NORTH_ARROW", "SCALE_BAR", "TEXT"]);
  expect(saved.event.paperLayouts!["1"]!.template).toBe(template.id);
  // Alla banor i förhandsvisningen och mallen på alla.
  await owner.goto(`/admin/${raceId}/course-setting/print`);
  await expect(owner.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await expect(panel.getByTestId("paper-course")).toHaveValue("1");
  await panel.getByTestId("paper-template-apply-all").click();
  await expect.poll(async () => Object.values((await doc()).event.paperLayouts ?? {}).filter(layout => layout.template === template.id).length)
    .toBe(saved.courses.length + 0);
  const other = saved.courses.find(row => row.id !== "1")!;
  const otherText = owner.locator(`[data-testid=print-sheet][data-course="${other.id}"] [data-testid=paper-item][data-kind=TEXT]`).first();
  await expect(otherText).toContainText(`Bana ${other.name}`, { timeout: 30_000 });
  // En bana ändrar mallens text för sig: bara den banan.
  await otherText.click();
  await expect(panel.getByTestId("paper-course")).toHaveValue(other.id);
  await owner.getByTestId("paper-inspector").getByTestId("paper-bold").uncheck();
  await expect(panel.locator(`[data-testid=paper-item-row][data-id="${textItem.id}"]`)).toHaveAttribute("data-source", "OVERRIDE", { timeout: 15_000 });
  await owner.getByTestId("paper-reset").click();
  await expect(panel.locator(`[data-testid=paper-item-row][data-id="${textItem.id}"]`)).toHaveAttribute("data-source", "TEMPLATE", { timeout: 15_000 });
  await panel.getByTestId("paper-template-to-library").click();
  await panel.getByTestId("paper-library-fold").locator("summary").click();
  await expect(panel.getByTestId("paper-library-note")).toHaveText("Sparad i biblioteket.", { timeout: 15_000 });
  await expect(panel.getByTestId("paper-library-row")).toContainText("Klubbens träningsmall");
  await reviewScreenshots(owner, "05-papperet-mall-hela-sidan");

  // 6. Editorn ("model space") visar inget av papperet; .ppen har Purple Pens textobjekt och bildobjekt.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByTestId("paper-item")).toHaveCount(0);
  await owner.getByRole("button", { name: /^Fil/ }).click();
  await owner.getByRole("menuitem", { name: "Fil och versioner …" }).click();
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Ladda ned .ppen" }).click();
  const ppen = await readFile(await (await downloadPromise).path(), "utf8");
  expect(ppen).toMatch(/kind="text"[\s\S]*\$\(EventTitle\)[\s\S]*Bana \$\(CourseName\)/);
  expect(ppen).toContain('kind="image"');
  expect(ppen).toContain('kind="descriptions"');
});
