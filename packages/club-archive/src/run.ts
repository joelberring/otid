import { writeFile } from "node:fs/promises";
import { createImportClient, type ImportClient } from "./client";
import { buildImportPlan, type ImportPlan } from "./plan";
import { formatReport, mb } from "./report";
import { openSources, scanSources } from "./scan";
import { uploadPlan } from "./upload";

/**
 * ADR-0194 beslut 6: hela importen. Läser källorna, gör planen och rapporten, och (utan `dryRun`) laddar upp varje unik karta
 * som servern inte redan har för klubben, sedan kartornas versioner och sist träningarna med banfilerna. Allt är idempotent:
 * en ny körning laddar inte upp samma innehåll igen och gör inga dubbletter.
 */
export interface RunOptions {
  readonly inputs: readonly string[];
  readonly dryRun: boolean;
  readonly withLeaders: boolean;
  readonly reportPath: string;
  readonly server?: string | undefined;
  /** Valfritt: klubben som nyckeln måste höra till (annars klubben ur nyckeln). */
  readonly clubId?: string | undefined;
  readonly token?: string | undefined;
  readonly log: (line: string) => void;
  readonly client?: ImportClient;
  readonly now?: Date;
}

export interface RunResult { readonly plan: ImportPlan; readonly report: string; readonly uploaded: number; readonly skippedUploads: number }

export async function runImport(options: RunOptions): Promise<RunResult> {
  const sources = await openSources(options.inputs);
  try {
    options.log(`Läser ${sources.files.length} filer i ${sources.labels.length} källor …`);
    let lastShown = 0;
    const scan = await scanSources(sources.files, (done, total) => {
      if (done === total || Date.now() - lastShown > 2000) { lastShown = Date.now(); options.log(`  ${done}/${total}`); }
    });
    const plan = buildImportPlan(scan.scanned, { withLeaders: options.withLeaders });
    const report = formatReport(plan, { sources: sources.labels, dryRun: options.dryRun, withLeaders: options.withLeaders,
      when: options.now ?? new Date() }) + (scan.problems.length > 0 ? `\nProblem:\n${scan.problems.map(line => `  ${line}`).join("\n")}\n` : "");
    await writeFile(options.reportPath, report, "utf8");
    await writeFile(options.reportPath.replace(/\.txt$/, "") + ".json", JSON.stringify({ plan, problems: scan.problems }, null, 2), "utf8");
    options.log("");
    options.log(report.split("\nKartor och versioner:")[0]!.trimEnd());
    options.log("");
    options.log(`Rapporten: ${options.reportPath}`);
    if (options.dryRun) return { plan, report, uploaded: 0, skippedUploads: 0 };

    if (!options.client && (!options.server || !options.token)) throw new Error("--server och nyckeln behövs");
    const client = options.client ?? createImportClient({ server: options.server!, token: options.token! });
    // Nyckeln hör till en klubb: den visas innan något skickas, och ett --club som inte stämmer stoppar importen.
    const club = await client.club();
    if (options.clubId && options.clubId !== club.clubId) {
      throw new Error(`Importnyckeln hör till klubben ${club.clubName}, inte till id ${options.clubId}. Ta bort --club eller skapa en nyckel i rätt klubb.`);
    }
    options.log(`Klubb: ${club.clubName}`);
    const result = await uploadPlan({ plan, scan, client, onEvent: event => {
      if (event.kind === "checked") options.log(`Servern har redan ${event.known} av ${event.total} kartfiler.`);
      else if (event.kind === "map") options.log(`  [${event.position}/${event.total}] ${event.fileName} (${mb(event.size)}) …`);
      else if (event.kind === "entries") options.log(`  Träningar, omgång ${event.batch}/${event.batches} (${event.size}) …`);
    } });
    const { uploaded, skippedUploads } = result;
    options.log(`Klart: ${uploaded} kartfiler uppladdade (${skippedUploads} fanns redan), ${result.created} nya träningar (${result.existing} fanns redan), `
      + `${result.courseFiles} nya banfiler.`);
    return { plan, report, uploaded, skippedUploads };
  } finally {
    await sources.close();
  }
}
