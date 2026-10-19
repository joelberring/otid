export type StoredResultStatus = "OK" | "OVERTIME" | "MP" | "DSQ" | "DNF" | "OOC" | "NT" | "DNS";

/** Shared deterministic presentation order; it never decides ranking. Maxtid överskriden kommer direkt efter godkända. */
export const RESULT_STATUS_ORDER: Readonly<Record<StoredResultStatus, number>> = Object.freeze({
  OK: 0,
  OVERTIME: 1,
  MP: 2,
  DSQ: 3,
  DNF: 4,
  OOC: 5,
  NT: 6,
  DNS: 7
});

export function compareResultStatuses(left: StoredResultStatus, right: StoredResultStatus): number {
  return RESULT_STATUS_ORDER[left] - RESULT_STATUS_ORDER[right];
}
