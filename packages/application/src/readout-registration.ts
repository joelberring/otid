import { and, count, eq, isNull, sql } from "drizzle-orm";
import {
  readoutRegistrationIdempotencyKeySchema, readoutRegistrationRequestSchema, readoutRegistrationResponseSchema,
  type ReadoutExistingEntryRequest, type ReadoutRegistrationResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { canAddClassEntry } from "./class-capacity-guard";
import { bumpReadoutPackageVersion } from "./snapshot";
import { normalizedReadout } from "./result-revisions";
import { cardAlreadyReadOutBy } from "./card-reuse";
import { assignCard, linkUnresolvedReadout } from "./card-assignment";
import { latestResultReadAt, latestUnresolvedReadout } from "./readout-lookup";
import { directEntryStartTime } from "./start-draw-basis";

export { latestResultReadAt, latestUnresolvedReadout, readoutsWithResults } from "./readout-lookup";

/**
 * PLAN.md steg 25: direktanmälan av en okänd bricka från avläsningssidan, även offline (köad i webbläsaren).
 *
 * - Brickan har redan en aktiv koppling (anmäld någon annanstans under tiden): ingen ny deltagare; svaret säger vem
 *   brickan hör till (EXISTING). Annars skapas deltagaren och brickkopplingen (CREATED). En stafettklass eller en full
 *   klass avvisas.
 * - Ordningen mot avläsningen spelar ingen roll: kommer avläsningen efter anmälan bedöms den som vanligt när den tas
 *   emot. Har servern redan avläsningen som okänd bricka bedöms den senaste sådana här, mot deltagaren, om deltagaren
 *   inte redan har ett resultat från en senare avläsning.
 * - Idempotent på begärans id: samma begäran ger samma kvitto. Journalen (`readout_registration`) skrivs aldrig om.
 */
type Authentication = RaceSessionProof;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ReadoutRegistrationResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "registered"; response: ReadoutRegistrationResponse };

