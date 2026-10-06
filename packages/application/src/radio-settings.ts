import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  radioFetchResponseSchema, radioSettingsRequestSchema, radioSettingsResponseSchema, type RadioFetchResponse, type RadioSettingsResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { pollRadioRace, type RadioRuntime } from "./radio-ingest";

/**
 * Inställningar → Radiokontroller (ADR-0172 beslut 5): källa (ROC eller OResults), enhetens id, vilka
 * kontroller som är radiokontroller och på/av. Visar senaste hämtningen, antal stämplingar, okända brickor
 * och senaste fel. "Hämta nu" gör en hämtning direkt. Bara administratörer.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;
type Authentication = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
const capability = "MANAGE_RACE" as const;

/** Kontrollkoderna i tävlingens banor (även gafflingarnas varianter) med banornas namn. */
async function candidates(tx: Executor, raceId: string) {
  const rows = await tx.execute<{ code: number; course: string }>(sql`
    select distinct ctl.code as code, co.name as course
    from ${schema.classes} cl
    join ${schema.courseVersions} cv on cv.id = cl.course_version_id
    join ${schema.courses} co on co.id = cv.course_id
    join (
      select cc.course_version_id, cc.control_id from ${schema.courseControls} cc
      union
      select v.course_version_id, vc.control_id from ${schema.courseVariantControls} vc
        join ${schema.courseVariants} v on v.id = vc.course_variant_id
    ) used on used.course_version_id = cv.id
    join ${schema.controls} ctl on ctl.id = used.control_id
    where cl.race_id = ${raceId} and ctl.code between 1 and 9999
    order by ctl.code, co.name`);
  const byCode = new Map<number, string[]>();
  for (const row of rows.rows) byCode.set(Number(row.code), [...(byCode.get(Number(row.code)) ?? []), row.course]);
  return [...byCode.entries()].map(([code, courses]) => ({ code, courses: courses.slice(0, 500) })).slice(0, 2_000);
}

/** Inställningarna och läget som admin ser. */
export async function readRadioSettings(tx: Executor, raceId: string, now: Date): Promise<RadioSettingsResponse | undefined> {
  const [race] = await tx.select({ raceDate: schema.races.raceDate, timeZone: schema.events.timeZone })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const [[link], controls, choices, [relay]] = await Promise.all([
    tx.select().from(schema.raceRadioLinks).where(eq(schema.raceRadioLinks.raceId, raceId)),
    tx.select({ code: schema.raceRadioControls.controlCode, label: schema.raceRadioControls.label }).from(schema.raceRadioControls)
      .where(eq(schema.raceRadioControls.raceId, raceId)).orderBy(asc(schema.raceRadioControls.controlCode)),
    candidates(tx, raceId),
    tx.select({ leg: schema.relayLegs.leg }).from(schema.relayLegs).where(eq(schema.relayLegs.raceId, raceId)).limit(1)
  ]);
  let status: RadioSettingsResponse["status"] = null;
  let latest: RadioSettingsResponse["latest"] = [];
  if (link) {
    const codes = controls.map(control => control.code);
    const radioCode = codes.length ? sql`p.control_code in (${sql.join(codes.map(code => sql`${code}`), sql`, `)})` : sql`false`;
    const known = sql`exists (select 1 from ${schema.cardAssignments} a where a.race_id = p.race_id and a.active and a.card_number = p.card_number)`;
    const [counts] = (await tx.execute<{ punches: number; matched: number; unknown: number; other: number }>(sql`
      select count(*)::int as punches, count(*) filter (where ${known})::int as matched,
        count(*) filter (where not ${known})::int as unknown, count(*) filter (where not ${radioCode})::int as other
      from ${schema.radioPunches} p where p.race_id = ${raceId}`)).rows;
    const today = (await tx.execute<{ today: boolean }>(sql`select ${race.raceDate}::date =
      (${now.toISOString()}::timestamptz at time zone ${race.timeZone})::date as today`)).rows[0]?.today === true;
    status = { polling: !link.enabled ? "OFF" : today ? "TODAY" : "NOT_TODAY",
      lastAttemptAt: link.lastAttemptAt?.toISOString() ?? null, lastSuccessAt: link.lastSuccessAt?.toISOString() ?? null,
      lastError: link.lastError, lastErrorAt: link.lastErrorAt?.toISOString() ?? null, consecutiveFailures: link.consecutiveFailures,
      lastPunchId: link.lastPunchId, punches: counts?.punches ?? 0, matchedPunches: counts?.matched ?? 0,
      unknownCards: counts?.unknown ?? 0, otherControls: counts?.other ?? 0, malformedLines: link.malformedLines };
    // Senaste stämplingarna med löparen om brickan hör till en anmäld (bara för admin; bricknumret syns aldrig publikt).
    const rows = await tx.select({ controlCode: schema.radioPunches.controlCode, cardNumber: schema.radioPunches.cardNumber,
      punchedAt: schema.radioPunches.punchedAt, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
      className: schema.classes.name })
      .from(schema.radioPunches)
      .leftJoin(schema.cardAssignments, and(eq(schema.cardAssignments.raceId, schema.radioPunches.raceId),
        eq(schema.cardAssignments.cardNumber, schema.radioPunches.cardNumber), eq(schema.cardAssignments.active, true)))
      .leftJoin(schema.entries, eq(schema.entries.id, schema.cardAssignments.entryId))
      .leftJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
      .where(eq(schema.radioPunches.raceId, raceId))
      .orderBy(desc(schema.radioPunches.receivedAt), desc(schema.radioPunches.punchedAt)).limit(10);
    latest = rows.map(row => ({ controlCode: row.controlCode, cardNumber: row.cardNumber, punchedAt: row.punchedAt.toISOString(),
      runner: row.givenName === null ? null : `${row.givenName} ${row.familyName ?? ""}`.trim(), className: row.className }));
  }
  return radioSettingsResponseSchema.parse({ formatVersion: 1, raceId, raceDate: race.raceDate, timeZone: race.timeZone,
    link: link ? { source: link.source, unitId: link.unitId, enabled: link.enabled, controls } : null,
    status, candidates: choices, relay: relay !== undefined, latest });
}

