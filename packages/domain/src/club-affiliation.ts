/**
 * ADR-0209: klubbtillhörighet. Ren logik utan I/O: sökningen i klubblistan (Eventors organisationer) och vad en anmäld
 * tillhörighet ger i ett klubbarkiv.
 */
import { foldForSearch } from "./search-fold";

/**
 * Text för jämförelse: gemener, utan accenter (å → a, ä → a, ö → o) och utan allt som inte är bokstav eller siffra.
 * "OK Älvsjö-Örby" → "okalvsjoorby".
 */
export function normalizeClubSearch(value: string): string {
  return foldForSearch(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Initialerna i namnet: förkortningar (ord med bara versaler, som "OK" och "SOK") behålls hela, andra ord ger sin första
 * bokstav. "OK Älvsjö-Örby" → "okao", "Järfälla OK" → "jok".
 */
export function clubInitials(name: string): string {
  const words = name.split(/[\s\-–/&.,()]+/u).filter(word => /[\p{L}\p{N}]/u.test(word));
  if (words.length < 2) return "";
  return normalizeClubSearch(words.map(word => /^\p{Lu}{2,5}$/u.test(word) ? word : [...word][0] ?? "").join(""));
}

/** Söktexten som sparas per organisation: namnet, kortnamnet och initialerna, var för sig. */
export function clubSearchText(name: string, shortName?: string | null): string {
  const parts = [normalizeClubSearch(name), shortName ? normalizeClubSearch(shortName) : "", clubInitials(name)];
  return [...new Set(parts.filter(part => part.length > 0))].join(" ");
}

/** Orden i en sökning, normaliserade; tomma ord tas bort. Varje ord ska finnas i söktexten. Högst fem ord. */
export function clubSearchTokens(query: string): string[] {
  return [...new Set(query.split(/\s+/u).map(normalizeClubSearch).filter(token => token.length > 0))].slice(0, 5);
}

/** Om söktexten matchar alla ord (samma regel som databasens fråga). */
export function clubSearchMatches(searchText: string, query: string): boolean {
  const tokens = clubSearchTokens(query);
  return tokens.length > 0 && tokens.every(token => searchText.split(" ").some(part => part.includes(token)));
}

/** Sorteringsvärde: lägre är bättre (exakt, början av namnet, början av ett annat ord, någonstans). */
export function clubSearchRank(searchText: string, query: string): number {
  const tokens = clubSearchTokens(query);
  const parts = searchText.split(" ");
  const whole = tokens.join("");
  if (parts.includes(whole)) return 0;
  if (parts[0]?.startsWith(whole)) return 1;
  if (parts.some(part => part.startsWith(whole))) return 2;
  return 3;
}

export type ClubAffiliationStatus = "PENDING" | "CONFIRMED" | "DECLINED";
export type ClubSpaceRole = "OWNER" | "ADMIN" | "LEADER" | "READER";

/** En anmäld tillhörighet som den gäller för ett visst klubbarkiv. */
export interface ClubAffiliationFacts {
  readonly status: ClubAffiliationStatus;
  /** Klubbarkivet som bekräftade (eller matchade fritexten). */
  readonly clubId: string | null;
  /** Klubben i Eventors lista, eller null för "Annan klubb" (fritext). */
  readonly organisationId: string | null;
}

/** Klubbarkivets koppling: klubben i Eventor (bevisad med klubbens nyckel), eller ingen. */
export interface ClubSpaceLinkFacts {
  readonly clubId: string;
  readonly organisationId: string | null;
}

/**
 * Om tillhörigheten gör kontot till bekräftad medlem i klubbarkivet: bekräftad av just det arkivet, och (för en klubb ur listan)
 * fortfarande samma klubb som arkivet är kopplat till. En egen anmälan ger aldrig något.
 */
export function affiliationConfirmedIn(affiliation: ClubAffiliationFacts, link: ClubSpaceLinkFacts): boolean {
  if (affiliation.status !== "CONFIRMED" || affiliation.clubId !== link.clubId) return false;
  return affiliation.organisationId === null || affiliation.organisationId === link.organisationId;
}

/** Bekräftade medlemmar är medlemmar (READER) i arkivet; vad de ser avgörs av "Vem ser vad" (`clubAreaAllowed`). */
export function derivedClubRole(affiliations: readonly ClubAffiliationFacts[], link: ClubSpaceLinkFacts): ClubSpaceRole | undefined {
  return affiliations.some(affiliation => affiliationConfirmedIn(affiliation, link)) ? "READER" : undefined;
}

const RANK: Readonly<Record<ClubSpaceRole, number>> = { READER: 0, LEADER: 1, ADMIN: 2, OWNER: 3 };

/** Rollen som gäller: den uttryckliga (inbjudan) eller den härledda, den högsta av dem. */
export function effectiveClubRole(explicit: ClubSpaceRole | undefined, derived: ClubSpaceRole | undefined): ClubSpaceRole | undefined {
  if (!explicit) return derived;
  if (!derived) return explicit;
  return RANK[explicit] >= RANK[derived] ? explicit : derived;
}

/** "Vem ser vad": alla medlemmar, eller bara ledare och administratörer. */
export type ClubAreaAccess = "MEMBERS" | "LEADERS";
export type ClubArea = "ARCHIVE" | "MAP_BANK";

/**
 * Om rollen får använda delen: träningsarkivet (träningar, småbilder, banfiler) eller kartbanken (kartfiler, Använd igen,
 * nedladdning). Kartans egna rättigheter (ADR-0196) gäller ovanpå; den strängaste vinner.
 */
export function clubAreaAllowed(role: ClubSpaceRole, access: ClubAreaAccess): boolean {
  return access === "MEMBERS" || RANK[role] >= RANK.LEADER;
}

/**
 * Förvalen för ett nytt klubbarkiv: båda delarna för alla medlemmar. Ägaren: kartorna döljs bara som undantag, när klubben väljer
 * "Ledare och admin".
 */
export const CLUB_AREA_DEFAULTS: Readonly<Record<ClubArea, ClubAreaAccess>> = { ARCHIVE: "MEMBERS", MAP_BANK: "MEMBERS" };

/**
 * När en tävling räknas som klar för klubbarkivet: dagen efter tävlingsdagen (i evenemangets tidszon), eller när banorna
 * redan är publika (ADR-0176). Annars kräver "Lägg i klubbarkivet" att arrangören bekräftar banhemligheten.
 */
export function raceFinishedForArchive(input: { raceDate: string; today: string; coursesPublic: boolean }): boolean {
  return input.coursesPublic || input.today > input.raceDate;
}
