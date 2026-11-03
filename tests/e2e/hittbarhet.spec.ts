import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addPerson, createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * Ägarens synpunkter 2026-11-03 (hittbarhet): banläggningen i arbetsytans sidopanel och meny, i Mina tävlingar och för den
 * som bara har banläggningen; kontrollbeskrivningen på kartan som en del av papperet i förhandsvisningen (automatiskt hörn,
 * dra, spara, ladda om); BL-förslagets val som syns, sparas och kan ångras; kepsens förklaring som inte ligger över banan.
 * Skärmbilder i 1280 och 390 px till E2E_SCREENSHOT_DIR.
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

const saved = (page: Page) => expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 15_000 });

/** Förhandsvisningen med bara en bana (`?course=` väljer den, som länken från editorns Utskrift). */
async function printOnly(page: Page, raceId: string, course: string) {
  await page.goto(`/admin/${raceId}/course-setting/print?course=${course}`);
  await expect(page.getByRole("checkbox", { name: "Alla", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
}

/** Rutor som skär varandra (skärmens px). */
const intersects = (a: DOMRect | { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("hittbarhet: banläggningen i navigeringen, beskrivningen på papperet, BL-valen och kepsens förklaring", async ({ browser }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `hitta.${suffix}@exempel.se`, "Hanna Hittar");
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/manage");
  await warmRoute(owner, "/api/admin/races/00000000-0000-4000-8000-000000000000/administrator/session");
  const raceId = await createRace(owner, `Hittbarhet ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);

  // Kartfil och .ppen (syntetiska).
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
  // Tillbaka är tydligt: pilen och "Tävlingen".
  await expect(owner.getByTestId("course-setting-back")).toHaveText("← Tävlingen");

  // 1. Arbetsytan: Banläggning i sidopanelen (dator) och i remsan och Meny (telefon).
  await owner.goto(`/admin/${raceId}/manage`);
  const nav = owner.getByTestId("nav-course-setting");
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav).toContainText("Banläggning");
  await expect(nav).toHaveAttribute("href", `/admin/${raceId}/course-setting`);
  await shot(owner, "01-arbetsyta-banlaggning");
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeVisible();
  await owner.getByText("Meny", { exact: true }).click();
  await expect(owner.getByTestId("menu-course-setting")).toBeVisible();
  await owner.setViewportSize({ width: 1280, height: 720 });
  await owner.reload();
  await owner.getByTestId("nav-course-setting").click();
  await owner.waitForURL(new RegExp(`/admin/${raceId}/course-setting$`));
  await owner.getByTestId("course-setting-back").click();
  await owner.waitForURL(new RegExp(`/admin/${raceId}/manage$`));

  // Banläggaren med bara "föreslå": Banläggning i Mina tävlingar, och arbetsytans adress leder till banläggningen.
  const setterEmail = `banlaggare.${suffix}@exempel.se`;
  const setter = await registerAccount(browser, setterEmail, "Bo Banläggare");
  await addPerson(owner, setterEmail, "Banläggning: föreslå");
  await setter.reload();
  await expect(setter.getByText(`Hittbarhet ${suffix}`)).toBeVisible();
  await expect(setter.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(0);
  await expect(setter.getByRole("button", { name: "Banläggning", exact: true })).toBeVisible();
  await shot(setter, "02-mina-tavlingar-banlaggare");
  await setter.goto(`/admin/${raceId}/manage`);
  await setter.waitForURL(new RegExp(`/admin/${raceId}/course-setting$`), { timeout: 30_000 });
  await expect(setter.getByTestId("course-setting-back")).toHaveText("← Mina tävlingar", { timeout: 30_000 });
  await setter.context().close();
  // Ägaren har Banläggning direkt i Mina tävlingar.
  await owner.goto("/organizer");
  await expect(owner.getByRole("button", { name: "Banläggning", exact: true })).toBeVisible({ timeout: 30_000 });

  // 2. Kontrollbeskrivningen på papperet: på från början, automatiskt i ett fritt hörn, dras och sparas.
  await printOnly(owner, raceId, "1");
  const sheet = owner.getByTestId("print-sheet").first();
  const description = sheet.getByTestId("print-description");
  await expect(description).toHaveCount(1);
  await expect(description).toHaveAttribute("data-source", "AUTO");
  const row = owner.getByTestId("paper-descriptions").getByTestId("paper-description-row").filter({ hasText: "Lång" });
  await expect(row.getByRole("checkbox", { name: "Kontrollbeskrivning på kartan för Lång" })).toBeChecked();
  await expect(row.getByTestId("paper-description-source")).toContainText("Automatiskt i");
  await shot(owner, "03-utskrift-beskrivning-auto", sheet);
  await description.scrollIntoViewIfNeeded();
  const box = (await description.locator("rect").first().boundingBox())!;
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 60, { steps: 6 });
  await owner.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 120, { steps: 6 });
  await owner.mouse.up();
  await expect(description).toHaveAttribute("data-source", "PLACED", { timeout: 15_000 });
  const placed = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: { event: {
    paperLayouts?: Record<string, { descriptions?: { at?: { corner: string; x: number; y: number } } }> } } } };
  const at = placed.setting.document.event.paperLayouts?.["1"]?.descriptions?.at;
  expect(at).toBeDefined();
  // Läget på arket (relativt arket, sidan kan vara skrollad olika).
  const onSheet = async () => {
    const [item, page] = [(await description.locator("rect").first().boundingBox())!, (await sheet.boundingBox())!];
    return { x: item.x - page.x, y: item.y - page.y };
  };
  const moved = await onSheet();
  expect(moved.x - (box.x - (await sheet.boundingBox())!.x)).toBeGreaterThan(40);
  // Efter omladdning står den kvar där den släpptes.
  await printOnly(owner, raceId, "1");
  await expect(description).toHaveAttribute("data-source", "PLACED");
  const reloaded = await onSheet();
  expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(3);
  expect(Math.abs(reloaded.y - moved.y)).toBeLessThan(3);
  await shot(owner, "04-utskrift-beskrivning-utplacerad", sheet);
  // Av och på igen; "Automatiskt igen" tar bort platsen.
  // Rutan sparas först (kryssrutan visar det som är sparat), därför klick och sedan vänta.
  const toggleShown = row.getByRole("checkbox", { name: "Kontrollbeskrivning på kartan för Lång" });
  await toggleShown.click();
  await expect(description).toHaveCount(0, { timeout: 15_000 });
  await expect(toggleShown).not.toBeChecked();
  await toggleShown.click();
  await expect(description).toHaveAttribute("data-source", "PLACED", { timeout: 15_000 });
  await row.getByRole("button", { name: "Automatiskt igen" }).click();
  await expect(description).toHaveAttribute("data-source", "AUTO", { timeout: 15_000 });
  await shot(owner, "05-utskrift-panel", owner.getByTestId("paper-descriptions"));

  // 3. BL-förslaget: Godta syns som nedtryckt "✓ Godtagen" med ett besked vid raden, sparas (omladdning) och kan ångras.
  await owner.getByTestId("print-profile-select").selectOption({ label: "BL skog" });
  const proposal = owner.getByTestId("bl-proposal");
  await expect(proposal).toBeVisible({ timeout: 30_000 });
  const blue = proposal.locator("[data-testid=bl-row][data-confidence=CONFIRM]").first();
  const color = await blue.getAttribute("data-color");
  await expect(blue.getByTestId("bl-status")).toHaveText("○ Inte godkänd");
  await blue.getByTestId("bl-accept").click();
  await expect(blue.getByTestId("bl-accept")).toHaveText("✓ Godtagen", { timeout: 30_000 });
  await expect(blue.getByTestId("bl-accept")).toHaveAttribute("aria-pressed", "true");
  await expect(blue.getByTestId("bl-flash")).toContainText("Godkänd och sparad.");
  await expect(blue.getByTestId("bl-status")).toHaveText("✓ Godkänd");
  // Samma knapp igen: inget händer tyst, beskedet säger att det redan gäller.
  await blue.getByTestId("bl-accept").click();
  await expect(blue.getByTestId("bl-flash")).toContainText("Det valet gäller redan");
  await shot(owner, "06-bl-godtagen", blue);
  await owner.reload();
  const again = owner.getByTestId("bl-proposal").locator(`[data-testid=bl-row][data-color="${color}"]`);
  await expect(again).toHaveAttribute("data-status", "ACCEPTED", { timeout: 60_000 });
  await expect(again.getByTestId("bl-accept")).toHaveAttribute("aria-pressed", "true");
  await again.getByTestId("bl-undo").click();
  await expect(again).toHaveAttribute("data-status", "PENDING", { timeout: 30_000 });
  await expect(again.getByTestId("bl-accept")).toHaveAttribute("aria-pressed", "false");
  await owner.reload();
  await expect(owner.getByTestId("bl-proposal").locator(`[data-testid=bl-row][data-color="${color}"]`)).toHaveAttribute("data-status", "PENDING",
    { timeout: 60_000 });
  // Tillbaka till "som i filen" så att kepsens ark nedan har vanliga färger.
  await owner.getByTestId("print-profile-select").selectOption({ index: 0 });

  // 4. Keps på Lång (A och B): förklaringen står under banan, aldrig över mål, kontroller, nummer eller sträckor.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByTestId("course-setting-view").selectOption({ label: "Lång" });
  await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
  await owner.getByTestId("course-setting-training-tool").click();
  const panel = owner.getByTestId("course-setting-training");
  await panel.getByTestId("training-add-PAIRS").click();
  await panel.getByTestId("training-pairs-make").click();
  await saved(owner);
  await panel.getByTestId("training-pairs").getByRole("button", { name: "En karta för löpare A och en för B" }).click();
  await saved(owner);
  await printOnly(owner, raceId, "1");
  await expect(owner.getByTestId("print-sheet")).toHaveCount(2, { timeout: 30_000 });
  for (const index of [0, 1]) {
    const keps = owner.getByTestId("print-sheet").nth(index);
    const legend = keps.locator("[data-ref=pairs-legend]");
    await expect(legend).toHaveCount(1);
    const legendBox = (await legend.boundingBox())!;
    const symbols = keps.locator("[data-role=START], [data-role=CONTROL], [data-role=FINISH], [data-role=NUMBER], [data-role=LEG]");
    const boxes = await symbols.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, role: element.getAttribute("data-role") };
    }));
    expect(boxes.length).toBeGreaterThan(3);
    for (const symbol of boxes) expect(intersects(legendBox, symbol), `${symbol.role} under förklaringen`).toBe(false);
  }
  await shot(owner, "07-keps-a", owner.getByTestId("print-sheet").first());
  await reviewScreenshots(owner, "08-utskrift-hela-sidan");
});
