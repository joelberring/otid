import type { ClubArchiveListItem } from "@o-tid/contracts";
import { isoWeek } from "@o-tid/domain";

/**
 * Ägaren 2026-11-12: Hämta ur arkivet i terminsplanens vecka. Arkivets träningar med "samma veckor tidigare år" först (ISO-veckan
 * ± 1 i ett tidigare år än veckan som planeras), sedan de senaste; träningar utan datum sist.
 */
const weekDistance = (a: number, b: number) => { const diff = Math.abs(a - b); return Math.min(diff, 52 - diff); };

export function sameWeeksEarlierYears(entry: ClubArchiveListItem, weekDate: string): boolean {
  if (!entry.trainingDate) return false;
  const planned = isoWeek(weekDate);
  const trained = isoWeek(entry.trainingDate);
  return trained.year < planned.year && weekDistance(trained.week, planned.week) <= 1;
}

export function archiveSuggestions(entries: readonly ClubArchiveListItem[], weekDate: string): ClubArchiveListItem[] {
  const date = (entry: ClubArchiveListItem) => entry.trainingDate ?? (entry.year === null ? "" : `${entry.year}-00-00`);
  return [...entries].sort((a, b) => Number(sameWeeksEarlierYears(b, weekDate)) - Number(sameWeeksEarlierYears(a, weekDate))
    || date(b).localeCompare(date(a)) || a.title.localeCompare(b.title, "sv"));
}
