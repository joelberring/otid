import { and, asc, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryRegistrationCandidatesRequestSchema, entryRegistrationCandidatesResponseSchema,
  type EntryRegistrationCandidatesResponse } from "@o-tid/contracts";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { matchEntryRegistrationCandidates } from "./entry-registration-matching";

export type EntryRegistrationCandidatesResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: EntryRegistrationCandidatesResponse };

export async function listEntryRegistrationCandidatesAsAdmin(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & { request: unknown },
  now = new Date()
): Promise<EntryRegistrationCandidatesResult> {
  const request = entryRegistrationCandidatesRequestSchema.safeParse(input.request);
  if (!request.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input, capability: "REGISTER_ENTRY", requireCsrf: true
    }, now);
    if (auth.status !== "authenticated") return auth;
    const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, auth.principal.raceId)).for("share");
    if (!race) return { status: "not-found" };
    if (race.snapshotVersion !== request.data.expectedSnapshotVersion) return { status: "conflict" };
    // Left join preserves malformed entries so the read fails closed, never partially.
    const rows = await tx.select({ entryId: schema.entries.id, classId: schema.entries.classId,
      className: schema.classes.name, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, organisationName: schema.entries.organisationName
    }).from(schema.entries).leftJoin(schema.classes, and(eq(schema.classes.id, schema.entries.classId),
      eq(schema.classes.raceId, race.id))).where(eq(schema.entries.raceId, race.id))
      .orderBy(asc(schema.entries.id)).limit(10_001);
    if (rows.length > 10_000 || rows.some(row => row.className === null)) {
      throw new Error("Deltagarunderlaget är för stort eller har en trasig klassrelation");
    }
    const entries = rows.map(row => ({ ...row, className: row.className! }));
    const entryIds = new Set(entries.map(row => row.entryId));
    const assignments = request.data.cardNumber === null ? [] : await tx.select({ entryId: schema.cardAssignments.entryId })
      .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, race.id),
        eq(schema.cardAssignments.cardNumber, request.data.cardNumber))).limit(10_001);
    if (assignments.length > 10_000 || assignments.some(row => !entryIds.has(row.entryId))) {
      throw new Error("Brickans historiska koppling ligger utanför giltigt deltagarunderlag");
    }
    const matches = matchEntryRegistrationCandidates(entries, request.data, new Set(assignments.map(row => row.entryId)));
    return { status: "ok", response: entryRegistrationCandidatesResponseSchema.parse({
      formatVersion: 1, raceId: race.id, snapshotVersion: race.snapshotVersion, ...matches
    }) };
  }, { isolationLevel: "repeatable read" });
}
