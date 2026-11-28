import { levelFromClassNames } from "@o-tid/course-setting";
import { foldForSearch } from "@o-tid/domain";
import { TRAINING_LEVELS, TRAINING_MOMENTS, type ClubArchiveEntryStatus, type ClubArchiveListItem, type TrainingLevel, type TrainingMoment } from "@o-tid/contracts";

/**
 * ADR-0194: arkivets sökning och filter i webbläsaren (hela arkivet hämtas på en gång; några hundra träningar). Sökningen
 * gäller plats, rubrik, ledare, taggar, banornas namn och kartornas namn, utan hänsyn till versaler och accenter (ä = a är
 * inte samma bokstav, men "alvsjo" hittar "Älvsjö"). ADR-0222: flera moment och egna ord samtidigt (alla måste finnas) och
 * nivåer (någon av dem); sökningen gäller också momentens namn på besökarens språk. Ägaren 2026-11-17: också vem som lade in
 * träningen (sökningen och filtret "Inlagd av").
 */
export interface ArchiveFilter {
  readonly text: string;
  readonly year: string;
  readonly mapId: string;
  readonly moments: readonly TrainingMoment[];
  readonly tags: readonly string[];
  readonly levels: readonly TrainingLevel[];
  readonly leader: string;
  readonly addedBy: string;
  readonly status: "" | ClubArchiveEntryStatus;
}

export const EMPTY_FILTER: ArchiveFilter = { text: "", year: "", mapId: "", moments: [], tags: [], levels: [], leader: "", addedBy: "", status: "" };

/**
 * Steg F2: filtret i adressen (`?ar=2026&ord=natt`), så att Bakåt från en träning ger samma urval. Listor upprepar namnet
 * (`ord=natt&ord=sprint`); okända moment och nivåer tas bort.
 */
const PARAMS = { text: "sok", year: "ar", mapId: "karta", leader: "ledare", addedBy: "inlagd", status: "visa", moments: "moment",
  levels: "niva", tags: "ord" } as const;
export const ARCHIVE_STATUSES: readonly ClubArchiveEntryStatus[] = ["COMPLETE", "COURSES_ONLY", "MAP_MISSING", "MAP_ONLY"];

export function filterFromSearch(search: string): ArchiveFilter {
  const params = new URLSearchParams(search);
  const one = (key: string) => params.get(key) ?? "";
  const status = one(PARAMS.status);
  return { text: one(PARAMS.text), year: one(PARAMS.year), mapId: one(PARAMS.mapId), leader: one(PARAMS.leader), addedBy: one(PARAMS.addedBy),
    status: (ARCHIVE_STATUSES as readonly string[]).includes(status) ? status as ClubArchiveEntryStatus : "",
    moments: params.getAll(PARAMS.moments).filter((moment): moment is TrainingMoment => (TRAINING_MOMENTS as readonly string[]).includes(moment)),
    levels: params.getAll(PARAMS.levels).filter((level): level is TrainingLevel => (TRAINING_LEVELS as readonly string[]).includes(level)),
    tags: params.getAll(PARAMS.tags).filter(Boolean) };
}

