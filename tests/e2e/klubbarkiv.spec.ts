import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { syntheticYearZips } from "../../packages/club-archive/test/synthetic-archive";
import { registerAccount, reviewScreenshots, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * ADR-0194: klubbarkivet. Ägaren skapar klubben och en importnyckel, provkör importkommandot (inget skickas) och importerar
 * två syntetiska år (fyra träningar, en karta som delas, en ny kartversion och en mapp med bara PDF) från "sin dator"
 * (kommandot i repot), bläddrar och filtrerar, ser banan på kartan, bjuder in en läsare, och läsaren använder en träning igen.
 * Zip-filerna byggs när testet körs ur repots påhittade testkartor.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));

function archiveImport(args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync("pnpm", ["--silent", "archive-import", ...args], { cwd: root, encoding: "utf8", timeout: 180_000,
    env: { ...process.env, ...env, INIT_CWD: root } });
}

test("klubbarkiv: provkörning, import, bläddra, bjud in en läsare och Använd igen", async ({ browser, baseURL }) => {
  test.setTimeout(720_000);
  const suffix = unique();
  const dir = mkdtempSync(join(tmpdir(), "otid-klubbarkiv-"));
  try {
    for (const zip of syntheticYearZips()) writeFileSync(join(dir, zip.name), zip.data);
    const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Joel Ägare");
    for (const path of ["/api/organizer/clubs", "/organizer/clubs/00000000-0000-4000-8000-000000000000"]) await warmRoute(owner, path);

    // Mina tävlingar → Mina klubbar → Ny klubb.
    await owner.goto("/organizer");
    const clubs = owner.getByRole("region", { name: "Mina klubbar" });
    // Ägaren 2026-11-04: utan klubbar och grupper en rad i remsan överst, men inte när klubbfrågan redan står ovanför
    // (användartest 2026-11-12).
    await expect(owner.getByTestId("club-step")).toBeVisible();
    await expect(owner.getByTestId("my-places")).not.toContainText("Välj din klubb under Mitt konto");
    await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
    await clubs.getByLabel("Klubbens namn").fill(`OK Älvsjö-Örby ${suffix}`);
    await clubs.getByRole("button", { name: "Skapa klubben" }).click();
    await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
    const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
    await expect(owner.getByRole("heading", { name: `OK Älvsjö-Örby ${suffix}`, level: 1 })).toBeVisible();
    await expect(owner.getByText("Arkivet är tomt")).toBeVisible();

    // Provkörningen på "datorn": rapporten, inget skickat.
    const reportPath = join(dir, "rapport.txt");
    const dry = archiveImport([dir, "--dry-run", "--rapport", reportPath]);
    expect(dry).toContain("Träningar: 4");
    expect(dry).toMatch(/1\s+bara banor, kartan hittad i en annan mapp/);
    expect(dry).toMatch(/1\s+mappar utan kartor och banor/);
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("provkörning (--dry-run), inget skickat");
    expect(report).toContain("2020/10-10 Klubbmöte");

    // Importnyckeln (visas en gång) och den riktiga importen.
    await owner.getByRole("tab", { name: "Import" }).click();
    // ADR-0204: kommandot och nyckeln ligger hopfällda under importen i webbläsaren.
    await owner.getByText("För den som kan Git: kommandoraden").click();
    // Kommandot kan klistras in som det står: ingen klubb (den följer av nyckeln) och inga <platshållare>.
    await expect(owner.getByTestId("import-command")).toHaveText(`pnpm archive-import ~/Downloads/Klubbträningar --server ${new URL(baseURL!).origin}`);
    await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
    const token = (await owner.getByTestId("import-token").textContent())!.trim();
    expect(token).toMatch(/^otid-imp-/);
    await reviewScreenshots(owner, "klubbarkiv-import");
    const tls = baseURL?.startsWith("https://") ? { NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {};
    // Fel klubb i --club: tydligt besked med klubbens namn, inget skickat.
    expect(() => archiveImport([dir, "--server", baseURL!, "--club", "00000000-0000-4000-8000-000000000000", "--rapport", join(dir, "fel.txt")],
      { OTID_IMPORT_TOKEN: token, ...tls })).toThrow(`Importnyckeln hör till klubben OK Älvsjö-Örby ${suffix}, inte till id 00000000-0000-4000-8000-000000000000`);
    const imported = archiveImport([dir, "--server", baseURL!, "--rapport", join(dir, "import.txt")],
      { OTID_IMPORT_TOKEN: token, ...tls });
    expect(imported).toContain(`Klubb: OK Älvsjö-Örby ${suffix}`);
    expect(imported).toContain("Klart: 3 kartfiler uppladdade (0 fanns redan), 4 nya träningar");
    // Omkörning: inget laddas upp igen, inga dubbletter.
    const again = archiveImport([dir, "--server", baseURL!, "--club", clubId, "--rapport", join(dir, "import2.txt")], { OTID_IMPORT_TOKEN: token, ...tls });
    expect(again).toContain("Klart: 0 kartfiler uppladdade (3 fanns redan), 0 nya träningar (4 fanns redan)");

    // Bläddra och filtrera.
    await owner.reload();
    await owner.getByRole("tab", { name: "Träningar" }).click();
    const entries = owner.getByTestId("archive-entries").getByRole("listitem");
    await expect(entries).toHaveCount(4);
    await expect(owner.getByTestId("club-usage")).toContainText("2 kartor (3 versioner) · 4 träningar");
    // ADR-0222: egna ord, moment och nivåer väljs som knappar (flera samtidigt).
    await owner.getByTestId("archive-moment-filters").getByRole("button", { name: "Keps" }).click();
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("Ängen");
    await expect(entries.first()).toContainText("Banor, kartan från annan träning");
    await owner.getByRole("button", { name: "Rensa" }).click();
    await owner.getByLabel("Sök").fill("parken");
    await expect(entries).toHaveCount(1);
    await owner.getByRole("button", { name: "Rensa" }).click();
    await owner.getByLabel("År").selectOption("2019");
    await expect(entries).toHaveCount(2);
    await owner.getByRole("button", { name: "Rensa" }).click();
    await reviewScreenshots(owner, "klubbarkiv-traningar");

    // Kartorna: Skogen med två versioner, den nya senast.
    await owner.getByRole("tab", { name: "Kartor" }).click();
    const skogen = owner.getByTestId("club-map").filter({ has: owner.getByRole("heading", { name: "Skogen", exact: true }) });
    await expect(skogen).toContainText("2 versioner");
    await expect(skogen.getByRole("listitem").first()).toContainText("Skogen 2020-08-15 V2.omap");
    await expect(skogen.getByRole("listitem").first()).toContainText("senaste");
    await reviewScreenshots(owner, "klubbarkiv-kartor");

    // Träningen med banorna från en annan mapp: banan ritas på kartan den gjordes med.
    await owner.getByRole("tab", { name: "Träningar" }).click();
    await entries.filter({ hasText: "Ängen" }).getByRole("link").click();
    await owner.waitForURL(/\/arkiv\/[0-9a-f-]+$/);
    await expect(owner.getByRole("heading", { name: "Ängen", level: 1 })).toBeVisible();
    await expect(owner.getByTestId("course-file")).toContainText("kartan hittad i en annan träning");
    await expect(owner.getByTestId("course-file")).toContainText("äldre version");
    await expect(owner.getByTestId("course-preview")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await reviewScreenshots(owner, "klubbarkiv-traning");

    // ADR-0222: moment och nivå på träningen, och sökningen på dem.
    await owner.getByRole("button", { name: "Ändra", exact: true }).click();
    const edit = owner.getByRole("form", { name: "Ändra" });
    await edit.getByRole("button", { name: "Kurvbild" }).click();
    await edit.getByRole("button", { name: "Kompass" }).click();
    await edit.getByRole("button", { name: "Gul" }).click();
    await expect(edit.getByRole("button", { name: "Kurvbild" })).toHaveAttribute("aria-pressed", "true");
    await edit.getByRole("button", { name: "Spara" }).click();
    await expect(owner.getByTestId("moment-badges")).toContainText("Kurvbild");
    await expect(owner.getByTestId("moment-badges")).toContainText("Gul");
    await owner.goto(`/organizer/clubs/${clubId}#trainings`);
    const momentFilters = owner.getByTestId("archive-moment-filters");
    await momentFilters.getByRole("button", { name: "Kompass" }).click();
    await momentFilters.getByRole("button", { name: "Kurvbild" }).click();
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("Ängen");
    await owner.getByRole("button", { name: "Rensa" }).click();
    await momentFilters.getByRole("button", { name: "Gul" }).click();
    await expect(entries).toHaveCount(1);
    await reviewScreenshots(owner, "klubbarkiv-moment");
    await owner.getByRole("button", { name: "Rensa" }).click();
    await expect(entries).toHaveCount(4);

    // Bjud in en läsare (en medlem; kartbanken är för alla medlemmar som förval, ADR-0209).
    const reader = await registerAccount(browser, `lasare.${suffix}@exempel.se`, "Lisa Läsare");
    await owner.goto(`/organizer/clubs/${clubId}#members`);
    const invite = owner.getByRole("form", { name: "Bjud in" });
    await invite.getByLabel("E-postadress").fill(`lasare.${suffix}@exempel.se`);
    await invite.getByRole("button", { name: "Bjud in" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Inbjudan är sparad." })).toBeVisible();
    await expect(owner.getByTestId("club-members")).toContainText("Medlem · väntar på inloggning");
    await reviewScreenshots(owner, "klubbarkiv-medlemmar");

    // Läsaren ser klubben, kan inte ändra, och använder Skogen-träningen igen (senaste kartversionen, samma georeferens).
    await reader.goto("/organizer");
    const readerClubs = reader.getByRole("region", { name: "Mina klubbar" });
    await expect(readerClubs).toContainText("Medlem · 4 träningar");
    await readerClubs.getByRole("link", { name: /Medlem · 4 träningar/ }).click();
    await reader.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
    await reader.getByTestId("archive-entries").getByRole("link").filter({ hasText: "2019-04-02" }).click();
    await expect(reader.getByRole("heading", { name: "Skogen", level: 1 })).toBeVisible();
    await expect(reader.getByRole("button", { name: "Ändra" })).toHaveCount(0);
    // Arkivet visar bara: beskedet och Använd igen direkt under kartan.
    await expect(reader.getByTestId("archive-read-only")).toContainText("Arkivet visar träningen som den gjordes.");
    await reader.getByTestId("archive-read-only").getByRole("button", { name: "Använd igen" }).click();
    const dialog = reader.getByRole("dialog", { name: "Använd träningen igen" });
    const version = dialog.getByRole("combobox", { name: "Kartversion" });
    await expect(version.locator("option:checked")).toContainText("(senaste)");
    await expect(dialog.getByTestId("alignment")).toContainText("samma georeferens", { timeout: 60_000 });
    await dialog.getByLabel("Namn").fill(`Skogen igen ${suffix}`);
    await reviewScreenshots(reader, "klubbarkiv-anvand-igen");
    await warmRoute(reader, "/api/organizer/events");
    await dialog.getByRole("button", { name: "Skapa träningen" }).click();
    await reader.waitForURL(/\/admin\/[0-9a-f-]+\/course-setting$/, { timeout: 120_000 });
    const raceId = /admin\/([0-9a-f-]+)\//.exec(reader.url())![1]!;
    await warmCourseSetting(reader, raceId);
    const state = await (await reader.request.get(`/api/admin/races/${raceId}/administrator/course-setting`)).json() as {
      mapFile: { fileName: string } | null; setting: { document: { courses: unknown[] } } | null };
    expect(state.mapFile?.fileName).toBe("Skogen 2020-08-15 V2.omap");
    expect(state.setting?.document.courses.length).toBeGreaterThan(0);

    // Ägarens fel 2026-11-03: starten gick inte att flytta i kopian. Dra starten med Välj; efter omladdning står den kvar.
    type Controls = Record<string, { kind: string; at: { x: number; y: number } }>;
    const controlsNow = async () => ((await (await reader.request.get(`/api/admin/races/${raceId}/administrator/course-setting`)).json()) as
      { setting: { document: { controls: Controls } } }).setting.document.controls;
    const [startId, start] = Object.entries(await controlsNow()).find(([, control]) => control.kind === "START")!;
    // Var starten står på skärmen, och att inget verktyg ligger över den (orsaken: kartan passades in under verktygsraden).
    const startOnScreen = async (course?: string) => {
      await reader.reload();
      // Telefonen visar Alla kontroller (banvalet ligger bakom Mer); starten finns där också.
      if (course) await reader.getByTestId("course-setting-view").selectOption({ label: course });
      const map = reader.getByRole("img", { name: `Karta med banpåtryck: ${course ?? "Alla kontroller"}` });
      await expect(map).toBeVisible({ timeout: 30_000 });
      await expect(reader.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
      const mapBox = (await map.boundingBox())!;
      const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
      const pxPerMm = Number(await map.getAttribute("data-px-per-mm"));
      const at = (await controlsNow())[startId]!.at;
      const point = { x: mapBox.x + mapBox.width / 2 + (at.x - centerX) * pxPerMm, y: mapBox.y + mapBox.height / 2 - (at.y - centerY) * pxPerMm };
      const covered = await reader.evaluate(({ x, y }) => [...document.querySelectorAll("[data-map-overlay]")].some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }), point);
      expect(covered, "starten under verktygen").toBe(false);
      return { point, pxPerMm, x: at.x };
    };
    // Telefonen (390 px): starten syns bredvid verktygen.
    await reader.setViewportSize({ width: 390, height: 844 });
    await startOnScreen();
    if (process.env.E2E_SCREENSHOT_DIR) await reader.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/klubbarkiv-kopian-start-390.png` });
    await reader.setViewportSize({ width: 1280, height: 720 });
    const { point: from, pxPerMm } = await startOnScreen("Lång");
    await reader.mouse.move(from.x, from.y);
    await reader.mouse.down();
    await reader.mouse.move(from.x + 3 * pxPerMm, from.y, { steps: 4 });
    await reader.mouse.move(from.x + 6 * pxPerMm, from.y, { steps: 4 });
    await reader.mouse.up();
    if (process.env.E2E_SCREENSHOT_DIR) await reader.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/klubbarkiv-kopian-start-flyttad-1280.png` });
    await expect.poll(async () => (await controlsNow())[startId]!.at.x, { timeout: 15_000 }).toBeCloseTo(start.at.x + 6, 0);
    // Omladdad: starten står kvar där den släpptes.
    expect((await startOnScreen("Lång")).x).toBeCloseTo(start.at.x + 6, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
