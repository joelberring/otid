import { SKIP_LABELS, type SkipCategory } from "./classify";
import type { ImportPlan, PlannedTraining, TrainingStatus } from "./plan";

/** ADR-0194 beslut 6: importens rapport som text (svenska), samma för `--dry-run` och den riktiga importen. */
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;

export const STATUS_LABELS: Record<TrainingStatus, string> = {
  COMPLETE: "karta och banor i samma mapp",
  COURSES_RESOLVED: "bara banor, kartan hittad i en annan mapp",
  MAP_MISSING: "karta saknas",
  MAP_ONLY: "bara karta"
};

const trainingLine = (training: PlannedTraining) => {
  const courses = training.courseFiles.map(file => {
    const where = file.resolution === "NAME" ? ` → karta från ${file.resolvedFrom ?? "?"}`
      : file.resolution === "MISSING" ? ` → karta saknas${file.mapReference ? ` (${file.mapReference})` : ""}` : "";
    return `      ${file.fileName}${where}`;
  });
  const tags = training.tags.length > 0 ? `  [${training.tags.join(", ")}]` : "";
  return [`  ${training.date ?? training.year ?? "utan datum"}  ${training.title}${training.leader ? ` – ${training.leader}` : ""}${tags}`,
    ...courses].join("\n");
};

export function formatReport(plan: ImportPlan, meta: { readonly sources: readonly string[]; readonly dryRun: boolean; readonly withLeaders: boolean;
  readonly when: Date }): string {
  const t = plan.totals;
  const count = (status: TrainingStatus) => plan.trainings.filter(training => training.status === status).length;
  const lines: string[] = [];
  lines.push(`O-Tid klubbarkiv – ${meta.dryRun ? "provkörning (--dry-run), inget skickat" : "import"} ${meta.when.toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push(`Källor: ${meta.sources.length} (${meta.sources.join(", ")})`);
  lines.push(`Ledarnas namn: ${meta.withLeaders ? "importeras" : "importeras inte (--utan-ledare)"}`);
  lines.push("");
  lines.push(`Filer lästa (namn och storlek): ${t.files}`);
  lines.push(`Kartfiler: ${t.mapFiles} st, ${mb(t.mapBytes)} – unika: ${t.uniqueMaps} st, ${mb(t.uniqueMapBytes)} (laddas upp en gång var)`);
  lines.push(`Logiska kartor (gissade på namnet): ${plan.maps.length}`);
  lines.push(`Banfiler: ${t.ppen} .ppen och ${t.courseData} CourseData, ${mb(t.courseBytes)}`);
  lines.push("");
  lines.push(`Träningar: ${plan.trainings.length}`);
  for (const status of ["COMPLETE", "COURSES_RESOLVED", "MAP_MISSING", "MAP_ONLY"] as const) {
    lines.push(`  ${String(count(status)).padStart(4)}  ${STATUS_LABELS[status]}`);
  }
  lines.push(`  ${String(plan.skippedFolders.length).padStart(4)}  mappar utan kartor och banor (hoppas över)`);
  lines.push("");
  lines.push("Hoppas över (läses inte, skickas aldrig):");
  for (const [category, value] of Object.entries(plan.skippedFiles) as [SkipCategory, { files: number; bytes: number }][]) {
    lines.push(`  ${String(value.files).padStart(5)}  ${SKIP_LABELS[category]} (${mb(value.bytes)})`);
  }
  lines.push("");
  lines.push("Kartor och versioner:");
  for (const map of plan.maps) {
    lines.push(`  ${map.name} (${map.versions.length} ${map.versions.length === 1 ? "version" : "versioner"})`);
    for (const version of map.versions) {
      lines.push(`      ${version.versionDate ?? "utan datum"}${version.dateFromName ? "" : "*"}  ${version.fileName}  ${mb(version.size)}  ${version.paths.length} kopior`);
    }
  }
  lines.push("  (* datum från den första träningen där filen finns)");
  for (const status of ["MAP_MISSING", "COURSES_RESOLVED", "COMPLETE", "MAP_ONLY"] as const) {
    const list = plan.trainings.filter(training => training.status === status);
    if (list.length === 0) continue;
    lines.push("");
    lines.push(`Träningar – ${STATUS_LABELS[status]} (${list.length}):`);
    for (const training of list) lines.push(trainingLine(training));
  }
  if (plan.skippedFolders.length > 0) {
    lines.push("");
    lines.push(`Mappar utan kartor och banor (${plan.skippedFolders.length}):`);
    for (const folder of plan.skippedFolders) {
      const what = Object.entries(folder.categories).map(([category, files]) => `${files} ${SKIP_LABELS[category as SkipCategory]}`).join(", ");
      lines.push(`  ${folder.path}  (${what || "tom"})`);
    }
  }
  return `${lines.join("\n")}\n`;
}