export async function getRadioSettingsAsAdministrator(db: Database, input: Authentication, now = new Date())
  : Promise<Failure | { status: "ok"; response: RadioSettingsResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const response = await readRadioSettings(tx, auth.principal.raceId, now);
    return response ? { status: "ok" as const, response } : { status: "not-found" as const };
  });
}

/**
 * Sparar kopplingen och radiokontrollerna. Byte av källa eller enhet nollställer `lastId` och läget, så att
 * den nya enheten hämtas från början; sparade stämplingar finns kvar (de är oföränderliga).
 */
export async function saveRadioSettingsAsAdministrator(db: Database, input: Authentication & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: RadioSettingsResponse }> {
  const parsed = radioSettingsRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const [existing] = await tx.select().from(schema.raceRadioLinks).where(eq(schema.raceRadioLinks.raceId, raceId)).for("update");
    const changedUnit = !existing || existing.source !== request.source || existing.unitId !== request.unitId;
    const reset = changedUnit ? { lastPunchId: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null,
      consecutiveFailures: 0, malformedLines: 0 } : {};
    // Påslagen igen efter fel: försök direkt i stället för att vänta ut den längre väntan.
    const restart = existing && !existing.enabled && request.enabled ? { consecutiveFailures: 0, lastAttemptAt: null } : {};
    const values = { source: request.source, unitId: request.unitId, enabled: request.enabled, updatedAt: now, ...reset, ...restart };
    await tx.insert(schema.raceRadioLinks).values({ raceId, ...values })
      .onConflictDoUpdate({ target: schema.raceRadioLinks.raceId, set: values });
    await tx.delete(schema.raceRadioControls).where(eq(schema.raceRadioControls.raceId, raceId));
    if (request.controls.length > 0) {
      await tx.insert(schema.raceRadioControls).values(request.controls.map(control =>
        ({ raceId, controlCode: control.code, label: control.label })));
    }
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RADIO_SETTINGS_SAVED",
      actorKind: auth.principal.account ? "USER_ACCOUNT" : "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.account?.accountId ?? auth.principal.accessCredentialId,
      before: existing ? { source: existing.source, unitId: existing.unitId, enabled: existing.enabled } : null,
      after: { source: request.source, unitId: request.unitId, enabled: request.enabled,
        controls: request.controls.map(control => control.code) }, createdAt: now });
    const response = await readRadioSettings(tx, raceId, now);
    return response ? { status: "ok" as const, response } : { status: "not-found" as const };
  });
}

/** "Hämta nu": en hämtning direkt, oavsett dag och väntan efter fel. */
export async function fetchRadioNowAsAdministrator(db: Database, input: Authentication, runtime: RadioRuntime, now = new Date())
  : Promise<Failure | { status: "ok"; response: RadioFetchResponse }> {
  const auth = await authenticatePairingAdminSession(db, { ...input, capability, requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  const raceId = auth.principal.raceId;
  const outcome = await pollRadioRace(db, raceId, runtime, now);
  const settings = await db.transaction(tx => readRadioSettings(tx, raceId, now));
  if (!settings) return { status: "not-found" };
  return { status: "ok", response: radioFetchResponseSchema.parse({ formatVersion: 1, raceId,
    outcome: outcome.status === "fetched" || outcome.status === "superseded" ? "FETCHED"
      : outcome.status === "not-configured" ? "NOT_CONFIGURED" : outcome.error,
    newPunches: outcome.status === "fetched" ? outcome.newPunches : 0, settings }) };
}
