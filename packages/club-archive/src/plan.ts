import type { SkipCategory } from "./classify";
import { baseName, trainingFolderOf } from "./folder-name";
import { mapIdentity } from "./map-groups";
import { referenceFileName } from "./ppen-reference";
import { suggestTags } from "./tags";

/**
 * ADR-0194 beslut 6: importens plan ur de lästa filerna (ren funktion). Samma plan används för `--dry-run`-rapporten och för
 * uppladdningen, så att rapporten säger exakt vad som skulle skickas.
 */
export interface ScannedMap { readonly kind: "MAP"; readonly source: string; readonly path: string; readonly size: number;
  readonly format: "OCD" | "OMAP"; readonly sha256: string }
export interface ScannedCourse { readonly kind: "PPEN" | "COURSE_DATA"; readonly source: string; readonly path: string; readonly size: number;
  readonly sha256: string; readonly mapReference: string | null }
export interface ScannedSkip { readonly kind: "SKIP"; readonly source: string; readonly path: string; readonly size: number;
  readonly category: SkipCategory }
export type ScannedFile = ScannedMap | ScannedCourse | ScannedSkip;

export interface PlannedVersion {
  readonly sha256: string; readonly fileName: string; readonly format: "OCD" | "OMAP"; readonly size: number;
  /** Alla sökvägar där samma innehåll finns (kopior i träningarnas mappar). */
  readonly paths: readonly string[];
  /** Datum ur filnamnet, annars den första träningen där filen finns. */
  readonly versionDate: string | null;
  readonly dateFromName: boolean;
}
export interface PlannedMap { readonly key: string; readonly name: string; readonly versions: readonly PlannedVersion[] }

export type CourseResolution = "FOLDER" | "NAME" | "MISSING" | "NONE";
export interface PlannedCourseFile {
  readonly source: string; readonly path: string; readonly fileName: string; readonly kind: "PPEN" | "COURSE_DATA"; readonly sha256: string;
  readonly size: number; readonly mapReference: string | null; readonly resolution: CourseResolution; readonly mapSha256: string | null;
  /** Mappen där kartan hittades när den inte låg i träningens egen mapp. */
  readonly resolvedFrom: string | null;
}

/** Träning med karta och banor i samma mapp, bara banor med kartan hittad i en annan mapp, karta saknas, eller bara karta. */
export type TrainingStatus = "COMPLETE" | "COURSES_RESOLVED" | "MAP_MISSING" | "MAP_ONLY";
export interface PlannedTraining {
  readonly key: string; readonly path: string; readonly date: string | null; readonly year: number | null; readonly place: string;
  readonly title: string; readonly leader: string | null; readonly tags: readonly string[]; readonly mapSha256: readonly string[];
  readonly courseFiles: readonly PlannedCourseFile[]; readonly status: TrainingStatus;
}
export interface SkippedFolder { readonly path: string; readonly files: number; readonly categories: Partial<Record<SkipCategory, number>> }

export interface ImportPlan {
  readonly maps: readonly PlannedMap[];
  readonly trainings: readonly PlannedTraining[];
  readonly skippedFolders: readonly SkippedFolder[];
  readonly skippedFiles: Partial<Record<SkipCategory, { files: number; bytes: number }>>;
  readonly totals: {
    readonly files: number; readonly mapFiles: number; readonly mapBytes: number; readonly uniqueMaps: number; readonly uniqueMapBytes: number;
    readonly ppen: number; readonly courseData: number; readonly courseBytes: number;
  };
}

/**
 * Förvalet för ledarnas namn ur `[…]` (personuppgift), i kommandot och i webbläsaren. Ägaren har inte bestämt sig: byt här om
 * namnen inte ska med som förval (kommandot har `--utan-ledare` och `--med-ledare`).
 */
export const LEADERS_BY_DEFAULT = true;

export interface PlanOptions {
  /** Ledarens namn ur `[…]` (personuppgift; `--utan-ledare` stänger av). */
  readonly withLeaders: boolean;
}

const dayNumber = (date: string | null, year: number | null): number | null => {
  if (date) return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return year !== null ? Date.parse(`${year}-07-01T00:00:00Z`) / 86_400_000 : null;
};
const lower = (value: string) => value.normalize("NFC").toLowerCase();

