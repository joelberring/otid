import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createRace, registerAccount, reviewScreenshots, today, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * Steg 65 (ADR-0184): PDF för tryck från förhandsvisningen. Kartfilen och en .ppen läses in; i förhandsvisningen visas
 * förhandskontrollen och raden om att PDF/X och ICC inte stöds och att provtryck behövs. "Skapa PDF för tryck" lägger
 * jobbet i serverns kö; utskriftsarbetaren skriver PDF:en och listan visar "Klar". PDF:en laddas ned och har en sida per
 * bana, kartan som vektorer och banan i dekorfärgen Purple med övertryck. Kontorsskrivarens PDF har inga dekorfärger.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

test("banläggning-pdf: PDF för tryck och för kontorsskrivare ur förhandsvisningen", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `pdf.${suffix}@exempel.se`, "Petra Pdf");
  const raceId = await createRace(owner, `Pdf ${suffix}`, today(), "Tävling");
  await warmCourseSetting(owner, raceId);
  await warmRoute(owner, `/admin/${raceId}/course-setting/print`);

  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByTestId("course-setting-course").first()).toBeVisible({ timeout: 30_000 });
  const admin = `/api/admin/races/${raceId}/administrator`;
  const state = await (await owner.request.get(`${admin}/course-setting`)).json() as { setting: { document: { courses: { id: string }[] } } };
  const courses = state.setting.document.courses.length;

  await owner.goto(`/admin/${raceId}/course-setting/print`);
  const sheet = owner.getByTestId("print-sheet");
  await expect(sheet).toHaveCount(courses);
  await expect(sheet.first()).toHaveAttribute("data-map", "ready", { timeout: 60_000 });
  const panel = owner.getByTestId("print-pdf");
  await expect(panel.getByTestId("print-pdf-honesty")).toContainText("PDF/X och ICC-profiler stöds inte");
  await expect(panel.getByTestId("print-pdf-honesty")).toContainText("provtryck hos tryckeriet");
  await expect(panel.getByTestId("print-pdf-preflight")).toHaveAttribute("data-can-print", "yes", { timeout: 60_000 });

  await panel.getByTestId("print-pdf-press").click();
  const job = panel.getByTestId("print-job").first();
  await expect(job).toHaveAttribute("data-kind", "PRESS");
  await expect(job).toHaveAttribute("data-status", "DONE", { timeout: 180_000 });
  await expect(job).toContainText("Dekorfärger: Purple; övertryck");
  await reviewScreenshots(owner, "banlaggning-pdf-klar", [1280]);

  // Nedladdningen: PDF med en sida per bana, dekorfärgen Purple (CMYK 20/100/0/0) och övertryck.
  const download = owner.waitForEvent("download");
  await job.getByTestId("print-job-download").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^banor-tryck-.*\.pdf$/);
  const bytes = Buffer.from(await (await owner.request.get(`${admin}/course-setting/print-jobs/${(await job.getByTestId("print-job-download").getAttribute("href"))!
    .split("/print-jobs/")[1]!.split("/")[0]}/pdf`)).body());
  const pdf = bytes.toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.match(/\/Type \/Page\b(?!s)/g)?.length).toBe(courses);
  expect(pdf).toMatch(/\[ \/Separation \/Purple \/DeviceCMYK \d+ 0 R \]/);
  expect(pdf).toMatch(/\/C1 \[ 0\.2 1 0 0 \]/);
  expect(pdf).toMatch(/\/OP true\s+\/op true\s+\/OPM 1/);
  expect(pdf).toMatch(/\/Subtype \/Form/);
  expect(pdf).toMatch(/\/FontFile2/);

  // Kontorsskrivaren: CMYK utan dekorfärger.
  await panel.getByTestId("print-pdf-office").click();
  const office = panel.locator("[data-testid=print-job][data-kind=OFFICE]").first();
  await expect(office).toHaveAttribute("data-status", "DONE", { timeout: 180_000 });
  await expect(office).toContainText("CMYK utan dekorfärger");
  const href = (await office.getByTestId("print-job-download").getAttribute("href"))!;
  const officePdf = Buffer.from(await (await owner.request.get(href)).body()).toString("latin1");
  expect(officePdf.startsWith("%PDF-")).toBe(true);
  expect(officePdf).not.toMatch(/\/Separation/);

  // PDF:erna är aldrig publika: utan inloggning nekas nedladdningen.
  const anonymous = await browser.newContext();
  const denied = await anonymous.request.get(new URL(href, owner.url()).href);
  expect([401, 403]).toContain(denied.status());
  await anonymous.close();
});
