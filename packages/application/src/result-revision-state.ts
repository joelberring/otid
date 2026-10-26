import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { DECISION_CAUSES, resolveResultHistory, type GoverningDecision } from "@o-tid/domain";
import { loadStoredStartCheckinDnsStates, type StoredStartCheckinDnsState } from "./start-checkin-dns-state";
import { StoredResultRevisionConflict, type StoredResultRevisionInput } from "./stored-result-revision";
import { inUuids } from "./sql-ids";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Revision = typeof schema.resultRevisions.$inferSelect;
const MAX_DECISIONS_PER_ENTRY = 1_000;

/** Det en läsare måste ha valt: löparens senaste (publicerade) revision. */
export type StoredResultHead = StoredResultRevisionInput;

/**
 * Löparens gällande resultat ur `result_revision` (ADR-0173 beslut 1). `selectedHead` är läsarens valda huvud,
 * `head` revisionen som gäller (ett kvarliggande beslut, annars huvudet) och `governing` beslutet som styr.
 * NO_ACTIVE_RESULT: ej start (manuellt eller vid start) har tagits bort och inget resultat finns under.
 */
export type StoredResultHeadState<T extends StoredResultHead> = {
  readonly state: "ACTIVE_RESULT" | "NO_ACTIVE_RESULT";
  readonly head: T;
  readonly selectedHead: T;
  readonly governing: GoverningDecision;
  /** Revisionen under ett kvarliggande beslut (disk, godkännande, brutit, utom tävlan, utan tidtagning). */
  readonly underlyingId: string | null;
  readonly startCheckinDns: StoredStartCheckinDnsState | null;
};

/** Beslut och återtaganden per deltagare, i stigande revisionsordning. */
async function loadDecisionRows(tx: DatabaseTransaction, raceId: string, entryIds: readonly string[]) {
  const rows = entryIds.length === 0 ? [] : await tx.select().from(schema.resultRevisions).where(and(
    eq(schema.resultRevisions.raceId, raceId), inUuids(schema.resultRevisions.entryId, entryIds),
    inArray(schema.resultRevisions.cause, [...DECISION_CAUSES] as Revision["cause"][])
  )).orderBy(asc(schema.resultRevisions.entryId), asc(schema.resultRevisions.revision));
  const byEntry = new Map<string, Revision[]>();
  for (const row of rows) {
    const list = byEntry.get(row.entryId) ?? [];
    list.push(row);
    if (list.length > MAX_DECISIONS_PER_ENTRY) throw new StoredResultRevisionConflict("Deltagarens beslutshistorik är för stor");
    byEntry.set(row.entryId, list);
  }
  return byEntry;
}

export async function resolveStoredResultHeadStates<T extends StoredResultHead>(
  tx: DatabaseTransaction,
  raceId: string,
  selectedHeads: readonly T[]
): Promise<StoredResultHeadState<T>[]> {
  if (selectedHeads.length === 0) return [];
  const entryIds = [...new Set(selectedHeads.map((head) => head.entryId))];
  const [checkinDnsByResult, decisionsByEntry] = await Promise.all([
    loadStoredStartCheckinDnsStates(tx, raceId, entryIds), loadDecisionRows(tx, raceId, entryIds)]);
  const states = selectedHeads.map((selectedHead) => {
    const checkinDns = checkinDnsByResult.get(selectedHead.id) ?? null;
    if (selectedHead.startCheckinDnsDecisionId !== null || checkinDns !== null) {
      if (checkinDns === null || selectedHead.startCheckinDnsDecisionId !== checkinDns.source.decision.id ||
        selectedHead.entryId !== checkinDns.source.result.entryId || selectedHead.revision !== checkinDns.source.result.revision) {
        throw new StoredResultRevisionConflict("Valt avpricknings-DNS saknar matchande källa");
      }
      return { state: checkinDns.correction === null ? "ACTIVE_RESULT" : "NO_ACTIVE_RESULT", head: selectedHead, selectedHead,
        governing: "CHECKIN_DNS", underlyingId: null, startCheckinDns: checkinDns } as const;
    }
    const decisions = (decisionsByEntry.get(selectedHead.entryId) ?? [])
      .filter((row) => row.revision < selectedHead.revision);
    const history = resolveResultHistory<StoredResultHead>([...decisions, selectedHead]);
    if (history.noActiveResult) {
      return { state: "NO_ACTIVE_RESULT", head: selectedHead, selectedHead, governing: "NONE", underlyingId: null,
        startCheckinDns: null } as const;
    }
    const effective = history.effective;
    if (!effective) throw new StoredResultRevisionConflict("Gällande resultat saknas");
    // Läsarens projektion kan bära fler kolumner (namn, klass); de följer med till det gällande beslutet.
    const head = effective === selectedHead ? selectedHead : { ...selectedHead, ...effective } as T;
    // Beslutet avser revisionen närmast under; ett beslut utan avläsning (steg 31) har ingen.
    const overlay = effective !== history.restore && effective.revision > 1 &&
      ["DSQ", "APPROVAL", "DNF", "OOC", "NT", "CONTROL_APPROVAL", "MP_CONFIRMED"].includes(history.governing);
    return { state: "ACTIVE_RESULT", head, selectedHead, governing: history.governing,
      underlyingId: overlay ? `${effective.entryId}:${effective.revision - 1}` : null, startCheckinDns: null } as const;
  });
  return resolveUnderlyingIds(tx, raceId, states);
}

/** Ett kvarliggande beslut fattades alltid på revisionen närmast under; det är den beslutet avser. */
async function resolveUnderlyingIds<T extends StoredResultHead>(tx: DatabaseTransaction, raceId: string,
  states: StoredResultHeadState<T>[]): Promise<StoredResultHeadState<T>[]> {
  const keys = new Set(states.flatMap((state) => state.underlyingId === null ? [] : [state.underlyingId]));
  if (keys.size === 0) return states;
  const pairs = [...keys].map((key) => { const [entryId, revision] = key.split(":"); return { entryId: entryId!, revision: Number(revision) }; });
  const rows = await tx.select({ id: schema.resultRevisions.id, entryId: schema.resultRevisions.entryId,
    revision: schema.resultRevisions.revision }).from(schema.resultRevisions).where(and(
    eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, [...new Set(pairs.map((pair) => pair.entryId))]),
    inArray(schema.resultRevisions.revision, [...new Set(pairs.map((pair) => pair.revision))])));
  const idByKey = new Map(rows.map((row) => [`${row.entryId}:${row.revision}`, row.id]));
  return states.map((state) => {
    if (state.underlyingId === null) return state;
    const id = idByKey.get(state.underlyingId);
    if (!id) throw new StoredResultRevisionConflict("Beslutets underliggande revision saknas");
    return { ...state, underlyingId: id };
  });
}
