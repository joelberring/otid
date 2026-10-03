import type { EntryRegistrationCandidate, EntryRegistrationCandidatesRequest } from "@o-tid/contracts";

type CandidateEntry = Omit<EntryRegistrationCandidate, "reasons">;

function comparableName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("sv-SE");
}

/** Advisory matching only: never identifies, merges or mutates a participant. */
export function matchEntryRegistrationCandidates(
  entries: readonly CandidateEntry[],
  query: EntryRegistrationCandidatesRequest,
  cardOwnerEntryIds: ReadonlySet<string>
): { totalMatches: number; candidates: EntryRegistrationCandidate[] } {
  const given = comparableName(query.givenName);
  const family = comparableName(query.familyName);
  const matches: EntryRegistrationCandidate[] = [];
  for (const entry of entries) {
    const reasons: EntryRegistrationCandidate["reasons"] = [];
    if (comparableName(entry.givenName) === given && comparableName(entry.familyName) === family) {
      reasons.push("SAME_NAME");
    }
    if (query.cardNumber !== null && cardOwnerEntryIds.has(entry.entryId)) {
      reasons.push("CARD_ALREADY_ASSIGNED");
    }
    if (reasons.length > 0) matches.push({ ...entry, reasons });
  }
  matches.sort((left, right) => {
    const cardPriority = Number(right.reasons.includes("CARD_ALREADY_ASSIGNED")) -
      Number(left.reasons.includes("CARD_ALREADY_ASSIGNED"));
    if (cardPriority !== 0) return cardPriority;
    return left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0;
  });
  return { totalMatches: matches.length, candidates: matches.slice(0, 20) };
}
