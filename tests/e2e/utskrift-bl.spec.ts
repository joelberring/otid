import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * BL-profilerna (ADR-0183 beslut 7): i förhandsvisningen väljs "BL skog". O-Tid matchar kartfilens färger mot BL:s tabell
 * och visar förslaget med färgrutor före och efter, säkerhet, kartbitar, hela kartan före och efter och ordningen. Arrangören
 * godtar alla säkra, väljer BL-rad för den tvetydiga gröna, och PDF:en för tryck får BL:s violett 35/95/0/0 i CMYK.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

/** PDF:ens innehållsströmmar uppackade (sidor och kartans utsnitt). */
function pdfStreams(bytes: Buffer): string {
  const text = bytes.toString("latin1");
  const out: string[] = [];
  const pattern = /\/FlateDecode[^]*?stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);
    try { out.push(inflateSync(bytes.subarray(start, end)).toString("latin1")); } catch { /* typsnitt och bilder som inte är text */ }
  }
  return out.join("\n");
}

/** PDF:en ur jobblistan, nedladdad som arrangören gör (länken "Ladda ned"). */
async function downloadPdf(owner: Page, job: Locator): Promise<Buffer> {
  const download = owner.waitForEvent("download");
  await job.getByTestId("print-job-download").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^banor-tryck-.*\.pdf$/);
  return readFileSync((await file.path()));
}

async function uploadFiles(owner: Page, raceId: string, mapPath: string, ppenPath: string): Promise<void> {
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(mapPath);
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 120_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(ppenPath);
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 60_000 });
}

async function chooseBlForest(owner: Page, raceId: string): Promise<void> {
  await owner.goto(`/admin/${raceId}/course-setting/print`);
  await expect(owner.getByTestId("print-sheet").first()).toHaveAttribute("data-map", "ready", { timeout: 120_000 });
  await owner.getByTestId("print-profile-select").selectOption({ label: "BL skog" });
  await expect(owner.getByTestId("bl-proposal")).toBeVisible({ timeout: 30_000 });
}

