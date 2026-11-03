import { entryBatches, mapPayload } from "./payload";
import type { ImportPlan } from "./plan";
import type { ScanResult, SourceFile } from "./scan-core";

/**
 * ADR-0194 beslut 6 och ADR-0204: uppladdningen av en plan, samma i kommandot (importnyckeln) och i webbläsaren (inloggningen).
 * Först varje unik karta som servern inte har för klubben, sedan kartans versioner (en karta i taget, direkt efter sina
 * filer) och sist träningarna med banfilerna i omgångar. Allt är idempotent: en ny körning laddar inte upp samma innehåll igen
 * och gör inga dubbletter, så ett avbrott fortsätter där det slutade.
 */
export interface BatchResult {
  maps: { created: number; versionsAdded: number };
  entries: { created: number; existing: number; courseFilesAdded: number };
  missingContent: string[];
}

export interface ImportUploader {
  check(sha256: readonly string[]): Promise<{ known: Set<string> }>;
  uploadMap(sha256: string, file: SourceFile): Promise<{ stored: "new" | "existing" }>;
  batch(body: unknown): Promise<BatchResult>;
}

export type UploadEvent =
  | { readonly kind: "checked"; readonly known: number; readonly total: number }
  /** `position` räknar alla kartfiler (också de som servern har), `index` bara de som laddas upp. */
  | { readonly kind: "map"; readonly position: number; readonly total: number; readonly index: number; readonly uploads: number;
    readonly fileName: string; readonly size: number }
  | { readonly kind: "mapVersions"; readonly index: number; readonly total: number; readonly name: string }
  | { readonly kind: "entries"; readonly batch: number; readonly batches: number; readonly size: number; readonly done: number; readonly total: number };

export interface UploadResult {
  readonly uploaded: number; readonly skippedUploads: number; readonly created: number; readonly existing: number; readonly courseFiles: number;
}

export async function uploadPlan(input: { plan: ImportPlan; scan: Pick<ScanResult, "mapSources" | "courseContents">; client: ImportUploader;
  onEvent?: (event: UploadEvent) => void; signal?: AbortSignal; maxEntriesPerBatch?: number }): Promise<UploadResult> {
  const { plan, scan, client, signal } = input;
  const emit = input.onEvent ?? (() => undefined);
  const allMaps = plan.maps.flatMap(map => map.versions.map(version => version.sha256));
  const { known } = await client.check(allMaps);
  emit({ kind: "checked", known: known.size, total: allMaps.length });
  const uploads = allMaps.filter(sha => !known.has(sha)).length;
  let uploaded = 0, skippedUploads = 0, position = 0;
  for (const [mapIndex, map] of plan.maps.entries()) {
    for (const version of map.versions) {
      signal?.throwIfAborted();
      position++;
      if (known.has(version.sha256)) { skippedUploads++; continue; }
      const source = scan.mapSources.get(version.sha256);
      if (!source) throw new Error(`${version.fileName}: källan saknas`);
      emit({ kind: "map", position, total: allMaps.length, index: uploaded + 1, uploads, fileName: version.fileName, size: version.size });
      await client.uploadMap(version.sha256, source);
      uploaded++;
    }
    signal?.throwIfAborted();
    emit({ kind: "mapVersions", index: mapIndex + 1, total: plan.maps.length, name: map.name });
    const result = await client.batch({ formatVersion: 1, maps: [mapPayload(map)], entries: [] });
    if (result.missingContent.length > 0) throw new Error(`${map.name}: servern saknar ${result.missingContent.length} kartfiler`);
  }
  const batches = entryBatches(plan, scan.courseContents, undefined, input.maxEntriesPerBatch);
  let created = 0, existing = 0, courseFiles = 0, done = 0;
  for (const [index, batch] of batches.entries()) {
    signal?.throwIfAborted();
    emit({ kind: "entries", batch: index + 1, batches: batches.length, size: batch.entries.length, done, total: plan.trainings.length });
    const result = await client.batch(batch);
    created += result.entries.created; existing += result.entries.existing; courseFiles += result.entries.courseFilesAdded;
    done += batch.entries.length;
  }
  return { uploaded, skippedUploads, created, existing, courseFiles };
}