export function buildImportPlan(files: readonly ScannedFile[], options: PlanOptions): ImportPlan {
  const folders = new Map<string, { folder: ReturnType<typeof trainingFolderOf>; files: ScannedFile[] }>();
  for (const file of files) {
    const folder = trainingFolderOf(file.path);
    const entry = folders.get(folder.path) ?? { folder, files: [] };
    entry.files.push(file);
    folders.set(folder.path, entry);
  }
  const maps = files.filter((file): file is ScannedMap => file.kind === "MAP");
  const day = (path: string) => { const f = folders.get(trainingFolderOf(path).path)?.folder; return f ? dayNumber(f.date, f.year) : null; };

  /** Närmast i tid (samma år först), annars den första sökvägen. */
  function nearest(candidates: readonly ScannedMap[], at: number | null, year: number | null): ScannedMap | undefined {
    return [...candidates].sort((a, b) => {
      const yearA = trainingFolderOf(a.path).year === year ? 0 : 1, yearB = trainingFolderOf(b.path).year === year ? 0 : 1;
      if (yearA !== yearB) return yearA - yearB;
      const da = at === null ? 0 : Math.abs((day(a.path) ?? at) - at), db = at === null ? 0 : Math.abs((day(b.path) ?? at) - at);
      return da - db || a.path.localeCompare(b.path);
    })[0];
  }

  function resolve(course: ScannedCourse, folderPath: string, folderMaps: readonly ScannedMap[], at: number | null, year: number | null)
    : Pick<PlannedCourseFile, "resolution" | "mapSha256" | "resolvedFrom"> {
    const reference = course.mapReference ? referenceFileName(course.mapReference) : null;
    const uniqueInFolder = [...new Map(folderMaps.map(map => [map.sha256, map])).values()];
    if (reference) {
      const byName = (candidates: readonly ScannedMap[]) => candidates.filter(map => lower(baseName(map.path)) === lower(reference));
      const key = mapIdentity(reference).key;
      const byKey = (candidates: readonly ScannedMap[]) => candidates.filter(map => mapIdentity(map.path).key === key);
      const local = nearest(byName(folderMaps), at, year) ?? nearest(byKey(folderMaps), at, year);
      if (local) return { resolution: "FOLDER", mapSha256: local.sha256, resolvedFrom: null };
      const other = maps.filter(map => trainingFolderOf(map.path).path !== folderPath);
      const remote = nearest(byName(other), at, year) ?? nearest(byKey(other), at, year);
      if (remote) return { resolution: "NAME", mapSha256: remote.sha256, resolvedFrom: trainingFolderOf(remote.path).path };
      if (uniqueInFolder.length === 1) return { resolution: "FOLDER", mapSha256: uniqueInFolder[0]!.sha256, resolvedFrom: null };
      return { resolution: "MISSING", mapSha256: null, resolvedFrom: null };
    }
    // Ingen sökväg (CourseData, eller en .ppen utan karta): en enda karta i mappen räknas som banornas.
    if (uniqueInFolder.length === 1) return { resolution: "FOLDER", mapSha256: uniqueInFolder[0]!.sha256, resolvedFrom: null };
    return { resolution: uniqueInFolder.length > 1 ? "MISSING" : "NONE", mapSha256: null, resolvedFrom: null };
  }

  const trainings: PlannedTraining[] = [];
  const skippedFolders: SkippedFolder[] = [];
  const firstUse = new Map<string, number>();
  for (const { folder, files: folderFiles } of [...folders.values()].sort((a, b) => a.folder.path.localeCompare(b.folder.path))) {
    const folderMaps = folderFiles.filter((file): file is ScannedMap => file.kind === "MAP");
    const courses = folderFiles.filter((file): file is ScannedCourse => file.kind === "PPEN" || file.kind === "COURSE_DATA");
    if (folderMaps.length === 0 && courses.length === 0) {
      const categories: Partial<Record<SkipCategory, number>> = {};
      for (const file of folderFiles) if (file.kind === "SKIP") categories[file.category] = (categories[file.category] ?? 0) + 1;
      skippedFolders.push({ path: folder.path, files: folderFiles.length, categories });
      continue;
    }
    const at = dayNumber(folder.date, folder.year);
    for (const map of folderMaps) if (at !== null) firstUse.set(map.sha256, Math.min(firstUse.get(map.sha256) ?? Infinity, at));
    const seen = new Set<string>();
    const courseFiles: PlannedCourseFile[] = [];
    for (const course of courses.sort((a, b) => a.path.localeCompare(b.path))) {
      if (seen.has(course.sha256)) continue;
      seen.add(course.sha256);
      courseFiles.push({ source: course.source, path: course.path, fileName: baseName(course.path).slice(0, 200), kind: course.kind,
        sha256: course.sha256, size: course.size, mapReference: course.mapReference, ...resolve(course, folder.path, folderMaps, at, folder.year) });
    }
    const mapSha256 = [...new Set(folderMaps.map(map => map.sha256))];
    const status: TrainingStatus = courseFiles.length === 0 ? "MAP_ONLY"
      : courseFiles.some(file => file.resolution === "MISSING" || file.resolution === "NONE") ? "MAP_MISSING"
        : courseFiles.some(file => file.resolution === "NAME") ? "COURSES_RESOLVED" : "COMPLETE";
    const names = folderFiles.filter(file => file.kind !== "SKIP").map(file => baseName(file.path));
    trainings.push({ key: folder.path, path: folder.path, date: folder.date, year: folder.year, place: folder.place, title: folder.title,
      leader: options.withLeaders ? folder.leader : null, tags: suggestTags([folder.path, ...names]), mapSha256, courseFiles, status });
  }
  // Kartor som bara banfiler pekar på räknas också från den träningen.
  for (const training of trainings) {
    const at = dayNumber(training.date, training.year);
    if (at === null) continue;
    for (const file of training.courseFiles) {
      if (file.mapSha256) firstUse.set(file.mapSha256, Math.min(firstUse.get(file.mapSha256) ?? Infinity, at));
    }
  }

  const bySha = new Map<string, ScannedMap[]>();
  for (const map of maps) bySha.set(map.sha256, [...(bySha.get(map.sha256) ?? []), map]);
  const groups = new Map<string, { names: Map<string, number>; versions: PlannedVersion[] }>();
  for (const [sha256, copies] of bySha) {
    const sorted = [...copies].sort((a, b) => (day(a.path) ?? 0) - (day(b.path) ?? 0) || a.path.localeCompare(b.path));
    const first = sorted[0]!;
    const identity = mapIdentity(first.path);
    const dated = sorted.map(copy => mapIdentity(copy.path).date).find(date => date !== null) ?? null;
    const used = firstUse.get(sha256);
    const fromUse = used !== undefined && Number.isFinite(used) ? new Date(used * 86_400_000).toISOString().slice(0, 10) : null;
    const group = groups.get(identity.key) ?? { names: new Map<string, number>(), versions: [] };
    group.names.set(identity.name, (group.names.get(identity.name) ?? 0) + copies.length);
    group.versions.push({ sha256, fileName: baseName(first.path).slice(0, 200), format: first.format, size: first.size,
      paths: sorted.map(copy => copy.path), versionDate: dated ?? fromUse, dateFromName: dated !== null });
    groups.set(identity.key, group);
  }
  const plannedMaps: PlannedMap[] = [...groups].map(([key, group]) => ({
    key, name: [...group.names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
    versions: group.versions.sort((a, b) => (a.versionDate ?? "").localeCompare(b.versionDate ?? "") || a.fileName.localeCompare(b.fileName))
  })).sort((a, b) => a.name.localeCompare(b.name, "sv"));

  const skippedFiles: Partial<Record<SkipCategory, { files: number; bytes: number }>> = {};
  for (const file of files) {
    if (file.kind !== "SKIP") continue;
    const current = skippedFiles[file.category] ?? { files: 0, bytes: 0 };
    skippedFiles[file.category] = { files: current.files + 1, bytes: current.bytes + file.size };
  }
  const courseFilesAll = files.filter((file): file is ScannedCourse => file.kind === "PPEN" || file.kind === "COURSE_DATA");
  return {
    maps: plannedMaps, trainings, skippedFolders, skippedFiles,
    totals: {
      files: files.length, mapFiles: maps.length, mapBytes: maps.reduce((sum, map) => sum + map.size, 0), uniqueMaps: bySha.size,
      uniqueMapBytes: [...bySha.values()].reduce((sum, copies) => sum + copies[0]!.size, 0),
      ppen: courseFilesAll.filter(file => file.kind === "PPEN").length, courseData: courseFilesAll.filter(file => file.kind === "COURSE_DATA").length,
      courseBytes: courseFilesAll.reduce((sum, file) => sum + file.size, 0)
    }
  };
}
