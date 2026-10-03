export type StoredResultStatus = "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "NT" | "DNS";

/** Shared deterministic presentation order; it never decides ranking. */
export const RESULT_STATUS_ORDER: Readonly<Record<StoredResultStatus, number>> = Object.freeze({
  OK: 0,
  MP: 1,
  DSQ: 2,
  DNF: 3,
  OOC: 4,
  NT: 5,
  DNS: 6
});

export function compareResultStatuses(left: StoredResultStatus, right: StoredResultStatus): number {
  return RESULT_STATUS_ORDER[left] - RESULT_STATUS_ORDER[right];
}
