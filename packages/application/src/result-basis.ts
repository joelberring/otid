import { sql } from "drizzle-orm";
import type { Database } from "@o-tid/database";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | DatabaseTransaction;

/**
 * ADR-0169 beslut 1: ett resultat är aktuellt så länge underlaget för just den
 * löparens bedömning är oförändrat (klass, startsätt, banversion med kontroller,
 * strukna kontroller och fast starttid). Underlaget beräknas av databasfunktionen
 * `otid_result_basis_hash` så att resultatrevisionens utlösare och läsningarna
 * här alltid använder samma regel.
 */
export async function loadResultBasisHashes(tx: Executor, raceId: string): Promise<Map<string, string>> {
  const result = await tx.execute<{ entry_id: string; basis_hash: string | null }>(sql`
    select e.id as entry_id, otid_result_basis_hash(e.id) as basis_hash
    from entry e where e.race_id = ${raceId}`);
  const hashes = new Map<string, string>();
  for (const row of result.rows) {
    if (row.basis_hash === null) throw new Error("Deltagaren saknar bedömningsunderlag");
    hashes.set(row.entry_id, row.basis_hash);
  }
  return hashes;
}

/** Aktuellt bedömningsunderlag för en deltagare, eller undefined om deltagaren saknas. */
export async function loadResultBasisHash(tx: Executor, entryId: string): Promise<string | undefined> {
  const result = await tx.execute<{ basis_hash: string | null }>(sql`select otid_result_basis_hash(${entryId}::uuid) as basis_hash`);
  return result.rows[0]?.basis_hash ?? undefined;
}

/**
 * Avgör om en resultatrevision fortfarande gäller. Revisioner med underlagshash
 * jämförs mot löparens aktuella underlag. Äldre revisioner utan hash (före
 * migration 0089) bedöms som tidigare mot tävlingsversionen.
 */
export function isResultCurrent(
  revision: { readonly basisHash: string | null; readonly snapshotVersion: number },
  currentBasisHash: string | undefined,
  raceSnapshotVersion: number
): boolean {
  if (revision.basisHash !== null) return currentBasisHash !== undefined && revision.basisHash === currentBasisHash;
  return revision.snapshotVersion === raceSnapshotVersion;
}

type BasisRevision = { readonly id: string; readonly revision: number; readonly basisHash: string | null; readonly snapshotVersion: number };

/**
 * Som `isResultCurrent`, men för ett löst resultathuvud. Ett gällande manuellt
 * beslut (disk, godkännande, brutit, utom tävlan, utan tidtagning) ligger kvar
 * ovanpå en senare teknisk revision, till exempel när appen räknat om resultatet
 * efter en banändring. Beslutsrevisionen bär då det gamla underlaget men beslutet
 * gäller fortfarande. Resultatet är aktuellt när den omräknade tekniska revisionen
 * under beslutet bygger på löparens aktuella underlag.
 */
export function isEffectiveResultCurrent(
  state: { readonly head: BasisRevision; readonly selectedHead: BasisRevision & { readonly readoutId?: string | null } },
  currentBasisHash: string | undefined,
  raceSnapshotVersion: number
): boolean {
  if (isResultCurrent(state.head, currentBasisHash, raceSnapshotVersion)) return true;
  const technical = state.selectedHead;
  const recalculatedBelowDecision = technical.id !== state.head.id && technical.revision > state.head.revision &&
    technical.readoutId !== undefined && technical.readoutId !== null;
  return recalculatedBelowDecision && isResultCurrent(technical, currentBasisHash, raceSnapshotVersion);
}
