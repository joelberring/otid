import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { syntheticCourseData, syntheticMap, syntheticPpen } from "../../packages/club-archive/test/synthetic-archive";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0204: importen till klubbarkivet i webbläsaren. Ägaren väljer en mapp (syntetisk: en påhittad karta, en .ppen, en
 * CourseData och en påhittad PDF), förhandsgranskar (PDF:en står bland det som inte skickas och skickas aldrig), importerar,
 * en omkörning importerar inget nytt, och årsmappen vald för sig ger samma träning. Mappen byggs när testet körs ur repots
 * påhittade testfiler.
 */
test("klubbarkiv: importen i webbläsaren – välj mapp, förhandsgranska, importera, kör igen", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const dir = mkdtempSync(join(tmpdir(), "otid-webbimport-"));
  // ASCII i mappens namn: Playwrights uppladdning av en mapp fastnar på "ä" i rotmappens namn (webbläsaren klarar det).
  const root = join(dir, "Klubbtraningar");
  const pdfMarker = `påhittad resultatlista ${suffix}`;
  const files: Record<string, Uint8Array> = {
    "2021/03-14 Skogen [Kim]/Skogen.omap": syntheticMap(0),
    "2021/03-14 Skogen [Kim]/Skogen mars.ppen": syntheticPpen("C:\\OL\\Skogen.omap", "Mars"),
    "2021/03-14 Skogen [Kim]/Banor.xml": syntheticCourseData(),
    "2021/03-14 Skogen [Kim]/Resultat.pdf": new TextEncoder().encode(`%PDF-1.4\n% ${pdfMarker}\n`)
  };
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  }
  try {
    const owner = await registerAccount(browser, `webbimport.${suffix}@exempel.se`, "Joel Ägare");
    for (const path of ["/api/organizer/clubs", "/organizer/clubs/00000000-0000-4000-8000-000000000000"]) await warmRoute(owner, path);
    // Inget som skickas får innehålla PDF:en (ADR-0204: filer som importen inte tar lämnar aldrig datorn).
    const bodies: string[] = [];
    owner.on("request", request => { const body = request.postDataBuffer(); if (body) bodies.push(body.toString("utf8")); });

    await owner.goto("/organizer");
    const clubs = owner.getByRole("region", { name: "Mina klubbar" });
    await clubs.getByText("Ny klubb", { exact: true }).click();
    await clubs.getByLabel("Klubbens namn").fill(`OK Webbimport ${suffix}`);
    await clubs.getByRole("button", { name: "Skapa klubben" }).click();
    await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
    const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
    for (const path of ["check", "batch"]) await warmRoute(owner, `/api/organizer/clubs/${clubId}/import/${path}`, "POST");
    await warmRoute(owner, `/api/organizer/clubs/${clubId}/import/content/${"0".repeat(64)}`, "PUT");

    await owner.getByRole("tab", { name: "Import" }).click();
    await expect(owner.getByRole("heading", { name: "Importera klubbens gamla träningar" })).toBeVisible();
    // Kommandot ligger hopfällt under importen i webbläsaren.
    await expect(owner.getByText("För den som kan Git: kommandoraden")).toBeVisible();
    await expect(owner.getByRole("button", { name: "Skapa importnyckel" })).toBeHidden();

    await owner.getByLabel("Välj mapp").setInputFiles(root);
    await expect(owner.getByTestId("import-chosen")).toHaveText("Mappen Klubbtraningar (4 filer)");
    await owner.getByRole("button", { name: "Förhandsgranska" }).click();
    const preview = owner.getByTestId("import-preview");
    await expect(preview).toContainText("Förhandsgranskning – inget är skickat än");
    await expect(preview).toContainText("1 träning hittades. Alla är nya.");
    await expect(preview).toContainText("1 – karta och banor i samma mapp");
    await expect(preview).toContainText("1 kartfil i 1 karta");
    await expect(preview).toContainText("1 laddas upp");
    await expect(preview).toContainText("Banfiler: 1 .ppen och 1 CourseData");
    await expect(owner.getByTestId("import-not-sent")).toContainText("1 PDF");
    await owner.getByText("Visa filerna som inte skickas (1)").click();
    await expect(preview.getByText("2021/03-14 Skogen [Kim]/Resultat.pdf")).toBeVisible();
    await reviewScreenshots(owner, "klubbarkiv-webbimport");

    // Förhandsgranskningen skickade bara kontrollfrågan (kartans sha256 och träningens nyckel), inga filer.
    expect(bodies.some(body => body.includes(pdfMarker))).toBe(false);

    await owner.getByRole("button", { name: "Importera", exact: true }).click();
    await expect(owner.getByText("Klart: 1 kartfiler uppladdade (0 fanns redan), 1 nya träningar (0 fanns redan), 2 nya banfiler.")).toBeVisible({ timeout: 60_000 });
    await expect(preview).toContainText("Det finns inget nytt att importera.");
    await expect(owner.getByTestId("club-usage")).toContainText("1 karta (1 version) · 1 träning");

    // Omkörningen (som efter ett avbrott eller en stängd flik) laddar inte upp något igen och gör inga dubbletter.
    await owner.getByRole("button", { name: "Importera igen" }).click();
    await expect(owner.getByText("Klart: 0 kartfiler uppladdade (1 fanns redan), 0 nya träningar (1 fanns redan), 0 nya banfiler.")).toBeVisible({ timeout: 60_000 });
    expect(bodies.some(body => body.includes(pdfMarker))).toBe(false);

    // Årsmappen själv kan väljas (ADR-0204, ändring): året följer med, så det är samma träning och inget nytt.
    await owner.getByRole("button", { name: "Välj andra filer" }).click();
    await owner.getByLabel("Välj mapp").setInputFiles(join(root, "2021"));
    await expect(owner.getByTestId("import-chosen")).toHaveText("Mappen 2021 (4 filer)");
    await owner.getByRole("button", { name: "Förhandsgranska" }).click();
    await expect(preview).toContainText("1 träning hittades. 0 nya, 1 finns redan i arkivet.");
    await expect(preview).toContainText("Det finns inget nytt att importera.");

    await owner.getByRole("tab", { name: "Träningar" }).click();
    const entries = owner.getByTestId("archive-entries").getByRole("listitem");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("Skogen");
    await expect(entries.first()).toContainText("Kim");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
