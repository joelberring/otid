import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createDatabase } from "@o-tid/database";
import { variantLetters, type CourseSettingDocument } from "../../packages/course-setting/src/index";
import { addEntry, createRace, openStep, registerAccount, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0175, tillägg 2026-11-21 (b): nycklarna i banläggningen. "Natt" (H21) har tre gafflingar (ACE … BDF) och är utkast.
 * Överför, löpare i H21 får varianter (Fördela gafflingar) och banan blir låst. Den sista gafflingen tas bort och görs om
 * (i den låsta banan får den nya bokstäver, G och H), «Ordna nycklarna» med förhandsvisning och bekräftelse ger E och F
 * igen, och Överför igen: ingen löpare får andra kontroller än förut utan att stå i beskedet, och den vars gren togs bort får
 * en ny variant.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function mapReady(page: Page) {
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 20_000 });
}

interface VariantChange { displayName: string; code: string; afterControls: number[] | null; reassigned?: true; codeAfter?: string }

async function transfer(page: Page): Promise<VariantChange[]> {
  await page.getByRole("button", { name: /^Fil/ }).click();
  await page.getByRole("menuitem", { name: "Överför till tävlingen …" }).click();
  const response = page.waitForResponse(row => row.url().endsWith("/course-setting/transfer") && row.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Överför till tävlingen" }).click();
  const body = await (await response).json() as { consequence: { variantChanges?: VariantChange[] } };
  const review = page.getByRole("region", { name: /Banläggningen, version \d+/ });
  await review.getByRole("button", { name: /^Godkänn \d+ ändring/ }).click();
  await expect(page.getByText(/ändring/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  return body.consequence.variantChanges ?? [];
}

test("banläggning-nycklar: utkast, Överför, Fördela gafflingar, gör om en gaffling, Ordna nycklarna, Överför igen", async ({ browser }) => {
  test.setTimeout(400_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `nycklar.${suffix}@exempel.se`, "Nora Nyckel");
  const raceId = await createRace(owner, `Nycklar ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `${admin}/course-setting/fork-letters`);
  const { db: _db, pool } = createDatabase(process.env.E2E_DATABASE_URL!);
  try {
    const courseRow = (page: Page, name: string) => page.getByTestId("course-setting-course")
      .filter({ has: page.locator("strong").getByText(name, { exact: true }) });

    await owner.goto(`/admin/${raceId}/course-setting`);
    await owner.waitForLoadState("networkidle");
    await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
    await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
    await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
    await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/gaffling-urval.ppen"));
    await owner.getByRole("button", { name: "Läs in .ppen" }).click();
    await courseRow(owner, "Natt").click();
    await mapReady(owner);
    const panel = owner.getByTestId("course-setting-fork-letters");
    await expect(panel.getByTestId("course-setting-fork-letters-state")).toContainText("Utkast: nycklarna ordnas medan du arbetar");

    // Överför: H21 får Natt med åtta varianter.
    expect(await transfer(owner)).toEqual([]);

    // Fyra löpare i H21 och Fördela gafflingar (de som saknar variant får en).
    await owner.goto(`/admin/${raceId}/manage`);
    for (const [index, given] of ["Ada", "Bo", "Cia", "Dan"].entries()) {
      await addEntry(owner, { className: "H21", givenName: given, familyName: "Nyckel", club: "OK Natt", card: String(8_201_001 + index) });
    }
    await openStep(owner, "Klasser");
    const h21 = owner.getByRole("row", { name: /^H21/ });
    const distribute = h21.getByRole("button", { name: "Fördela gafflingar i H21" });
    if (await distribute.count() > 0 && await distribute.isEnabled()) {
      await distribute.click();
      await expect(owner.getByText(/löpare fick en variant/)).toBeVisible();
    }
    await expect(owner.getByRole("row", { name: /^H21/ })).not.toContainText("saknar variant");

    const controlsOf = async () => new Map((await pool.query<{ name: string; code: string; codes: number[] }>(`select e.given_name as name, e.course_variant_code as code,
      array_agg(ct.code order by cvc.sequence) as codes from entry e join class cl on cl.id = e.class_id
      join course_variant cv on cv.course_version_id = cl.course_version_id and cv.code = e.course_variant_code
      join course_variant_control cvc on cvc.course_variant_id = cv.id join control ct on ct.id = cvc.control_id
      where e.race_id = $1 group by e.given_name, e.course_variant_code`, [raceId])).rows.map(row => [row.name, row]));
    const before = await controlsOf();
    expect([...before.keys()].sort()).toEqual(["Ada", "Bo", "Cia", "Dan"]);

    // Tillbaka i banläggningen: banan är låst (löparna har varianter).
    await owner.goto(`/admin/${raceId}/course-setting`);
    await mapReady(owner);
    await courseRow(owner, "Natt").click();
    await expect(panel.getByTestId("course-setting-fork-letters-state")).toContainText("Låst: löpare har fått varianter i tävlingen");

    // Den sista gafflingen (E | F) tas bort och görs om, som en annan i banläggningen gör (åtgärder mot servern).
    const csrf = (await owner.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
    const headers = { origin: new URL(owner.url()).origin, "x-otid-csrf": csrf, "content-type": "application/json" };
    const state = async () => (await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { version: number; document: CourseSettingDocument } };
    const edits = async (list: unknown[]) => {
      const current = await state();
      const response = await owner.request.post(`${admin}/course-setting/edits`, { headers,
        data: { formatVersion: 1, requestId: randomUUID(), baseVersion: current.setting.version, edits: list } });
      expect(response.status()).toBe(200);
      expect(((await response.json()) as { rejected: unknown[] }).rejected).toEqual([]);
    };
    let document = (await state()).setting.document;
    const natt = document.courses.find(course => course.name === "Natt")!.id;
    const branchOf = (letter: string) => [...variantLetters(document, natt)].find(([, value]) => value === letter)![0];
    const keep = branchOf("E");
    await edits([{ type: "REMOVE_COURSE_CONTROL", course: natt, courseControl: branchOf("F") }]);
    document = (await state()).setting.document;
    expect([...variantLetters(document, natt).values()]).toEqual(["A", "B", "C", "D"]);
    await edits([{ type: "ADD_SPLIT", course: natt, at: keep, kind: "FORK", branches: 2 }]);
    document = (await state()).setting.document;
    // Låst: den omgjorda gafflingen får nya bokstäver.
    expect([...variantLetters(document, natt).values()]).toEqual(["A", "B", "C", "D", "G", "H"]);

    // «Ordna nycklarna»: förhandsvisning gammal → ny kod, bekräftelse med det som berörs (löparna med namn).
    await owner.reload();
    await mapReady(owner);
    await courseRow(owner, "Natt").click();
    await panel.getByTestId("course-setting-fork-letters-renumber").click();
    const preview = panel.getByTestId("course-setting-fork-letters-preview");
    await expect(preview.getByTestId("course-setting-fork-letters-row").filter({ hasText: "ACG" })).toContainText("ACE");
    await expect(preview.getByTestId("course-setting-fork-letters-affected")).toContainText("4 löpare med tilldelad variant");
    await expect(preview.getByTestId("course-setting-fork-letters-affected")).toContainText("Ada Nyckel");
    await preview.getByTestId("course-setting-fork-letters-apply").click();
    await saved(owner);
    document = (await state()).setting.document;
    expect([...variantLetters(document, natt).values()]).toEqual(["A", "B", "C", "D", "E", "F"]);
    await expect(panel.getByTestId("course-setting-fork-letters-state")).toContainText("Låst");

    // Överför igen: bara de vars gren (F) togs bort står i beskedet och får en ny variant; ingen får andra kontroller tyst.
    const changes = await transfer(owner);
    for (const change of changes) expect(change).toMatchObject({ afterControls: null, reassigned: true });
    const lost = new Set(changes.map(change => change.displayName.split(" ")[0]!));
    for (const [name, row] of before) expect(lost.has(name)).toBe(row.code.endsWith("F"));
    const after = await controlsOf();
    for (const [name, row] of before) {
      if (lost.has(name)) continue;
      expect(after.get(name), name).toEqual(row);
    }
  } finally {
    await pool.end();
  }
});
