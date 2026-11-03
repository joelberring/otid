import { base64OfBytes } from "./bytes";
import type { ImportPlan, PlannedMap, PlannedTraining } from "./plan";

/**
 * ADR-0194 beslut 6: planen som importens JSON (kontraktet `clubImportBatchRequestSchema`). Kartorna skickas en i taget direkt
 * efter sina filer (så att innehållet får en referens på en gång); träningarna i omgångar under `maxBytes`.
 */
export const BATCH_MAX_BYTES = 6 * 1024 * 1024;
export const BATCH_MAX_ENTRIES = 100;

export function mapPayload(map: PlannedMap) {
  return {
    importKey: map.key, name: map.name,
    versions: map.versions.map(version => ({ sha256: version.sha256, fileName: version.fileName, format: version.format,
      versionDate: version.versionDate, sourcePath: version.paths[0]?.slice(0, 500) ?? null }))
  };
}

export function entryPayload(training: PlannedTraining, contents: ReadonlyMap<string, Uint8Array>) {
  return {
    importKey: training.key.slice(0, 500), trainingDate: training.date, year: training.year, place: training.place.slice(0, 200),
    title: training.title.slice(0, 200), leader: training.leader, tags: [...training.tags], sourcePath: training.path.slice(0, 500),
    mapSha256: [...training.mapSha256],
    courseFiles: training.courseFiles.map(file => {
      const bytes = contents.get(file.sha256);
      if (!bytes) throw new Error(`${file.path}: innehållet saknas`);
      return { fileName: file.fileName, kind: file.kind, sha256: file.sha256, contentBase64: base64OfBytes(bytes),
        mapReference: file.mapReference, mapSha256: file.mapSha256, resolution: file.resolution };
    })
  };
}

export function entryBatches(plan: ImportPlan, contents: ReadonlyMap<string, Uint8Array>, maxBytes = BATCH_MAX_BYTES, maxEntries = BATCH_MAX_ENTRIES) {
  const batches: { formatVersion: 1; maps: never[]; entries: ReturnType<typeof entryPayload>[] }[] = [];
  let current: ReturnType<typeof entryPayload>[] = [];
  let size = 0;
  for (const training of plan.trainings) {
    const entry = entryPayload(training, contents);
    const bytes = JSON.stringify(entry).length;
    if (current.length > 0 && (size + bytes > maxBytes || current.length >= maxEntries)) {
      batches.push({ formatVersion: 1, maps: [], entries: current });
      current = []; size = 0;
    }
    current.push(entry); size += bytes;
  }
  if (current.length > 0) batches.push({ formatVersion: 1, maps: [], entries: current });
  return batches;
}
