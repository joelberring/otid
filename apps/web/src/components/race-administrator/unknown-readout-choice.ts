import type { UnknownReadoutResolutionCandidateResponse, UnknownReadoutResolutionRequest } from "@o-tid/contracts";
import { variantMatch, variantMatchRank } from "@o-tid/domain";

/**
 * Kontrollvyns koppling av en okänd bricka (användartestet 2026-11-12): vilka deltagare som står först och vad kopplingen
 * ersätter. Ren logik utan React, så att den kan testas.
 */
type Candidate = UnknownReadoutResolutionCandidateResponse;
type CandidateEntry = Candidate["entries"][number];
export type EntryResult = NonNullable<CandidateEntry["latestResult"]>;

/** Har deltagaren ett resultat (status) att visa? */
export const hasResult = (entry: Pick<CandidateEntry, "latestResultRevision">): boolean => entry.latestResultRevision !== null;
/** Har deltagaren ett resultat från en avläsning, som kopplingen ersätter? (Ett beslut utan avläsning står kvar, steg 45.) */
const readOut = (entry: Pick<CandidateEntry, "readOut">): boolean => entry.readOut === true;

/**
 * Deltagare som saknar avläsning först, sedan de som redan läst ut. Inom det (gafflad bana, fel D) de vars tilldelade
 * variant är just den som avläsningens stämplingar passar, sedan de utan variant och sist de med en annan variant; i övrigt
 * listans ordning (efternamn, förnamn).
 */
export function orderUnknownReadoutEntries(candidate: Candidate, readoutId: string | undefined): CandidateEntry[] {
  const rank = (entry: CandidateEntry) => variantMatchRank(variantMatch(entry.courseVariantCode,
    readoutId ? fittingVariant(candidate, readoutId, entry.classId) : undefined));
  return candidate.entries.map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .sort((left, right) => Number(readOut(left.entry)) - Number(readOut(right.entry)) || left.rank - right.rank || left.index - right.index)
    .map((row) => row.entry);
}

/** Deltagarens tilldelade variant och om det är just den som stämplingarna passar; saknas när det inte går att jämföra. */
export function entryVariant(candidate: Candidate, readoutId: string, entry: CandidateEntry): { code: string; same: boolean } | undefined {
  const match = variantMatch(entry.courseVariantCode, fittingVariant(candidate, readoutId, entry.classId));
  return entry.courseVariantCode && match !== "NONE" ? { code: entry.courseVariantCode, same: match === "SAME" } : undefined;
}

/** Granskningen före "Bekräfta": vem, nuvarande bricka och resultat, och vad som ersätts. */
export interface LinkReview {
  readonly name: string;
  readonly className: string;
  readonly cardBefore: string | null;
  readonly cardAfter: string;
  readonly result: EntryResult | null;
  /** Löparen har ett resultat: kopplingen ersätter det och kräver ett uttryckligt medgivande. */
  readonly replacesResult: boolean;
  /** Löparen har en annan bricka, som byts. */
  readonly changesCard: boolean;
  /** Fel C: stämplingarna passar en annan variant än löparens tilldelade; avläsningen bedöms mot den de passar. */
  readonly variantChange?: { readonly assignedCode: string; readonly fittingCode: string };
}

/** Varianten som avläsningens stämplingar passar på klassens bana (gafflad bana), enligt serverns förslag. */
export function fittingVariant(candidate: Candidate, readoutId: string, classId: string): string | undefined {
  return candidate.readouts.find((row) => row.id === readoutId)?.fits?.find((fit) => fit.classId === classId)?.variantCode;
}

export function linkReview(candidate: Candidate, request: UnknownReadoutResolutionRequest): LinkReview | undefined {
  if (request.target !== "EXISTING_ENTRY") return undefined;
  const entry = candidate.entries.find((row) => row.id === request.entryId);
  if (!entry) return undefined;
  const cardBefore = entry.activeAssignment?.cardNumber ?? null;
  const fittingCode = fittingVariant(candidate, request.readoutId, entry.classId);
  const assignedCode = entry.courseVariantCode ?? undefined;
  return { name: `${entry.givenName} ${entry.familyName}`, className: candidate.classes.find((row) => row.id === entry.classId)?.name ?? "",
    cardBefore, cardAfter: request.cardNumber, result: hasResult(entry) ? entry.latestResult ?? null : null,
    replacesResult: readOut(entry), changesCard: cardBefore !== null && cardBefore !== request.cardNumber,
    ...(assignedCode && fittingCode && assignedCode !== fittingCode ? { variantChange: { assignedCode, fittingCode } } : {}) };
}

/** Begäran som skickas: med medgivandet att ersätta resultatet när arrangören kryssat i det. */
export function resolutionRequest(request: UnknownReadoutResolutionRequest, replaceExistingResult: boolean): UnknownReadoutResolutionRequest {
  return request.target === "EXISTING_ENTRY" && replaceExistingResult ? { ...request, replaceExistingResult: true } : request;
}
