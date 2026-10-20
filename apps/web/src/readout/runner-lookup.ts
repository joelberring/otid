import type { ReadoutPackage, RunnerClub, RunnerSuggestion, SportidentReadoutPayload } from "@o-tid/contracts";
import { rankClassesByCourseFit, type ClassCourseFit, type RaceSnapshot } from "@o-tid/domain";
import type { QueuedReadout, QueuedRegistration } from "./store";

/**
 * Förslag vid okänd bricka på avläsningssidan (PLAN.md steg 29), även offline: löparen ur löpardatabasen (paketets
 * `runnerLookup`), klassen vars bana stämplingarna passar och anmälda utan bricka eller utan avläsning i de klasserna.
 * Allt är förslag; funktionären väljer alltid själv.
 */

/** Gemener utan diakritiska tecken, så att "asa" hittar "Åsa" och "oberg" hittar "Öberg". */
export function foldText(value: string): string {
  return value.toLocaleLowerCase("sv").normalize("NFD").replace(/\p{M}/gu, "").trim();
}

export interface RunnerIndex {
  readonly byCard: ReadonlyMap<string, RunnerSuggestion>;
  readonly runners: readonly { readonly runner: RunnerSuggestion; readonly words: readonly string[] }[];
  readonly clubs: readonly RunnerClub[];
}

const EMPTY: RunnerIndex = { byCard: new Map(), runners: [], clubs: [] };
const cache = new WeakMap<object, RunnerIndex>();

/** Uppslaget byggs en gång per paket (bricka → löpare och namnens ord). */
export function runnerIndex(pkg: ReadoutPackage | undefined): RunnerIndex {
  const lookup = pkg?.runnerLookup;
  if (!lookup) return EMPTY;
  const cached = cache.get(lookup);
  if (cached) return cached;
  const byCard = new Map<string, RunnerSuggestion>();
  for (const runner of lookup.runners) for (const card of runner.cards) if (!byCard.has(card)) byCard.set(card, runner);
  const index: RunnerIndex = { byCard, clubs: lookup.clubs,
    runners: lookup.runners.map((runner) => ({ runner, words: foldText(`${runner.givenName} ${runner.familyName}`).split(/[\s-]+/) })) };
  cache.set(lookup, index);
  return index;
}

export function runnerForCard(pkg: ReadoutPackage | undefined, cardNumber: string): RunnerSuggestion | undefined {
  return runnerIndex(pkg).byCard.get(cardNumber);
}

/** Löpare vars namn börjar med varje skrivet ord (för- eller efternamn, eller del av dubbelnamn). */
export function searchRunners(pkg: ReadoutPackage | undefined, text: string, limit = 6): RunnerSuggestion[] {
  const words = foldText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.join("").length < 2) return [];
  const found: RunnerSuggestion[] = [];
  for (const { runner, words: names } of runnerIndex(pkg).runners) {
    if (words.every((word) => names.some((name) => name.startsWith(word)))) found.push(runner);
    if (found.length >= limit) break;
  }
  return found;
}

/** Klubben med exakt det namnet (eller kortnamnet), för Eventors id vid IOF-exporten. */
export function clubByName(pkg: ReadoutPackage | undefined, name: string): RunnerClub | undefined {
  const folded = foldText(name);
  if (!folded) return undefined;
  const clubs = runnerIndex(pkg).clubs;
  return clubs.find((club) => foldText(club.name) === folded) ?? clubs.find((club) => club.shortName && foldText(club.shortName) === folded);
}

/** "Testa Testsson · OK Skogsfalken · 1975 · bricka 8100101" utan tomma delar. */
export function runnerLabel(runner: RunnerSuggestion, card?: string): string {
  const cards = runner.cards.length === 0 ? undefined : card && runner.cards.includes(card) ? card : runner.cards.join(", ");
  return [`${runner.givenName} ${runner.familyName}`, runner.club, runner.birthYear ? String(runner.birthYear) : undefined,
    cards ? `bricka ${cards}` : undefined].filter(Boolean).join(" · ");
}

export interface ClassSuggestion {
  readonly fit: ClassCourseFit;
  readonly className: string;
  readonly courseName: string;
}

function courseName(snapshot: ReadoutPackage["raceSnapshot"], courseVersionId: string): string {
  return snapshot.courses.find((course) => course.versions.some((version) => version.id === courseVersionId))?.name ?? "";
}

/**
 * Klasserna (bland dem man kan direktanmäla till) i ordning efter hur väl banan passar stämplingarna. Bland lika väl
 * passande klasser går damklasser (D…) före för en kvinna och herrklasser (H…) för en man enligt löpardatabasen.
 */
