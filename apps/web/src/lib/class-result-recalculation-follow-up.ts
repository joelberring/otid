import type { ResultRecalculationCandidates } from "./result-recalculation-admin-client";

export type ClassResultRecalculationRow = ResultRecalculationCandidates["entries"][number] & {
  latestResultRevision: NonNullable<ResultRecalculationCandidates["entries"][number]["latestResultRevision"]>;
};

export function projectClassResultRecalculationFollowUp(
  candidates: ResultRecalculationCandidates,
  classId: string
): ClassResultRecalculationRow[] {
  return candidates.entries
    .filter((entry): entry is ClassResultRecalculationRow =>
      entry.classId === classId && entry.latestResultRevision !== null &&
      entry.latestResultRevision.snapshotVersion < candidates.snapshotVersion)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "sv-SE") || left.id.localeCompare(right.id));
}
