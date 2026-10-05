import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { canonicalStartCheckinOperation, StartCheckinOperationSchema, StartCheckinReceiptSchema,
  type StartCheckinReceipt, type StartCheckinSyncRequest } from "@o-tid/contracts";
import { createDidNotStartResult, planStartCheckinSync } from "@o-tid/domain";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { allowsStartCheckinSourceAction, type OnlineStartCheckinCapability } from "./start-checkin-source-action";

type StoredOperation = typeof schema.startCheckinOperations.$inferSelect;

function hash(value: unknown) {
  return createHash("sha256").update(canonicalStartCheckinOperation(value)).digest("hex");
}

function storedReceipt(row: StoredOperation): StartCheckinReceipt {
  const intent = StartCheckinOperationSchema.parse(row.intent);
  const receipt = StartCheckinReceiptSchema.parse(row.receipt);
  if (intent.requestId !== row.requestId || intent.deviceId !== row.deviceId || intent.actorCredentialId !== row.actorCredentialId ||
      intent.raceId !== row.raceId || intent.entryId !== row.entryId || intent.localSequence !== row.localSequence ||
      intent.packageVersion !== row.packageVersion || intent.expectedEntryVersion !== row.expectedEntryVersion ||
      intent.expectedRevision !== row.expectedRevision || intent.observedAt !== row.observedAt.toISOString() ||
      hash(row.intent) !== row.contentHash || receipt.requestId !== row.requestId ||
      receipt.raceId !== row.raceId || receipt.entryId !== row.entryId || receipt.deviceId !== row.deviceId ||
      receipt.localSequence !== row.localSequence || receipt.contentHash !== row.contentHash ||
      receipt.receivedAt !== row.receivedAt.toISOString() || receipt.effect.kind !== row.effect ||
      receipt.effect.revision !== row.resultingRevision ||
      (receipt.effect.kind === "APPLIED" && receipt.effect.revisionId !== row.createdRevisionId) ||
      (receipt.effect.kind === "CONFLICT" && receipt.effect.reason !== row.conflictReason)) {
    throw new Error("Avprickningsjournalen motsäger sin kvittens");
  }
  return receipt;
}

export { storedReceipt as validateStoredStartCheckinReceipt };

/** Internal transaction boundary. Caller must hold a verified administrator or functionary session
 * (`administrator-return.ts`). Not exported from the package entry point.
 */