export function classSuggestions(pkg: ReadoutPackage, payload: Pick<SportidentReadoutPayload, "punches">,
  classIds: ReadonlySet<string>, sex?: RunnerSuggestion["sex"]): ClassSuggestion[] {
  const snapshot = pkg.raceSnapshot;
  const fits = rankClassesByCourseFit(payload.punches, snapshot as RaceSnapshot, classIds);
  const name = (classId: string) => snapshot.classes.find((raceClass) => raceClass.id === classId)?.name ?? "";
  const prefix = sex === "F" ? "D" : sex === "M" ? "H" : undefined;
  const preferred = (fit: ClassCourseFit) => prefix && name(fit.classId).toUpperCase().startsWith(prefix) ? 0 : 1;
  const sameRank = (left: ClassCourseFit, right: ClassCourseFit) => left.ok === right.ok &&
    left.missingControls.length === right.missingControls.length && left.extraPunches === right.extraPunches;
  const ordered = [...fits];
  // Stabil omsortering bara inom grupper som domänen rankar lika.
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && sameRank(ordered[start]!, ordered[end]!)) end += 1;
    const group = ordered.slice(start, end).sort((left, right) => preferred(left) - preferred(right));
    ordered.splice(start, group.length, ...group);
    start = end;
  }
  return ordered.map((fit) => ({ fit, className: name(fit.classId), courseName: courseName(snapshot, fit.courseVersionId) }));
}

export interface EntrySuggestion {
  readonly entryId: string;
  readonly classId: string;
  readonly name: string;
  readonly className: string;
  /** Deltagarens bricka i paketet; saknas när ingen bricka angetts. */
  readonly cardNumber?: string;
  /** Namnet stämmer med löparen som löpardatabasen har för brickan. */
  readonly sameName: boolean;
}

/**
 * Anmälda i de klasser vars bana passar (alla godkända, annars den närmaste) som saknar bricka eller inte har läst ut:
 * först den som heter som löpardatabasens löpare för brickan, sedan de utan bricka, sedan de med bricka. Deltagare som
 * har ett resultat från en avläsning (enligt paketet eller den här webbläsarens kö) föreslås inte; stafettklasser ingår
 * aldrig i `classes`.
 */
export function entrySuggestions(pkg: ReadoutPackage, classes: readonly ClassSuggestion[], items: readonly QueuedReadout[],
  registrations: readonly QueuedRegistration[], runner?: RunnerSuggestion, limit = 5): EntrySuggestion[] {
  const fitting = classes.some((row) => row.fit.ok) ? classes.filter((row) => row.fit.ok) : classes.slice(0, 1);
  if (fitting.length === 0) return [];
  const snapshot = pkg.raceSnapshot;
  const readOut = new Set(pkg.readOutEntryIds ?? []);
  const cards = new Map<string, string>();
  for (const assignment of snapshot.cardAssignments) if (assignment.active) cards.set(assignment.entryId, assignment.cardNumber);
  // Den här webbläsarens avläsningar av kända brickor och köade kopplingar räknas också.
  const ownerOfCard = new Map([...cards].map(([entryId, card]) => [card, entryId]));
  for (const item of items) { const owner = ownerOfCard.get(item.payload.cardNumber); if (owner) readOut.add(owner); }
  for (const row of registrations) if (row.status !== "rejected" && "target" in row.request) readOut.add(row.request.entryId);
  const order = new Map(fitting.map((row, index) => [row.fit.classId, index]));
  const wanted = runner ? foldText(`${runner.givenName} ${runner.familyName}`) : undefined;
  const rows = snapshot.entries.flatMap((entry): { suggestion: EntrySuggestion; rank: number }[] => {
    const position = order.get(entry.classId);
    if (position === undefined || readOut.has(entry.id)) return [];
    const name = `${entry.givenName} ${entry.familyName}`.trim();
    const cardNumber = cards.get(entry.id);
    const sameName = wanted !== undefined && foldText(name) === wanted;
    return [{ rank: (sameName ? 0 : cardNumber ? 2 : 1) * 1_000 + position, suggestion: { entryId: entry.id, classId: entry.classId, name,
      className: fitting[position]!.className, ...(cardNumber ? { cardNumber } : {}), sameName } }];
  });
  return rows.sort((left, right) => left.rank - right.rank || left.suggestion.name.localeCompare(right.suggestion.name, "sv"))
    .slice(0, limit).map((row) => row.suggestion);
}
