import { writeFile } from "node:fs/promises";
import { createImportClient, type ImportClient } from "./client";
import { entryBatches, mapPayload } from "./payload";
import { buildImportPlan, type ImportPlan } from "./plan";
import { formatReport, mb } from "./report";
import { openSources, scanSources } from "./scan";

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

    if (!options.client && (!options.server || !options.clubId || !options.token)) throw new Error("--server, --club och nyckeln behövs");
    const client = options.client ?? createImportClient({ server: options.server!, clubId: options.clubId!, token: options.token! });
    const allMaps = plan.maps.flatMap(map => map.versions.map(version => version.sha256));
    const { clubName, known } = await client.check(allMaps);
    options.log(`Klubb: ${clubName}. Servern har redan ${known.size} av ${allMaps.length} kartfiler.`);
    let uploaded = 0, skippedUploads = 0, done = 0;
    for (const map of plan.maps) {
      for (const version of map.versions) {
        done++;
        if (known.has(version.sha256)) { skippedUploads++; continue; }
        const source = scan.mapSources.get(version.sha256);
        if (!source) throw new Error(`${version.fileName}: källan saknas`);
        options.log(`  [${done}/${allMaps.length}] ${version.fileName} (${mb(version.size)}) …`);
        await client.uploadMap(version.sha256, source);
        uploaded++;
      }
      const result = await client.batch({ formatVersion: 1, maps: [mapPayload(map)], entries: [] });
      if (result.missingContent.length > 0) throw new Error(`${map.name}: servern saknar ${result.missingContent.length} kartfiler`);
    }
    const batches = entryBatches(plan, scan.courseContents);
    let created = 0, existing = 0, courseFiles = 0;
    for (const [index, batch] of batches.entries()) {
      options.log(`  Träningar, omgång ${index + 1}/${batches.length} (${batch.entries.length}) …`);
      const result = await client.batch(batch);
      created += result.entries.created; existing += result.entries.existing; courseFiles += result.entries.courseFilesAdded;
    }
    options.log(`Klart: ${uploaded} kartfiler uppladdade (${skippedUploads} fanns redan), ${created} nya träningar (${existing} fanns redan), `
      + `${courseFiles} nya banfiler.`);
    return { plan, report, uploaded, skippedUploads };
  } finally {
    await sources.close();
  }
}
