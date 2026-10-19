import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { administratorReturnRequestSchema, administratorReturnResponseSchema, canonicalAdministratorReturnRequest,
  administratorStartCorrectionRequestSchema, administratorStartCorrectionResponseSchema, canonicalAdministratorStartCorrectionRequest,
  canonicalStartCheckinOperation, StartCheckinOperationSchema } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { storeAuthorizedStartCheckinOperation } from "./start-checkin-sync";
import { sha256Hex } from "./serialization";

/**
 * Kvar i skogen och start i arbetsytan (ADR-0172 beslut 3): administratören och funktionären registrerar online.
 * Ingen personalcredential, klientens käll-id eller offlinekö. Källan är kontot och dess roll på tävlingen.
 */
type AdministratorReturnInput = RaceSessionProof & { request: unknown };

async function administratorReturn(db: Database, input: AdministratorReturnInput, manualReturnRegistered: boolean, now = new Date(), startCorrection = false) {
  const parsed = (startCorrection ? administratorStartCorrectionRequestSchema : administratorReturnRequestSchema).safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" as const };
  if (!Number.isFinite(now.getTime())) throw new Error("Ogiltig registreringstid");
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const role = auth.principal.role;
    const [race] = await tx.select().from(schema.races).where(eq(schema.races.id, auth.principal.raceId)).for("update");
    if (!race) return { status: "not-found" as const };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'start-checkin-request:' + intent.requestId}, 0))`);
    const [existing] = await tx.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, intent.requestId));
    if (existing) {
      const op = StartCheckinOperationSchema.parse(existing.intent);
      const original = { formatVersion: 1, requestId: op.requestId, entryId: op.entryId, packageVersion: op.packageVersion,
        expectedEntryVersion: op.expectedEntryVersion, expectedRevision: op.expectedRevision,
        observedAt: op.observedAt, ...(startCorrection ? { targetStartState: op.action.state } : { expectedStartState: op.action.state }) };
      if (existing.raceId !== race.id || existing.actorAccountId !== auth.principal.accountId ||
        (startCorrection ? op.action.kind !== "MARK_START" : op.action.kind !== "FINISH_CORRECTION" || op.action.manualReturnRegistered !== manualReturnRegistered) || op.dependsOnRequestId !== null ||
        !Buffer.from((startCorrection ? canonicalAdministratorStartCorrectionRequest : canonicalAdministratorReturnRequest)(original)).equals(Buffer.from((startCorrection ? canonicalAdministratorStartCorrectionRequest : canonicalAdministratorReturnRequest)(intent)))) {
        return { status: "conflict" as const };
      }
      const replay = await storeAuthorizedStartCheckinOperation(tx, { operation: op, contentHash: existing.contentHash }, role, now);
      if (replay.status !== "stored") return replay;
      return { status: "stored" as const, response: (startCorrection ? administratorStartCorrectionResponseSchema : administratorReturnResponseSchema).parse({ formatVersion: 1, replayed: true, request: intent, receipt: replay.response }) };
    }
    const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
      .where(and(eq(schema.entries.id, intent.entryId), eq(schema.entries.raceId, race.id)));
    if (!entry) return { status: "not-found" as const };
    // En källa per konto, tävling och roll.
    let [source] = await tx.select().from(schema.startCheckinDevices).where(and(eq(schema.startCheckinDevices.raceId, race.id),
      eq(schema.startCheckinDevices.actorAccountId, auth.principal.accountId), eq(schema.startCheckinDevices.role, role))).for("update");
    if (!source) {
      [source] = await tx.insert(schema.startCheckinDevices).values({ id: randomUUID(), raceId: race.id,
        actorAccountId: auth.principal.accountId, role,
        label: role === "ADMIN" ? "Onlineadministration" : "Funktionär", registeredAt: now }).returning();
    }
    if (!source || source.raceId !== race.id) throw new Error("Administrativ källa saknas eller har fel scope");
    const [last] = await tx.select({ sequence: schema.startCheckinOperations.localSequence }).from(schema.startCheckinOperations)
      .where(eq(schema.startCheckinOperations.deviceId, source.id)).orderBy(desc(schema.startCheckinOperations.localSequence)).limit(1);
    if ((last?.sequence ?? 0) >= 2_147_483_647) return { status: "conflict" as const };
    const operation = StartCheckinOperationSchema.parse({ formatVersion: 1, requestId: intent.requestId,
      dependsOnRequestId: null, deviceId: source.id, actorAccountId: auth.principal.accountId,
      raceId: race.id, entryId: intent.entryId, localSequence: (last?.sequence ?? 0) + 1,
      packageVersion: intent.packageVersion, expectedEntryVersion: intent.expectedEntryVersion,
      expectedRevision: intent.expectedRevision, observedAt: intent.observedAt,
      action: { kind: startCorrection ? "MARK_START" : "FINISH_CORRECTION", state: "targetStartState" in intent ? intent.targetStartState : intent.expectedStartState, ...(startCorrection ? {} : { manualReturnRegistered }) } });
    const stored = await storeAuthorizedStartCheckinOperation(tx, { operation,
      contentHash: sha256Hex(canonicalStartCheckinOperation(operation)) }, role, now);
    if (stored.status !== "stored") return stored;
    return { status: "stored" as const, response: (startCorrection ? administratorStartCorrectionResponseSchema : administratorReturnResponseSchema).parse({ formatVersion: 1, replayed: false, request: intent, receipt: stored.response }) };
  });
}

/** Registers an administratively observed return. */
export async function registerAdministratorReturn(db: Database, input: AdministratorReturnInput, now = new Date()) {
  return administratorReturn(db, input, true, now);
}

/** Corrects an erroneous administrative return without changing start status. */
export async function withdrawAdministratorReturn(db: Database, input: AdministratorReturnInput, now = new Date()) {
  return administratorReturn(db, input, false, now);
}

export async function correctAdministratorStart(db: Database, input: AdministratorReturnInput, now = new Date()) {
  return administratorReturn(db, input, false, now, true);
}
