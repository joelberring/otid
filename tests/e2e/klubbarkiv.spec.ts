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
  test.setTimeout(480_000);
  const suffix = unique();
  const dir = mkdtempSync(join(tmpdir(), "otid-klubbarkiv-"));
  try {
    for (const zip of syntheticYearZips()) writeFileSync(join(dir, zip.name), zip.data);
    const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Joel Ägare");
    for (const path of ["/api/organizer/clubs", "/organizer/clubs/00000000-0000-4000-8000-000000000000"]) await warmRoute(owner, path);

    // Mina tävlingar → Mina klubbar → Ny klubb.
    await owner.goto("/organizer");
    const clubs = owner.getByRole("region", { name: "Mina klubbar" });
    await expect(clubs.getByText("Du är inte med i någon klubb än.")).toBeVisible();
    await clubs.getByText("Ny klubb", { exact: true }).click();
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
    await owner.getByLabel("Tagg").selectOption("Keps");
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

    // Bjud in en läsare.
    const reader = await registerAccount(browser, `lasare.${suffix}@exempel.se`, "Lisa Läsare");
    await owner.goto(`/organizer/clubs/${clubId}#members`);
    const invite = owner.getByRole("form", { name: "Bjud in" });
    await invite.getByLabel("E-postadress").fill(`lasare.${suffix}@exempel.se`);
    await invite.getByRole("button", { name: "Bjud in" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Inbjudan är sparad." })).toBeVisible();
    await expect(owner.getByTestId("club-members")).toContainText("Läsare · väntar på inloggning");
    await reviewScreenshots(owner, "klubbarkiv-medlemmar");

    // Läsaren ser klubben, kan inte ändra, och använder Skogen-träningen igen (senaste kartversionen, samma georeferens).
    await reader.goto("/organizer");
    const readerClubs = reader.getByRole("region", { name: "Mina klubbar" });
    await expect(readerClubs).toContainText("Läsare · 4 träningar");
    await readerClubs.getByRole("link", { name: "Öppna arkivet" }).click();
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
