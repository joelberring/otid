import { levelFromClassNames } from "@o-tid/course-setting";
import { foldForSearch } from "@o-tid/domain";
import { TRAINING_LEVELS, TRAINING_MOMENTS, type ClubArchiveEntryStatus, type ClubArchiveListItem, type TrainingLevel, type TrainingMoment } from "@o-tid/contracts";

/**
 * ADR-0194: arkivets sökning och filter i webbläsaren (hela arkivet hämtas på en gång; några hundra träningar). Sökningen
 * gäller plats, rubrik, ledare, taggar, banornas namn och kartornas namn, utan hänsyn till versaler och accenter (ä = a är
 * inte samma bokstav, men "alvsjo" hittar "Älvsjö"). ADR-0222: flera moment och egna ord samtidigt (alla måste finnas) och
 * nivåer (någon av dem); sökningen gäller också momentens namn på besökarens språk.
 */
export interface ArchiveFilter {
  readonly text: string;
  readonly year: string;
  readonly mapId: string;
  readonly moments: readonly TrainingMoment[];
  readonly tags: readonly string[];
  readonly levels: readonly TrainingLevel[];
  readonly leader: string;
  readonly status: "" | ClubArchiveEntryStatus;
}

export const EMPTY_FILTER: ArchiveFilter = { text: "", year: "", mapId: "", moments: [], tags: [], levels: [], leader: "", status: "" };

/** Ett sparat filter (äldre versioner hade en enda tagg) med bara de kända fälten. */
export function savedFilter(saved: Partial<ArchiveFilter> & { tag?: string } | null): ArchiveFilter {
  if (!saved) return EMPTY_FILTER;
  const list = <T,>(value: unknown, valid?: readonly T[]) => Array.isArray(value)
    ? value.filter((item): item is T => typeof item === "string" && (!valid || valid.includes(item as T))) : [];
  const text = (value: unknown) => typeof value === "string" ? value : "";
  return { text: text(saved.text), year: text(saved.year), mapId: text(saved.mapId), leader: text(saved.leader),
    status: text(saved.status) as ArchiveFilter["status"], moments: list<TrainingMoment>(saved.moments, TRAINING_MOMENTS),
    tags: [...list<string>(saved.tags), ...(saved.tag ? [saved.tag] : [])], levels: list<TrainingLevel>(saved.levels, TRAINING_LEVELS) };
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
    if (filter.status && entry.status !== filter.status) return false;
    if (words.length === 0) return true;
    const haystack = foldForSearch([entry.place, entry.title, entry.leader ?? "", ...entry.tags, ...entry.moments.map(momentName), ...entry.courseNames, ...entry.maps.map(map => map.name),
      entry.trainingDate ?? ""].join(" "));
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
    leaders: sorted(entries.flatMap(entry => entry.leader ? [entry.leader] : []))
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
