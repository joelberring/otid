import { canonicalJsonBytes, resultOutcomeSchema, type ResultOutcome } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import { validateStoredStartCheckinDns } from "./start-checkin-dns-source";

/**
 * Läsning av en lagrad resultatrevision (ADR-0173 beslut 1). Revisionen är hela sanningen: utfallet måste
 * stämma med radens status, orsak, deltagare och bana. Avpricknings-DNS har sin egen journal och prövas mot den.
 */
type DatabaseStoredResultRevision = typeof schema.resultRevisions.$inferSelect;
type OptionalColumns = "shortenedCourseClassTransferId" | "basisHash" | "requestId" | "actorAccountId" | "note";
export type StoredResultRevision = Omit<DatabaseStoredResultRevision, OptionalColumns> &
  Partial<Pick<DatabaseStoredResultRevision, OptionalColumns>>;
export type StoredResultRevisionInput = StoredResultRevision;
export type StoredPublishedResultOutcome = Exclude<ResultOutcome, { readonly status: "UNKNOWN_CARD" }>;

export class StoredResultRevisionConflict extends Error {}

type Cause = DatabaseStoredResultRevision["cause"];
/** Tekniska utfall: godkänt, maxtid överskriden (PLAN.md steg 25) och felstämplat. */
const TIMED = ["OK", "OVERTIME", "MP"] as const;
/** Tillåtna utfall per orsak (samma regel som databasens `result_revision_cause_check`). */
const STATUS_BY_CAUSE: Record<Cause, { readonly statuses: readonly string[]; readonly readout: boolean; readonly reason?: string }> = {
  CARD_READOUT: { statuses: TIMED, readout: true },
  CLASS_CHANGE_RECALCULATION: { statuses: TIMED, readout: true },
  EXPLICIT_RECALCULATION: { statuses: TIMED, readout: true },
  UNKNOWN_READOUT_RESOLUTION: { statuses: TIMED, readout: true },
  SHORTENED_COURSE_CLASS_TRANSFER: { statuses: TIMED, readout: true },
  MANUAL_DID_NOT_START: { statuses: ["DNS"], readout: false },
  START_CHECKIN_DID_NOT_START: { statuses: ["DNS"], readout: false },
  MANUAL_DID_NOT_START_WITHDRAWAL: { statuses: ["DNS"], readout: false },
  MANUAL_DISQUALIFICATION: { statuses: ["DSQ"], readout: false },
  MANUAL_RESULT_APPROVAL: { statuses: ["OK"], readout: false, reason: "MANUAL_APPROVAL" },
  MANUAL_DID_NOT_FINISH: { statuses: ["DNF"], readout: false },
  MANUAL_OUT_OF_COMPETITION: { statuses: ["OOC"], readout: false },
  MANUAL_WITHOUT_TIMING: { statuses: ["NT"], readout: false },
  MANUAL_DISQUALIFICATION_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_RESULT_APPROVAL_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_DID_NOT_FINISH_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_OUT_OF_COMPETITION_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_WITHOUT_TIMING_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_FINISH_TIME_CORRECTION: { statuses: TIMED, readout: false },
  MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_PUNCH_START_TIME_CORRECTION: { statuses: TIMED, readout: false },
  MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL: { statuses: TIMED, readout: false },
  // Steg 31: manuell tid, godkända kontroller (helt eller delvis) och ett borttaget resultat utan avläsning.
  MANUAL_TIME: { statuses: TIMED, readout: false },
  MANUAL_TIME_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_CONTROL_APPROVAL: { statuses: ["OK", "MP"], readout: false },
  MANUAL_CONTROL_APPROVAL_WITHDRAWAL: { statuses: TIMED, readout: false },
  MANUAL_RESULT_REMOVED: { statuses: ["MP"], readout: false, reason: "MISSING_START" },
  // Steg 36: avläsningen avkodad på nytt från råramarna.
  READOUT_REREAD: { statuses: TIMED, readout: true },
  // Steg 38: bekräftad felstämpling (samma felstämplade utfall) och borttagen bekräftelse.
  MANUAL_MISPUNCH_CONFIRMATION: { statuses: ["MP"], readout: false },
  MANUAL_MISPUNCH_CONFIRMATION_WITHDRAWAL: { statuses: TIMED, readout: false }
};

function canonicalEquals(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalJsonBytes(left);
  const rightBytes = canonicalJsonBytes(right);
  return leftBytes.length === rightBytes.length && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

/** Det lagrade utfallet, eller `StoredResultRevisionConflict` om raden motsäger sig själv. */
export function parseStrictStoredResultRevision(
  row: StoredResultRevisionInput,
  checkinSource?: Parameters<typeof validateStoredStartCheckinDns>[0]
): StoredPublishedResultOutcome {
  if (row.startCheckinDnsDecisionId !== null) {
    if (!checkinSource) throw new StoredResultRevisionConflict("Avpricknings-DNS kräver full källvalidering");
    for (const key of Object.keys(checkinSource.result) as (keyof StoredResultRevision)[]) {
      // Projektioner behöver inte läsa kolumner som databasen sätter eller som bara gäller beslut.
      if (!(key in row) && (key === "basisHash" || key === "requestId" || key === "actorAccountId" ||
        key === "shortenedCourseClassTransferId" || key === "note")) continue;
      const expected = checkinSource.result[key], actual = row[key];
      const matches = expected instanceof Date
        ? actual instanceof Date && expected.getTime() === actual.getTime()
        : canonicalEquals(expected, actual);
      if (!matches) throw new StoredResultRevisionConflict("Källbeviset matchar inte vald resultatrevision");
    }
    return validateStoredStartCheckinDns(checkinSource);
  }
  const rule = STATUS_BY_CAUSE[row.cause];
  const parsed = resultOutcomeSchema.safeParse(row.evaluation);
  if (!rule || !parsed.success || parsed.data.status === "UNKNOWN_CARD" ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !Number.isSafeInteger(row.snapshotVersion) || row.snapshotVersion < 1 ||
      !("entryId" in parsed.data) || parsed.data.entryId !== row.entryId ||
      !("classId" in parsed.data) || parsed.data.classId === undefined ||
      !("courseVersionId" in parsed.data) || parsed.data.courseVersionId !== row.courseVersionId ||
      parsed.data.status !== row.status || parsed.data.reason !== row.reason) {
    throw new StoredResultRevisionConflict("Resultatrevisionen motsäger sitt lagrade utfall");
  }
  if (!rule.statuses.includes(parsed.data.status) || (row.readoutId !== null) !== rule.readout ||
    (rule.reason !== undefined && parsed.data.reason !== rule.reason) ||
    (rule.reason === undefined && rule.statuses === TIMED && parsed.data.reason === "MANUAL_APPROVAL") ||
    (row.shortenedCourseClassTransferId !== undefined &&
      (row.cause === "SHORTENED_COURSE_CLASS_TRANSFER") !== (row.shortenedCourseClassTransferId !== null))) {
    throw new StoredResultRevisionConflict("Resultatrevisionens orsak och utfall motsäger varandra");
  }
  return parsed.data as StoredPublishedResultOutcome;
}