export async function storeAuthorizedStartCheckinOperation(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  request: StartCheckinSyncRequest,
  capability: OnlineStartCheckinCapability,
  now: Date
) {
    const { operation: op, contentHash } = request;
    if (hash(op) !== contentHash) return { status: "invalid-request" as const };
    if (!allowsStartCheckinSourceAction(capability, op.action)) {
      return { status: "forbidden" as const };
    }
    const [race] = await tx.select().from(schema.races).where(eq(schema.races.id, op.raceId)).for("share");
    if (!race) return { status: "not-found" as const };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'start-checkin-request:' + op.requestId}, 0))`);
    const [device] = await tx.select().from(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.id, op.deviceId)).for("update");
    if (!device || device.raceId !== race.id || device.actorCredentialId !== op.actorCredentialId || device.capability !== capability) {
      return { status: "forbidden" as const };
    }
    const previous = await tx.select().from(schema.startCheckinOperations).where(or(
      eq(schema.startCheckinOperations.requestId, op.requestId),
      and(eq(schema.startCheckinOperations.deviceId, op.deviceId), eq(schema.startCheckinOperations.localSequence, op.localSequence))
    ));
    if (previous.length > 0) {
      const saved = previous[0];
      if (previous.length !== 1 || !saved || saved.requestId !== op.requestId || saved.deviceId !== op.deviceId ||
          saved.actorCredentialId !== op.actorCredentialId || saved.contentHash !== contentHash || hash(saved.intent) !== contentHash) {
        return { status: "conflict" as const };
      }
      return { status: "stored" as const, response: storedReceipt(saved) };
    }
    const [last] = await tx.select().from(schema.startCheckinOperations)
      .where(eq(schema.startCheckinOperations.deviceId, op.deviceId)).orderBy(desc(schema.startCheckinOperations.localSequence)).limit(1);
    if (op.localSequence !== (last?.localSequence ?? 0) + 1) return { status: "conflict" as const };
    const [entry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, op.entryId), eq(schema.entries.raceId, race.id))).for("update");
    if (!entry) return { status: "not-found" as const };
    const [current] = await tx.select().from(schema.startCheckinRevisions)
      .where(and(eq(schema.startCheckinRevisions.raceId, race.id), eq(schema.startCheckinRevisions.entryId, entry.id)))
      .orderBy(desc(schema.startCheckinRevisions.revision)).limit(1);
    const revision = current?.revision ?? 0;
    if ((op.dependsOnRequestId !== null ||
      (op.action.kind === "FINISH_CORRECTION" && revision === op.expectedRevision && op.action.state !== (current?.startState ?? "UNMARKED")))) {
      return { status: "invalid-request" as const };
    }
    if (current) {
      const [source] = await tx.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, current.requestId));
      if (!source) throw new Error("Avprickningsrevisionen saknar operation");
      const sourceReceipt = storedReceipt(source), sourceIntent = StartCheckinOperationSchema.parse(source.intent);
      if (sourceReceipt.effect.kind !== "APPLIED" || sourceReceipt.effect.revisionId !== current.id ||
          sourceReceipt.effect.revision !== current.revision || source.entryId !== entry.id || source.raceId !== race.id ||
          sourceIntent.action.state !== current.startState || (sourceIntent.action.kind === "FINISH_CORRECTION" &&
          sourceIntent.action.manualReturnRegistered !== current.manualReturnRegistered)) throw new Error("Avprickningsrevisionen motsäger sin operation");
    }
    let conflict: Extract<StartCheckinReceipt["effect"], { kind: "CONFLICT" }>["reason"] | undefined;
    if (op.dependsOnRequestId !== null) {
      const [dependency] = await tx.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, op.dependsOnRequestId));
      if (!dependency || dependency.deviceId !== op.deviceId || dependency.actorCredentialId !== op.actorCredentialId ||
          dependency.raceId !== race.id || dependency.entryId !== entry.id || dependency.localSequence >= op.localSequence ||
          storedReceipt(dependency).effect.kind === "CONFLICT" || dependency.resultingRevision !== op.expectedRevision) conflict = "DEPENDENCY_CONFLICT";
    }
    if (!conflict && entry.version !== op.expectedEntryVersion) conflict = "STALE_ENTRY";
    if (!conflict && race.snapshotVersion !== op.packageVersion) conflict = "STALE_PACKAGE";
    const [latest] = await tx.select().from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id)))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1);
    const [state] = latest ? await resolveStoredResultHeadStates(tx, race.id, [latest]) : [];
    const [otherResult] = await tx.select({ id: schema.resultRevisions.id }).from(schema.resultRevisions).where(and(
      eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id),
      ne(schema.resultRevisions.cause, "START_CHECKIN_DID_NOT_START")
    )).limit(1);
    const [readout] = await tx.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts)
      .innerJoin(schema.cardAssignments, and(eq(schema.cardAssignments.raceId, schema.cardReadouts.raceId), eq(schema.cardAssignments.cardNumber, schema.cardReadouts.cardNumber)))
      .where(and(eq(schema.cardReadouts.raceId, race.id), eq(schema.cardAssignments.entryId, entry.id))).limit(1);
    const [raceClass] = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId }).from(schema.classes)
      .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id), eq(schema.courses.raceId, race.id)));
    if (!raceClass) conflict ??= "RESULT_CONFLICT";
    const plan = conflict ? null : planStartCheckinSync({
      current: { revision, state: current?.startState ?? "UNMARKED", manualReturnRegistered: current?.manualReturnRegistered ?? false },
      expectedRevision: op.expectedRevision, action: op.action, technicalReturnRegistered: readout !== undefined ||
        (latest?.readoutId !== null && latest?.readoutId !== undefined),
      resultRevision: latest?.revision ?? 0,
      resultState: otherResult ? "OTHER_RESULT" : !latest ? "EMPTY" : state?.startCheckinDns
        ? state.state === "NO_ACTIVE_RESULT" ? "WITHDRAWN_CHECKIN_DNS" : "ACTIVE_CHECKIN_DNS" : "OTHER_RESULT"
    });
    if (plan?.kind === "CONFLICT") conflict = plan.reason;
    const revisionId = plan?.kind === "APPLIED" ? randomUUID() : null;
    const effect: StartCheckinReceipt["effect"] = conflict ? { kind: "CONFLICT", reason: conflict, revision }
      : plan?.kind === "APPLIED" && revisionId ? { kind: "APPLIED", revision: plan.revision, revisionId }
        : { kind: "UNCHANGED", revision };
    const receipt = StartCheckinReceiptSchema.parse({ formatVersion: 1, storage: "STORED", requestId: op.requestId,
      deviceId: op.deviceId, raceId: race.id, entryId: entry.id, localSequence: op.localSequence,
      contentHash, receivedAt: now.toISOString(), effect });
    await tx.insert(schema.startCheckinOperations).values({ requestId: op.requestId, deviceId: op.deviceId,
      actorCredentialId: op.actorCredentialId, raceId: op.raceId, entryId: op.entryId, localSequence: op.localSequence,
      packageVersion: op.packageVersion, expectedEntryVersion: op.expectedEntryVersion, expectedRevision: op.expectedRevision,
      intent: op, observedAt: new Date(op.observedAt), receivedAt: now,
      contentHash, effect: effect.kind, resultingRevision: effect.revision, createdRevisionId: revisionId,
      conflictReason: effect.kind === "CONFLICT" ? effect.reason : null, receipt });
    if (plan?.kind === "APPLIED" && revisionId && raceClass) {
      await tx.insert(schema.startCheckinRevisions).values({ id: revisionId, requestId: op.requestId, raceId: race.id, entryId: entry.id,
        revision: plan.revision, startState: plan.state, manualReturnRegistered: plan.manualReturnRegistered });
      if (plan.dnsEffect === "CREATE") {
        const decisionId = randomUUID(), resultId = randomUUID(), resultRevision = (latest?.revision ?? 0) + 1;
        await tx.insert(schema.resultRevisions).values({ id: resultId, raceId: race.id, entryId: entry.id, revision: resultRevision,
          cause: "START_CHECKIN_DID_NOT_START", startCheckinDnsDecisionId: decisionId, status: "DNS", reason: "DID_NOT_START",
          evaluation: createDidNotStartResult({ entryId: entry.id, classId: raceClass.id, courseVersionId: raceClass.courseVersionId }),
          engineVersion: "start-checkin-dns-v1", snapshotVersion: race.snapshotVersion, courseVersionId: raceClass.courseVersionId,
          published: true, createdAt: now });
        await tx.insert(schema.startCheckinDnsDecisions).values({ id: decisionId, raceId: race.id, entryId: entry.id,
          actorCredentialId: op.actorCredentialId, operationRequestId: op.requestId, startCheckinRevisionId: revisionId,
          operationalRevision: plan.revision, classId: raceClass.id, courseVersionId: raceClass.courseVersionId,
          snapshotVersion: race.snapshotVersion, expectedLatestResultRevision: latest?.revision ?? 0,
          createdResultRevisionId: resultId, createdResultRevision: resultRevision, policyVersion: "start-checkin-dns-v1", decidedAt: now });
      } else if (plan.dnsEffect === "WITHDRAW") {
        if (!state?.startCheckinDns || !latest) throw new Error("DNS-rättningen saknar exakt källa");
        await tx.insert(schema.startCheckinDnsWithdrawals).values({ raceId: race.id, entryId: entry.id,
          actorCredentialId: op.actorCredentialId, operationRequestId: op.requestId, startCheckinRevisionId: revisionId,
          operationalRevision: plan.revision, startCheckinDnsDecisionId: state.startCheckinDns.source.decision.id,
          withdrawnResultRevisionId: latest.id, withdrawnResultRevision: latest.revision,
          policyVersion: "start-checkin-dns-withdrawal-v1", withdrawnAt: now });
      }
    }
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "start_checkin_operation", entityId: op.requestId,
      requestId: op.requestId, action: "START_CHECKIN_OPERATION_STORED", actorId: op.actorCredentialId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      after: { deviceId: op.deviceId, entryId: entry.id, effect: receipt.effect }, createdAt: now });
    return { status: "stored" as const, response: receipt };
}
