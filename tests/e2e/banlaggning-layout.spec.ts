import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, browserErrors, createRace, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0217: Layout som egen flik. Kartfil.omap och kartfil.ppen (Lång och Mellan) med klasserna H21 (Lång) och H70 (Mellan).
 * Två layouter (Elit A3 1:15 000 och Äldre A4 1:7 500), H21 → Elit och H70 → Äldre (massval och rad), eget utsnitt på ett ark,
 * ett justerat nummer i 1:7 500, spara läge och återställ, och PDF:en med rätt papper och skala per ark (provark, ett av varje).
 * Skärmbilder i 1280 och 390 px till E2E_SCREENSHOT_DIR (layout-*).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const shots = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string, testId: string) {
  if (!shots) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
    await page.evaluate(id => document.querySelector(`[data-testid="${id}"]`)?.scrollIntoView({ block: "start" }), testId);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/layout-${name}-${width}.png`, fullPage: width === 390 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${name} i ${width} px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

type Sheet = { printArea?: { automatic: boolean }; numbers?: Record<string, unknown> };
type Doc = { courses: { id: string; name: string }[]; event: { layouts?: { id: string; name: string; scale: number }[]; classLayouts?: Record<string, string>;
  layoutSheets?: Record<string, Record<string, Sheet>>; layoutStates?: { name: string }[] } };

test("banläggning-layout: två layouter, klassernas layout, utsnitt, justerat nummer, lägen och PDF per ark", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `layout.${suffix}@exempel.se`, "Lena Layout");
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  const raceId = await createRace(owner, `Layout ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["courses", "entries", "classes"]) await warmRoute(owner, `${admin}/${path}`);
  for (const path of ["course-classes", "registration", "registration-candidates"]) await warmRoute(owner, `${admin}/${path}`, "POST");
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addCourseAndClass(owner, "Mellan", "H70", "34 35");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Ek", club: "OK Natt", card: "8000201" });
  await addEntry(owner, { className: "H70", givenName: "Bo", familyName: "Lind", club: "OK Natt", card: "8000202" });
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/layout`);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await warmRoute(owner, `${admin}/map-bundles`);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await expect(owner.getByLabel(/^Kartfil \(/)).toBeAttached({ timeout: 120_000 });
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
  const doc = async (): Promise<Doc> => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Doc } }).setting.document;
  const ids = Object.fromEntries((await doc()).courses.map(course => [course.name, course.id]));
  // Läget "Från Purple Pen" gjordes vid inläsningen.
  expect((await doc()).event.layoutStates?.map(state => state.name)).toEqual(["Från Purple Pen"]);

  // 1. Fliken Layout från banläggningen.
  const errors = browserErrors(owner, /\/course-setting\/layout$/);
  await owner.getByTestId("course-setting-tab-layout").click();
  await expect(owner.getByTestId("layout-page")).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByTestId("course-setting-tab-layout")).toHaveAttribute("aria-current", "page");

  // 2. Två layouter: Äldre A4 1:7 500 och Elit A3 liggande 1:15 000.
  const addLayout = async (name: string, scale: string) => {
    const before = await owner.getByTestId("layout-entry").count();
    await owner.getByTestId("layout-add").click();
    const entry = owner.getByTestId("layout-entry").nth(before);
    await expect(entry).toBeVisible();
    await entry.getByTestId("layout-name").fill(name);
    await entry.getByTestId("layout-name").press("Enter");
    await expect(entry.locator("legend")).toContainText(name);
    await entry.getByTestId("layout-scale").fill(scale);
    await entry.getByTestId("layout-scale").press("Enter");
    await expect(entry.locator("legend")).toContainText(`1:${Number(scale).toLocaleString("sv-SE").replace(/\s/g, " ")}`);
    return entry;
  };
  await addLayout("Äldre A4", "7500");
  const elit = await addLayout("Elit A3", "15000");
  await elit.getByTestId("layout-paper").selectOption("A3");
  await expect.poll(async () => (await doc()).event.layouts?.find(layout => layout.name === "Elit A3")).toMatchObject({ scale: 15000 });
  await elit.getByTestId("layout-orientation").selectOption("landscape");
  const layouts = async () => Object.fromEntries(((await doc()).event.layouts ?? []).map(layout => [layout.name, layout.id]));
  await expect.poll(async () => Object.keys(await layouts())).toEqual(["Äldre A4", "Elit A3"]);
  const { "Äldre A4": old, "Elit A3": elite } = await layouts();

  // 3. Klasserna: H70 → Äldre på raden, H21 → Elit med massval.
  const classes = owner.getByTestId("layout-classes");
  await expect(classes.getByTestId("layout-class-row")).toHaveCount(2, { timeout: 30_000 });
  await classes.locator("[data-testid=layout-class-row][data-class=H70]").getByTestId("layout-class-select").selectOption(old!);
  await classes.getByRole("checkbox", { name: "Markera H21" }).check();
  await classes.getByTestId("layout-classes-target").selectOption(elite!);
  await classes.getByTestId("layout-classes-apply").click();
  await expect.poll(async () => (await doc()).event.classLayouts).toEqual({ H70: old, H21: elite });

  // 4. Överblicken: rutorna för klasserna, med kartor (anmälda + reserver).
  const cell = (course: string, layout: string) => owner.locator(`[data-testid=layout-cell][data-course="${ids[course]}"][data-layout="${layout}"]`);
  await expect(cell("Mellan", old!)).toContainText("H70");
  await expect(cell("Mellan", old!)).toContainText("1:7 500");
  await expect(cell("Lång", elite!)).toContainText("H21");
  await expect(cell("Lång", elite!)).toContainText("A3 liggande");
  await expect(owner.locator(`[data-testid=layout-add-sheet][data-course="${ids.Lång}"][data-layout="${old}"]`)).toBeVisible();
  await shot(owner, "overblick", "layout-overview");

  // 5. Eget utsnitt på arket Lång i Elit A3.
  const mainArea = async () => JSON.stringify(((await doc()) as unknown as { courses: { id: string; printArea?: unknown }[] }).courses.find(course => course.id === ids.Lång)?.printArea);
  const mainBefore = await mainArea();
  await cell("Lång", elite!).click();
  const sheet = owner.getByTestId("layout-sheet");
  await expect(sheet).toHaveAttribute("data-layout", elite!);
  await expect(sheet.getByTestId("layout-sheet-view").first()).toHaveAttribute("data-scale", "15000");
  await sheet.getByTestId("sheet-paper-area-manual").check();
  await expect.poll(async () => (await doc()).event.layoutSheets?.[elite!]?.[ids.Lång!]?.printArea?.automatic).toBe(false);
  await expect(cell("Lång", elite!)).toHaveAttribute("data-status", "OWN_AREA");
  // Huvudlayoutens ark (banans tryckyta) är orört.
  expect(await mainArea()).toBe(mainBefore);

  // 6. Justerat nummer i 1:7 500 (Mellan i Äldre A4): dra numret på arket.
  await cell("Mellan", old!).click();
  await expect(sheet).toHaveAttribute("data-layout", old!);
  await expect(sheet.getByTestId("layout-sheet-view").first()).toHaveAttribute("data-scale", "7500");
  await expect(sheet.getByTestId("layout-adjust-count")).toHaveText("Inga justeringar: allt följer banläggningen.");
  const number = sheet.getByTestId("layout-number").first();
  await number.scrollIntoViewIfNeeded();
  const box = (await number.boundingBox())!;
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 6 });
  await owner.mouse.up();
  await expect.poll(async () => Object.keys((await doc()).event.layoutSheets?.[old!]?.[ids.Mellan!]?.numbers ?? {}).length).toBe(1);
  await expect(sheet.getByTestId("layout-adjust-count")).toHaveText("1 justering i layouten");
  await expect(cell("Mellan", old!)).toContainText("1 justering");
  await shot(owner, "ark", "layout-sheet");

  // 7. Spara läge, ändra en klass, jämför och återställ (och ångra).
  const states = owner.getByTestId("layout-states");
  await states.getByTestId("layout-state-name").fill("Före provtryck");
  await states.getByTestId("layout-state-save").click();
  const saved = states.locator("[data-testid=layout-state][data-state='Före provtryck']");
  await expect(saved).toBeVisible();
  await classes.locator("[data-testid=layout-class-row][data-class=H70]").getByTestId("layout-class-select").selectOption("MAIN");
  await expect.poll(async () => (await doc()).event.classLayouts).toEqual({ H21: elite });
  await saved.getByTestId("layout-state-compare").click();
  await expect(saved.getByTestId("layout-state-differences")).toContainText("H70: Äldre A4 → Huvudlayout");
  owner.once("dialog", dialog => void dialog.accept());
  await saved.getByTestId("layout-state-restore").click();
  await expect.poll(async () => (await doc()).event.classLayouts).toEqual({ H70: old, H21: elite });
  await expect(classes.locator("[data-testid=layout-class-row][data-class=H70]")).toHaveAttribute("data-layout", old!);
  await shot(owner, "klasser", "layout-classes");
  errors.check("layoutfliken");

  // 8. Utskrift: provark (ett av varje ark) med layoutens skala och papper per ark, och PDF:en.
  await owner.getByTestId("course-setting-tab-print").click();
  await expect(owner.getByTestId("print-output")).toBeVisible({ timeout: 60_000 });
  await owner.getByTestId("print-mode-proof").check();
  const sheets = owner.getByTestId("print-sheet");
  await expect(sheets).toHaveCount(4, { timeout: 60_000 });
  const scales = await sheets.evaluateAll(list => list.map(item => item.getAttribute("data-scale")));
  expect(scales.slice(2).sort()).toEqual(["15000", "7500"]);
  await shot(owner, "utskrift", "print-output");
  const panel = owner.getByTestId("print-pdf");
  await panel.getByTestId("print-pdf-office").click();
  const job = panel.locator("[data-testid=print-job][data-kind=OFFICE]").first();
  await expect(job).toHaveAttribute("data-status", "DONE", { timeout: 180_000 });
  const href = (await job.getByTestId("print-job-download").getAttribute("href"))!;
  const pdf = Buffer.from(await (await owner.request.get(href)).body()).toString("latin1");
  expect(pdf.match(/\/Type \/Page\b(?!s)/g)?.length).toBe(4);
  // Elit A3 liggande (1191 × 842 pt) och Äldre A4 stående (595 × 842 pt).
  const boxes = [...pdf.matchAll(/\/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map(match => `${Math.round(Number(match[1]))}x${Math.round(Number(match[2]))}`);
  expect(boxes).toContain("1191x842");
  expect(boxes).toContain("595x842");
});