export async function registerReadoutCard(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<ReadoutRegistrationResult> {
  const parsed = readoutRegistrationRequestSchema.safeParse(input.request);
  const key = readoutRegistrationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `readout-registration:${parsed.data.requestId}`) return { status: "invalid-request" };
  const intent = parsed.data;
  const registeredAt = new Date(now);
  if (!Number.isFinite(registeredAt.getTime())) throw new Error("Anmälningstiden är ogiltig");
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, registeredAt, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"readout-registration:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.readoutRegistrations).where(eq(schema.readoutRegistrations.requestId, intent.requestId));
    if (prior) {
      if (prior.raceId !== raceId || prior.actorAccountId !== auth.principal.accountId ||
        JSON.stringify(readoutRegistrationRequestSchema.parse(prior.request)) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "registered", response: readoutRegistrationResponseSchema.parse({ ...prior.response, replayed: true }) };
    }
    await lockRaceForMutation(tx, raceId);
    const linking = "target" in intent;
    let raceClass: { id: string; name: string } | undefined;
    if (!linking) {
      [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
        .where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, raceId)));
      if (!raceClass) return { status: "not-found" };
    }

    let [owner] = await tx.select({ id: schema.cardAssignments.id, entryId: schema.cardAssignments.entryId }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, intent.cardNumber),
        eq(schema.cardAssignments.active, true))).limit(1);
    // Steg 31 (B4): brickans deltagare har redan ett resultat från en annan avläsning av brickan (lånad bricka). Den
    // förstes resultat skrivs aldrig över. Med `borrowedCard` flyttas brickan till den nya eller valda deltagaren; är det
    // samma deltagare gäller den nya avläsningen. Utan valet lämnas avläsningen okänd.
    const unresolved = owner ? await latestUnresolvedReadout(tx, raceId, intent.cardNumber) : undefined;
    const borrowedFrom = owner && unresolved ? await cardAlreadyReadOutBy(tx, owner.entryId, normalizedReadout(unresolved)) : undefined;
    const sameRunner = borrowedFrom !== undefined && linking && intent.entryId === borrowedFrom;
    if (borrowedFrom && intent.borrowedCard && !sameRunner && owner) {
      await tx.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.id, owner.id));
      owner = undefined;
    }
    let entry: { id: string; givenName: string; familyName: string; classId: string; organisationName: string | null };
    let outcome: "CREATED" | "EXISTING" | "LINKED";
    const entryColumns = { id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
      classId: schema.entries.classId, organisationName: schema.entries.organisationName };
    if (owner) {
      // Anmäld någon annanstans under tiden: den deltagaren gäller, ingen ny deltagare skapas.
      const [existing] = await tx.select(entryColumns).from(schema.entries)
        .where(and(eq(schema.entries.id, owner.entryId), eq(schema.entries.raceId, raceId))).for("update");
      if (!existing) throw new Error("Brickans deltagare saknas");
      entry = existing; outcome = linking && owner.entryId === intent.entryId ? "LINKED" : "EXISTING";
    } else if (linking) {
      // PLAN.md steg 29: koppla brickan till en anmäld deltagare utan bricka eller utan avläsning (funktionären väljer).
      const linked = await linkExistingEntry(tx, raceId, intent);
      if (linked.status !== "linked") return linked;
      entry = linked.entry; outcome = "LINKED";
    } else {
      if (!await canAddClassEntry(tx, raceId, intent.classId)) return { status: "conflict" };
      const [total] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, raceId));
      if (!total || total.value >= 10_000) return { status: "conflict" };
      // Ur löpardatabasen: Eventors id för personen och klubben följer med till IOF-exporten. En klass med masstart ger
      // masstartens tid (användartestet 2026-11-12); vid minutstart gäller startstämplingen.
      const fixedStartTime = await directEntryStartTime(tx, raceId, intent.classId);
      const [created] = await tx.insert(schema.entries).values({ raceId, classId: intent.classId, givenName: intent.givenName,
        familyName: intent.familyName, organisationName: intent.organisationName, version: 1, fixedStartTime,
        eventorPersonId: intent.eventorPersonId ?? null, eventorOrganisationId: intent.eventorOrganisationId ?? null })
        .returning(entryColumns);
      if (!created) throw new Error("Deltagaren kunde inte sparas");
      await assignCard(tx, { raceId, entryId: created.id, cardNumber: intent.cardNumber });
      entry = created; outcome = "CREATED";
    }
    await bumpReadoutPackageVersion(tx, raceId);

    // Har servern redan brickans avläsning som okänd bedöms den nu, om den är nyare än deltagarens senaste resultat
    // (samma regel som Byt bricka och Ny deltagare, `card-assignment.ts`).
    const keepsFirst = borrowedFrom !== undefined && entry.id === borrowedFrom && !(sameRunner && intent.borrowedCard);
    const linked = keepsFirst ? null : await linkUnresolvedReadout(tx, { raceId, entryId: entry.id, cardNumber: intent.cardNumber,
      actorAccountId: auth.principal.accountId, detectVariant: outcome !== "EXISTING", force: sameRunner });
    const linkedResult = linked ? { status: linked.status, revision: linked.revision } : null;
    const [className] = outcome !== "CREATED" || !raceClass ? await tx.select({ name: schema.classes.name }).from(schema.classes)
      .where(eq(schema.classes.id, entry.classId)) : [raceClass];
    if (!className) throw new Error("Deltagarens klass saknas");
    const response = readoutRegistrationResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      cardNumber: intent.cardNumber, outcome, entryId: entry.id, entryName: `${entry.givenName} ${entry.familyName}`,
      className: className.name, linkedResult, registeredAt: registeredAt.toISOString() });
    await tx.insert(schema.readoutRegistrations).values({ requestId: intent.requestId, raceId, cardNumber: intent.cardNumber,
      classId: entry.classId, givenName: entry.givenName, familyName: entry.familyName, organisationName: entry.organisationName,
      outcome, entryId: entry.id, actorAccountId: auth.principal.accountId, request: intent, response, createdAt: registeredAt });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "entry", entityId: entry.id, requestId: intent.requestId,
      action: outcome === "CREATED" ? "READOUT_CARD_REGISTERED" : outcome === "LINKED" ? "READOUT_CARD_LINKED"
        : "READOUT_CARD_ALREADY_REGISTERED", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, before: null,
      after: { cardNumber: intent.cardNumber, classId: entry.classId, outcome, linkedRevision: linkedResult?.revision ?? null,
        ...(borrowedFrom ? { alreadyReadOutBy: borrowedFrom, borrowedCard: intent.borrowedCard ?? false } : {}) },
      createdAt: registeredAt });
    return { status: "registered", response };
  });
}

/**
 * Kopplar brickan till en anmäld deltagare (PLAN.md steg 29): deltagaren måste finnas i loppet, inte vara struken, inte
 * vara sträcklöpare, ha samma klass som i paketet och sakna resultat från en avläsning. Deltagarens tidigare bricka
 * släpps (kopplingen ligger kvar som inaktiv) och deltagarens version höjs.
 */
async function linkExistingEntry(tx: Transaction, raceId: string, intent: ReadoutExistingEntryRequest) {
  const [target] = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    classId: schema.entries.classId, organisationName: schema.entries.organisationName, teamId: schema.entries.teamId,
    version: schema.entries.version }).from(schema.entries)
    .where(and(eq(schema.entries.id, intent.entryId), eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt))).for("update");
  if (!target) return { status: "not-found" as const };
  if (target.classId !== intent.expectedClassId || target.teamId !== null || target.version >= 2_147_483_647) return { status: "conflict" as const };
  if (await latestResultReadAt(tx, target.id) !== null) return { status: "conflict" as const };
  await assignCard(tx, { raceId, entryId: target.id, cardNumber: intent.cardNumber });
  await tx.update(schema.entries).set({ version: target.version + 1 }).where(eq(schema.entries.id, target.id));
  return { status: "linked" as const, entry: { id: target.id, givenName: target.givenName, familyName: target.familyName,
    classId: target.classId, organisationName: target.organisationName } };
}