test("utskrift-bl: BL skog, förslaget godkänns visuellt och PDF:en får BL:s violett", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `bl.${suffix}@exempel.se`, "Bodil BL");
  const raceId = await createRace(owner, `BL ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await uploadFiles(owner, raceId, fixture("maps/kartfil.omap"), fixture("course-setting/kartfil.ppen"));
  await chooseBlForest(owner, raceId);

  const proposal = owner.getByTestId("bl-proposal");
  const rows = proposal.getByTestId("bl-row");
  // Kartfilens fem använda färger: svart, brunt och gult säkra, blått att bekräfta, grönt tvetydigt (Grön 100 % eller Grön för Skid OL).
  await expect(rows).toHaveCount(5);
  await expect(proposal.locator("[data-testid=bl-row][data-confidence=SAFE]")).toHaveCount(3);
  const green = proposal.locator("[data-testid=bl-row][data-confidence=AMBIGUOUS]");
  await expect(green).toHaveCount(1);
  await expect(green).toContainText("Grön");
  await expect(green).toContainText("Tvetydig");
  // Visuellt: stora färgrutor före och efter, en kartbit per färg, hela kartan före/efter och ordningen som bild.
  const brown = proposal.locator("[data-testid=bl-row]", { hasText: "Brun för höjdkurvor mm" });
  await expect(brown.getByTestId("bl-before")).toBeVisible();
  const swatches = await brown.evaluate(row => [...row.querySelectorAll<HTMLElement>("[data-testid=bl-before], [data-testid=bl-after]")].map(item => getComputedStyle(item).backgroundColor));
  expect(swatches[0]).not.toBe(swatches[1]);
  await expect(brown.locator("img")).toBeVisible({ timeout: 30_000 });
  await expect(proposal.getByTestId("bl-compare")).toHaveAttribute("data-ready", "yes", { timeout: 60_000 });
  await expect(proposal.getByTestId("bl-layers")).toContainText("Banan: Violett transparent");
  await expect(proposal.getByTestId("bl-progress")).toHaveText("0 av 5 färger godkända");
  // Förhandskontrollen före PDF:en säger att färger är obekräftade.
  const pdf = owner.getByTestId("print-pdf");
  await expect(pdf.getByTestId("print-pdf-unconfirmed")).toContainText("5 färger är inte bekräftade");
  await expect(pdf.getByTestId("print-pdf-process")).toContainText("CMYK");
  await reviewScreenshots(owner, "utskrift-bl-forslag");

  await proposal.getByTestId("bl-accept-safe").click();
  await expect(proposal.getByTestId("bl-progress")).toHaveText("3 av 5 färger godkända", { timeout: 30_000 });
  await expect(proposal.locator("[data-testid=bl-row][data-status=ACCEPTED]")).toHaveCount(3);
  // Den tvetydiga gröna: välj BL-rad i listan med färgrutor.
  await green.getByTestId("bl-choose").click();
  const choices = green.getByTestId("bl-choices");
  await expect(choices.locator("button").first()).toBeVisible();
  await choices.locator("button[data-row=green-100]").click();
  await expect(green).toHaveAttribute("data-status", "ACCEPTED", { timeout: 30_000 });
  await expect(green).toHaveAttribute("data-row", "green-100");
  await expect(proposal.getByTestId("bl-progress")).toHaveText("4 av 5 färger godkända");
  await expect(pdf.getByTestId("print-pdf-unconfirmed")).toContainText("1 färg är inte bekräftad");
  // Godkännandet är sparat i tävlingens kopia av profilen, inte i kartfilen.
  const admin = `/api/admin/races/${raceId}/administrator`;
  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: { event: {
    printProfileId: string; printProfiles: { id: string; basedOn: string; colorDecisions: { name: string; row: string | null }[] }[] } } } };
  const event = state.setting.document.event;
  expect(event.printProfileId).toBe("bl-forest-2026-11-02-godkand");
  expect(event.printProfiles[0]).toMatchObject({ basedOn: "bl-forest-2026-11-02" });
  expect(event.printProfiles[0]!.colorDecisions).toEqual(expect.arrayContaining([{ ocadId: 4, name: "Grön", cmyk: { c: 76, m: 0, y: 91, k: 0 }, row: "green-100" }]));

  // PDF:en: varningen (en obekräftad färg) bekräftas, jobbet skrivs och har BL:s violett och brun i CMYK, inga dekorfärger.
  await pdf.getByTestId("print-pdf-confirm").check();
  await pdf.getByTestId("print-pdf-press").click();
  const job = pdf.getByTestId("print-job").first();
  await expect(job).toHaveAttribute("data-status", "DONE", { timeout: 180_000 });
  await expect(job).toContainText("CMYK utan dekorfärger");
  const bytes = await downloadPdf(owner, job);
  expect(bytes.toString("latin1")).not.toMatch(/\/Separation/);
  const content = pdfStreams(bytes);
  expect(content).toContain("0.35 0.95 0 0 K");
  expect(content).toContain("0 0.75 1 0.33 K");
  expect(content).not.toContain("0.2 1 0 0 K");
  await reviewScreenshots(owner, "utskrift-bl-godkant");
});

/**
 * Med ägarens Högdalen (`OTID_E2E_SBN_DIR`, aldrig i repot): förslaget godkänns helt (säkra, bekräftade och valda rader)
 * och skärmbilderna och PDF:en sparas i `E2E_SCREENSHOT_DIR` för granskning.
 */
const sbnDir = process.env.OTID_E2E_SBN_DIR;
test("utskrift-bl med ägarens Högdalen (OTID_E2E_SBN_DIR)", async ({ browser }) => {
  test.skip(!sbnDir || !process.env.E2E_SCREENSHOT_DIR, "bara med ägarens filer");
  test.setTimeout(600_000);
  const { readdirSync } = await import("node:fs");
  const mapFile = readdirSync(sbnDir!).find(name => name.endsWith(".ocd"))!;
  const suffix = unique();
  const owner = await registerAccount(browser, `blh.${suffix}@exempel.se`, "Hanna Högdalen");
  const raceId = await createRace(owner, `Högdalen BL ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);
  await uploadFiles(owner, raceId, `${sbnDir}/${mapFile}`, `${sbnDir}/SBN26_2.ppen`);
  await chooseBlForest(owner, raceId);
  const proposal = owner.getByTestId("bl-proposal");
  await expect(proposal.getByTestId("bl-compare")).toHaveAttribute("data-ready", "yes", { timeout: 120_000 });
  await owner.waitForTimeout(3000);
  const counts = await proposal.getByTestId("bl-row").evaluateAll(items => items.map(item => item.getAttribute("data-confidence")));
  console.info(`Högdalen BL skog: ${JSON.stringify(counts.reduce<Record<string, number>>((all, item) => ({ ...all, [item!]: (all[item!] ?? 0) + 1 }), {}))}`);
  await reviewScreenshots(owner, "hogdalen-bl-fore");
  await proposal.getByTestId("bl-accept-safe").click();
  await expect(proposal.getByTestId("bl-accept-safe")).toBeDisabled({ timeout: 30_000 });
  // De som behöver bekräftas: godta förslaget; de tvetydiga: välj den första raden i listan.
  for (const confidence of ["CONFIRM", "AMBIGUOUS"]) {
    const pending = proposal.locator(`[data-testid=bl-row][data-status=PENDING][data-confidence=${confidence}]`);
    for (let left = await pending.count(); left > 0; left = await pending.count()) {
      const row = pending.first();
      if (confidence === "CONFIRM") {
        const accept = row.getByTestId("bl-accept");
        if (await accept.count() > 0) await accept.click(); else await row.getByTestId("bl-keep").click();
      } else {
        await row.getByTestId("bl-choose").click();
        await row.getByTestId("bl-choices").locator("button").first().click();
      }
      await expect(pending).toHaveCount(left - 1, { timeout: 30_000 });
    }
  }
  await expect(owner.getByTestId("print-pdf").getByTestId("print-pdf-unconfirmed")).toContainText("Alla kartans färger är godkända", { timeout: 30_000 });
  await owner.waitForTimeout(3000);
  await reviewScreenshots(owner, "hogdalen-bl-godkant");
  const pdf = owner.getByTestId("print-pdf");
  const confirm = pdf.getByTestId("print-pdf-confirm");
  if (await confirm.count() > 0) await confirm.check();
  await pdf.getByTestId("print-pdf-press").click();
  const job = pdf.getByTestId("print-job").first();
  await expect(job).toHaveAttribute("data-status", "DONE", { timeout: 400_000 });
  const bytes = await downloadPdf(owner, job);
  writeFileSync(`${process.env.E2E_SCREENSHOT_DIR}/hogdalen-bl.pdf`, bytes);
  expect(pdfStreams(bytes)).toContain("0.35 0.95 0 0 K");
});
