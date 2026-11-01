/**
 * Ritar kontrollbeskrivningarna i en .ppen till SVG-filer, för att titta på dem (symboler, linjer, text). Körs för hand:
 *
 *   pnpm exec tsx scripts/render-descriptions.ts <fil.ppen> <utkatalog> [språk] [rutstorlek i mm]
 *
 * Varje bana (och ALL_CONTROLS) ritas som symboler, text och båda; gafflade banor även för första varianten.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { courseVariants, layoutDescription, readPpen, type DescriptionKind } from "../src";
import { descriptionSvg } from "../test/description-svg";

function main(): void {
  const [file, out, language = "sv", box = "6"] = process.argv.slice(2);
  if (!file || !out) throw new Error("Ange .ppen-fil och utkatalog");
  const { document } = readPpen(readFileSync(file, "utf8"));
  mkdirSync(out, { recursive: true });
  const jobs: { course: string; name: string; variant?: string }[] = [{ course: "ALL_CONTROLS", name: "alla" }];
  for (const course of document.courses) {
    jobs.push({ course: course.id, name: course.name });
    const variants = courseVariants(document, course.id);
    if (variants.length > 1) jobs.push({ course: course.id, name: `${course.name} ${variants[0]!.code}`, variant: variants[0]!.code });
  }
  for (const job of jobs) {
    for (const kind of ["SYMBOLS", "TEXT", "SYMBOLS_AND_TEXT"] as DescriptionKind[]) {
      const layout = layoutDescription(document, { course: job.course, variant: job.variant, kind, language, boxMm: Number(box) });
      const name = `${job.name}_${kind}.svg`.replace(/[^\p{L}\p{N}_. -]/gu, "_");
      writeFileSync(join(out, name), descriptionSvg(layout, document.event.descriptionStandard));
    }
  }
  console.info(`Skrev ${jobs.length * 3} SVG-filer till ${out}`);
}

main();
