import { CLUB_ROLE_RANK, type ClubSpaceRole } from "./club-affiliation";

/**
 * ADR-0230: nyhetsflödet «Nytt i O-Tid». Rena regler utan I/O: vem som får skriva, vilka länkar som godtas och vilka nyheter
 * en besökare ser på startsidan. Lagringen och behörighetsprövningen mot databasen finns i `@o-tid/application` (news.ts).
 */

/** Högst så många nyheter i startsidans spalt. */
export const HOME_NEWS_LIMIT = 3;
/** Spalten döljs när den senaste synliga nyheten är äldre än så här (cirka två månader). */
export const HOME_NEWS_MAX_AGE_DAYS = 60;
const NEWS_LINK_MAX = 500;

/** Klubbens ledare, administratörer och ägare skriver klubbens nyheter; medlemmar läser dem. Inga nya rolltyper. */
export const canWriteClubNews = (role: ClubSpaceRole | undefined): boolean => role !== undefined && CLUB_ROLE_RANK[role] >= CLUB_ROLE_RANK.LEADER;

/**
 * En nyhets länk: en intern sökväg (`/…`, inte `//…` eller med omvänt snedstreck) eller en absolut http(s)-adress utan
 * inloggningsuppgifter. Allt annat (javascript:, data:, mailto: …) avvisas. Returnerar den normaliserade länken eller undefined.
 */
export function normalizedNewsLink(value: string): string | undefined {
  const link = value.trim();
  if (link.length === 0 || link.length > NEWS_LINK_MAX || /[\s\p{Cc}\\]/u.test(link)) return undefined;
  if (link.startsWith("/")) return link.startsWith("//") ? undefined : link;
  let url: URL;
  try { url = new URL(link); } catch { return undefined; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username || url.password || !url.hostname) return undefined;
  return url.href;
}

/** En intern länk öppnas i samma flik; en extern i webbläsaren som vanligt. */
export const isInternalNewsLink = (link: string): boolean => link.startsWith("/") && !link.startsWith("//");

export interface NewsVisibilityItem {
  /** NULL = allmän nyhet (superadmin); annars klubbens id. */
  readonly clubId: string | null;
  readonly publishedAt: Date;
  readonly hidden: boolean;
}

/**
 * Nyheterna en besökare ser i startsidans spalt: allmänna för alla, en klubbs bara för klubbens inloggade medlemmar
 * (`memberClubIds`, tom för utloggade), aldrig dolda. Nyast först, högst `HOME_NEWS_LIMIT`. Är den senaste synliga
 * äldre än `HOME_NEWS_MAX_AGE_DAYS` visas ingen (spalten döljs).
 */
export function homeNews<T extends NewsVisibilityItem>(items: readonly T[], memberClubIds: ReadonlySet<string>, now: Date): T[] {
  const visible = items.filter(item => !item.hidden && (item.clubId === null || memberClubIds.has(item.clubId)) && item.publishedAt <= now)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const latest = visible[0];
  if (!latest || now.getTime() - latest.publishedAt.getTime() > HOME_NEWS_MAX_AGE_DAYS * 86_400_000) return [];
  return visible.slice(0, HOME_NEWS_LIMIT);
}