/** Filtret som adressens fråga ("" när inget är valt); andra parametrar i `base` behålls. */
export function filterToSearch(filter: ArchiveFilter, base = ""): string {
  const params = new URLSearchParams(base);
  for (const key of Object.values(PARAMS)) params.delete(key);
  for (const field of ["text", "year", "mapId", "leader", "addedBy", "status"] as const) if (filter[field]) params.set(PARAMS[field], filter[field]);
  for (const field of ["moments", "levels", "tags"] as const) for (const value of filter[field]) params.append(PARAMS[field], value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Antal valda filter utom sökningen (och utom egna ord med `withTags: false`). */
export function activeFilters(filter: ArchiveFilter, { withTags = true }: { withTags?: boolean } = {}): number {
  return [filter.year, filter.mapId, filter.leader, filter.addedBy, filter.status].filter(Boolean).length + filter.moments.length
    + filter.levels.length + (withTags ? filter.tags.length : 0);
}

/**
 * Steg F2: arkivets grupper. Innevarande och föregående år per månad («2026-11»), äldre per år («2024»), odaterade sist
 * (nyckeln ""). Ordningen inom en grupp är listans (senast först).
 */
export function archiveGroups<T extends Pick<ClubArchiveListItem, "trainingDate">>(entries: readonly T[], today: string):
  { key: string; kind: "month" | "year" | "undated"; entries: T[] }[] {
  const recent = Number(today.slice(0, 4)) - 1;
  const groups = new Map<string, { key: string; kind: "month" | "year" | "undated"; entries: T[] }>();
  const dated = entries.filter(entry => entry.trainingDate).sort((a, b) => b.trainingDate!.localeCompare(a.trainingDate!));
  for (const entry of [...dated, ...entries.filter(entry => !entry.trainingDate)]) {
    const date = entry.trainingDate;
    const kind = !date ? "undated" : Number(date.slice(0, 4)) >= recent ? "month" : "year";
    const key = !date ? "" : kind === "month" ? date.slice(0, 7) : date.slice(0, 4);
    const group = groups.get(key) ?? { key, kind, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const yearOf = (entry: ClubArchiveListItem) => entry.trainingDate?.slice(0, 4) ?? (entry.year === null ? "" : String(entry.year));

export function filterArchive(entries: readonly ClubArchiveListItem[], filter: ArchiveFilter,
  momentName: (moment: TrainingMoment) => string = moment => moment): ClubArchiveListItem[] {
  const words = foldForSearch(filter.text).split(/\s+/).filter(Boolean);
  return entries.filter(entry => {
    if (filter.year && yearOf(entry) !== filter.year) return false;
    if (filter.mapId && !entry.maps.some(map => map.mapId === filter.mapId)) return false;
    if (!filter.moments.every(moment => entry.moments.includes(moment))) return false;
    if (!filter.tags.every(tag => entry.tags.includes(tag))) return false;
    if (filter.levels.length > 0 && !filter.levels.some(level => entry.levels.includes(level))) return false;
    if (filter.leader && entry.leader !== filter.leader) return false;
    if (filter.addedBy && entry.added.name !== filter.addedBy) return false;
    if (filter.status && entry.status !== filter.status) return false;
    if (words.length === 0) return true;
    const haystack = foldForSearch([entry.place, entry.title, entry.leader ?? "", ...entry.tags, ...entry.moments.map(momentName), ...entry.courseNames, ...entry.maps.map(map => map.name),
      entry.trainingDate ?? "", entry.added.name].join(" "));
    return words.every(word => haystack.includes(word));
  });
}

/** Värdena som filtren kan väljas bland (år nyast först, resten i bokstavsordning). */
export function archiveFacets(entries: readonly ClubArchiveListItem[]) {
  const sorted = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, "sv"));
  return {
    years: [...new Set(entries.map(yearOf).filter(Boolean))].sort().reverse(),
    tags: sorted(entries.flatMap(entry => entry.tags)),
    moments: TRAINING_MOMENTS.filter(moment => entries.some(entry => entry.moments.includes(moment))),
    leaders: sorted(entries.flatMap(entry => entry.leader ? [entry.leader] : [])),
    addedBy: sorted(entries.map(entry => entry.added.name))
  };
}

/**
 * ADR-0222: nivåerna som banornas namn föreslår ("Gul", "Orange 2", "H12", "Lätt" …; samma tolkning som banläggningens
 * nivåstöd gör av klassernas namn), i färgernas ordning.
 */
export function levelsFromCourseNames(names: readonly string[]): TrainingLevel[] {
  const found = new Set<string>();
  for (const name of names) {
    const level = levelFromClassNames([name]);
    if (level) found.add(level);
  }
  return TRAINING_LEVELS.filter(level => found.has(level));
}
