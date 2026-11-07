import { foldForSearch } from "@o-tid/domain";
import type { ClubArchiveEntryStatus, ClubArchiveListItem } from "@o-tid/contracts";

/**
 * ADR-0194: arkivets sökning och filter i webbläsaren (hela arkivet hämtas på en gång; några hundra träningar). Sökningen
 * gäller plats, rubrik, ledare, taggar, banornas namn och kartornas namn, utan hänsyn till versaler och accenter (ä = a är
 * inte samma bokstav, men "alvsjo" hittar "Älvsjö").
 */
export interface ArchiveFilter {
  readonly text: string;
  readonly year: string;
  readonly mapId: string;
  readonly tag: string;
  readonly leader: string;
  readonly status: "" | ClubArchiveEntryStatus;
}

export const EMPTY_FILTER: ArchiveFilter = { text: "", year: "", mapId: "", tag: "", leader: "", status: "" };

const yearOf = (entry: ClubArchiveListItem) => entry.trainingDate?.slice(0, 4) ?? (entry.year === null ? "" : String(entry.year));

export function filterArchive(entries: readonly ClubArchiveListItem[], filter: ArchiveFilter): ClubArchiveListItem[] {
  const words = foldForSearch(filter.text).split(/\s+/).filter(Boolean);
  return entries.filter(entry => {
    if (filter.year && yearOf(entry) !== filter.year) return false;
    if (filter.mapId && !entry.maps.some(map => map.mapId === filter.mapId)) return false;
    if (filter.tag && !entry.tags.includes(filter.tag)) return false;
    if (filter.leader && entry.leader !== filter.leader) return false;
    if (filter.status && entry.status !== filter.status) return false;
    if (words.length === 0) return true;
    const haystack = foldForSearch([entry.place, entry.title, entry.leader ?? "", ...entry.tags, ...entry.courseNames, ...entry.maps.map(map => map.name),
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
    leaders: sorted(entries.flatMap(entry => entry.leader ? [entry.leader] : []))
  };
}
