import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, browserErrors, createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0213: en karta per löpare med kopplingen synlig före utskriften. Syntetiska deltagare (tre i H21 på Lång), kartfil.omap
 * och kartfil.ppen. {namn} {startnummer} placeras på arket (platshållare i banornas förhandsvisning), två löpare väljs (sök
 * på namn och på nummer), baksidan dubbelsidigt i samma PDF, "Kontrollera kopplingen" med sidorna och förhandsvisningen av en
 * rad, PDF:en med fyra sidor i ordningen fram, bak, fram, bak. Skärmbilder i 1280 och 390 px till E2E_SCREENSHOT_DIR (lk-*).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/lk-${name}-${width}.png`, fullPage: width === 390 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${name} i ${width} px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

type Doc = { event: { paperLayouts?: Record<string, { items?: { kind: string; text?: string }[] }> } };

test("löparkartor: variablerna på arket, två valda löpare, baksidan i samma PDF och Kontrollera kopplingen", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `lopar.${suffix}@exempel.se`, "Lisa Löparkarta");
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  await warmRoute(owner, "/api/admin/races/00000000-0000-4000-8000-000000000000/administrator/session");
  const raceId = await createRace(owner, `Löparkartor ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  // Utvecklingsservern kompilerar rutterna vid första anropet: i förväg, så att arbetsytans anrop hinner.
  for (const path of ["courses", "entries", "classes"]) await warmRoute(owner, `${admin}/${path}`);
  for (const path of ["course-classes", "registration", "registration-candidates"]) await warmRoute(owner, `${admin}/${path}`, "POST");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  for (const [givenName, familyName] of [["Ada", "Ek"], ["Bo", "Lind"], ["Cia", "Holm"]] as const) {
    await addEntry(owner, { className: "H21", givenName, familyName, club: "OK Natt", card: String(8000100 + givenName.length + familyName.charCodeAt(0)) });
  }
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await warmRoute(owner, `${admin}/map-bundles`);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
  const doc = async (): Promise<Doc> => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Doc } }).setting.document;

  // 1. Banornas förhandsvisning: {namn} {startnummer} på arket står som platshållare, med en rad om var de fylls i.
  const errors = browserErrors(owner, /\/course-setting\/print$/);
  await owner.goto(`/admin/${raceId}/course-setting/print?course=1`);
  const sheet = owner.getByTestId("print-sheet").first();
  await expect(sheet).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  const panel = owner.getByTestId("paper-space");
  await panel.getByTestId("paper-add-TEXT").click();
  const text = sheet.locator("[data-testid=paper-item][data-kind=TEXT]");
  await expect(text).toHaveCount(1, { timeout: 15_000 });
  await text.locator("rect[fill=transparent]").dblclick();
  const editor = owner.getByTestId("paper-text-editor");
  await editor.getByTestId("paper-text-inplace").fill("");
  await editor.getByTestId("paper-text-inplace-variable").selectOption("namn");
  await editor.getByTestId("paper-text-inplace").press("End");
  await editor.getByTestId("paper-text-inplace").pressSequentially(" ");
  await editor.getByTestId("paper-text-inplace-variable").selectOption("startnummer");
  await editor.getByTestId("paper-text-inplace-done").click();
  await expect.poll(async () => (await doc()).event.paperLayouts?.["1"]?.items?.find(item => item.kind === "TEXT")?.text, { timeout: 30_000 }).toBe("{namn} {startnummer}");
  await expect(text).toContainText("{namn} {startnummer}");
  await expect(owner.getByTestId("paper-runner-hint")).toBeVisible();

  // 2. En karta per löpare: två valda löpare (sök på namn och på startnummer), baksidan dubbelsidigt.
  await owner.getByTestId("print-mode-runners").check();
  await expect(owner.getByTestId("print-runners")).toBeVisible({ timeout: 30_000 });
  await owner.getByTestId("print-back-mode").selectOption("DUPLEX");
  await owner.getByTestId("print-who-RUNNERS").check();
  const search = owner.getByTestId("print-runner-search");
  await search.fill("Lind");
  await owner.getByTestId("print-runner-add").first().click();
  await search.fill("3");
  await expect(owner.getByTestId("print-runner-found")).toContainText("Cia Holm");
  await owner.getByTestId("print-runner-add").first().click();
  await expect(owner.getByTestId("print-runner-chosen").locator("li")).toHaveCount(2);
  await expect(owner.getByTestId("print-runner-selected")).toContainText("2 av 4 kartor");

  // Arken: fram (Bo), bak, fram (Cia), bak; framsidan har löparens namn och nummer.
  const sheets = owner.getByTestId("print-sheet");
  await expect(sheets).toHaveCount(4, { timeout: 60_000 });
  expect(await sheets.evaluateAll(items => items.map(item => item.hasAttribute("data-back") ? "bak" : "fram"))).toEqual(["fram", "bak", "fram", "bak"]);
  await expect(sheets.nth(0).locator("[data-testid=paper-item][data-kind=TEXT]")).toContainText("Bo Lind 2");
  await expect(sheets.nth(2).locator("[data-testid=paper-item][data-kind=TEXT]")).toContainText("Cia Holm 3");
  await expect(sheets.nth(1)).toContainText("Bo Lind");
  await expect(sheets.nth(3)).toContainText("Cia Holm");

  // 3. Kontrollera kopplingen: två rader med PDF-sidorna 1 och 3, ingen varning; ett klick visar arket.
  const check = owner.getByTestId("runner-check");
  const rows = check.getByTestId("runner-check-row");
  await expect(rows).toHaveCount(2);
  expect(await rows.evaluateAll(items => items.map(item => item.getAttribute("data-page")))).toEqual(["1", "3"]);
  await expect(rows.nth(1)).toContainText("Cia Holm");
  await expect(rows.nth(1)).toContainText("H21");
  await expect(rows.nth(1)).toContainText("Lång");
  await expect(check.getByTestId("runner-check-status")).toContainText("Inga varningar.");
  await check.getByTestId("runner-check-sort-name").click();
  await check.getByTestId("runner-check-sort-name").click();
  await expect(rows.first()).toContainText("Cia Holm");
  await check.getByTestId("runner-check-filter").fill("Lind");
  await expect(rows).toHaveCount(1);
  await check.getByTestId("runner-check-filter").fill("");
  await rows.filter({ hasText: "Cia Holm" }).getByTestId("runner-check-preview").click();
  await expect(owner.locator("[id^=print-sheet-][data-open]")).toHaveCount(1);
  await expect(owner.locator("[id^=print-sheet-][data-open]")).toContainText("Cia Holm 3");
  const downloadPromise = owner.waitForEvent("download");
  await check.getByTestId("runner-check-csv").click();
  const csv = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of csv) chunks.push(chunk as Buffer);
  // CSV:en har tabellens rader i tabellens ordning (sorterad på namn, fallande).
  expect(Buffer.concat(chunks).toString("utf8")).toBe("\ufeffPDF-sida;Nr;Namn;Klubb;Klass;Lag/Sträcka;Bana;Variant;Starttid;Varningar\r\n"
    + "3;3;Cia Holm;OK Natt;H21;;Lång;;;\r\n1;2;Bo Lind;OK Natt;H21;;Lång;;;\r\n");
  await shot(owner, "kontrollera");

  // 4. PDF:en för kontorsskrivaren: fyra sidor (fram och bak för två löpare).
  const pdfPanel = owner.getByTestId("print-pdf");
  await pdfPanel.getByTestId("print-pdf-office").click();
  const job = pdfPanel.locator("[data-testid=print-job][data-kind=OFFICE]").first();
  await expect(job).toHaveAttribute("data-status", "DONE", { timeout: 180_000 });
  await expect(job).toContainText(/4 sidor/);
  const href = (await job.getByTestId("print-job-download").getAttribute("href"))!;
  const pdf = Buffer.from(await (await owner.request.get(href)).body()).toString("latin1");
  expect((pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length).toBe(4);
  expect(pdf).toContain("DuplexFlipLongEdge");
  errors.check("utskriftssidan");

  // 5. Kartor till starten länkar till kontrollen.
  await owner.goto(`/admin/${raceId}/maps`);
  await expect(owner.getByTestId("map-bundles-check")).toHaveAttribute("href", `/admin/${raceId}/course-setting/print?mode=runners#runner-check`);

  // 6. Telefonen: urvalet och tabellen i 390 px utan sidledsrullning.
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting/print?mode=runners`);
  await expect(phone.getByTestId("runner-check")).toBeVisible({ timeout: 60_000 });
  await expect(phone.getByTestId("runner-check").getByTestId("runner-check-row")).toHaveCount(4);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  if (shots) await phone.screenshot({ path: `${shots}/lk-telefon-390.png`, fullPage: true });
  await phoneContext.close();
});
