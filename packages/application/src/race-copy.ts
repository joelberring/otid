import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { raceCopyRequestSchema, raceCopyResponseSchema, type RaceCopyResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForSnapshot } from "./concurrency";
import { activeEventAdministrationGrant } from "./organizer-events";
import { authenticateUserAccountSessionForMutation, type UserAccountSessionProof } from "./user-account";

/**
 * "Ny tävling som …" (PLAN.md steg 21). Kopierar tävlingen till ett nytt event med ett lopp i en transaktion:
 * tävlingstyp och tidszon, kontroller (med poäng), banor med alla versioner och varianter som nya rader, klasser
 * (startsätt, maxantal, rogaining) kopplade till kopians banversioner, stafettens sträckor (starttider flyttas till
 * det nya datumet med samma klockslag), kartan med georeferens (inte rutterna) och radiokontrollerna (kopplingen
 * avstängd tills admin slår på den). Den som kopierar blir ägare; med `includePeople` följer övriga administratörer
 * (källans ägare blir administratör) och funktionärer med.
 *
 * Följer inte med: deltagare, lag, lottning och starttider, avläsningar, resultat och beslut, radiostämplingar,
 * Eventor-kopplingen (klassernas Eventor-id tas bort så att en ny koppling matchar på namn), publiceringen
 * (kopian är opublicerad och får en ny kort adress) och journaler. Bara ägare och administratörer av källan får
 * kopiera; källan låses för ändringar under kopieringen så att kopian blir en hel bild.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
export type RaceCopyResult = Failure | { status: "copied"; response: RaceCopyResponse };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Rader per INSERT, långt under PostgreSQL:s gräns för parametrar. */
const CHUNK = 500;

async function insertChunked<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < rows.length; index += CHUNK) await insert(rows.slice(index, index + CHUNK));
}

function mapped(map: ReadonlyMap<string, string>, id: string): string {
  const value = map.get(id);
  if (!value) throw new Error("Kopian saknar en rad som källan pekar på");
  return value;
}

export async function copyRaceAsUserAccount(db: Database, input: UserAccountSessionProof & { raceId: string; request: unknown },
  now = new Date()): Promise<RaceCopyResult> {
  const parsed = raceCopyRequestSchema.safeParse(input.request);
  if (!parsed.success || !UUID.test(input.raceId)) return { status: "invalid-request" };
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"race-copy:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.raceCopyRequests).where(eq(schema.raceCopyRequests.requestId, intent.requestId));
    if (prior) {
      const stored = raceCopyRequestSchema.parse(prior.request);
      // jsonb ordnar om nycklarna, så fälten jämförs ett och ett.
      const same = (Object.keys(intent) as (keyof typeof intent)[]).every(key => stored[key] === intent[key]);
      if (prior.actorAccountId !== accountId || prior.sourceRaceId !== input.raceId || !same) return { status: "conflict" } as const;
      return { status: "copied", response: { ...raceCopyResponseSchema.parse(prior.response), replayed: true } } as const;
    }
    const [source] = await tx.select({ id: schema.races.id, eventId: schema.races.eventId, raceDate: schema.races.raceDate,
      raceType: schema.races.raceType, hidden: schema.races.hiddenBySuperadmin, timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.raceId));
    if (!source) return { status: "not-found" } as const;
    const grant = await activeEventAdministrationGrant(tx, { accountId, eventId: source.eventId,
      roles: ["OWNER", "ADMIN", "FUNCTIONARY"] }, "share");
    if (!grant) return { status: "not-found" } as const;
    if (grant.role === "FUNCTIONARY") return { status: "forbidden" } as const;
    await lockRaceForSnapshot(tx, source.id);

    const [event] = await tx.insert(schema.events).values({ name: intent.eventName, startsOn: intent.raceDate,
      timeZone: source.timeZone, createdAt: now }).returning({ id: schema.events.id });
    if (!event) throw new Error("Eventet kunde inte skapas");
    // Superadminens döljning följer med, så att en kopia inte kringgår den.
    const [race] = await tx.insert(schema.races).values({ eventId: event.id, name: intent.raceName, raceDate: intent.raceDate,
      raceType: source.raceType, hiddenBySuperadmin: source.hidden, snapshotVersion: 1, createdAt: now })
      .returning({ id: schema.races.id });
    if (!race) throw new Error("Loppet kunde inte skapas");

    const content = await copyRaceContent(tx, { sourceRaceId: source.id, raceId: race.id, timeZone: source.timeZone,
      dayShift: Math.round((Date.parse(intent.raceDate) - Date.parse(source.raceDate)) / DAY_MS), now });
    const people = await copyPeople(tx, { sourceEventId: source.eventId, eventId: event.id, accountId, include: intent.includePeople, now });
    const [eventor] = await tx.select({ raceId: schema.raceEventorLinks.raceId }).from(schema.raceEventorLinks)
      .where(eq(schema.raceEventorLinks.raceId, source.id));

    const response = raceCopyResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId,
      sourceRaceId: source.id, eventId: event.id, raceId: race.id, copied: { ...content, people, eventorNotCopied: !!eventor },
      createdAt: now.toISOString() });
    await tx.insert(schema.raceCopyRequests).values({ requestId: intent.requestId, actorAccountId: accountId, sourceRaceId: source.id,
      eventId: event.id, raceId: race.id, request: intent as unknown as Record<string, unknown>,
      response: response as unknown as Record<string, unknown>, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "race", entityId: race.id, action: "RACE_COPIED_BY_ACCOUNT",
      actorKind: "USER_ACCOUNT", actorId: accountId, requestId: intent.requestId,
      after: { sourceRaceId: source.id, eventId: event.id, raceId: race.id, eventName: intent.eventName, raceName: intent.raceName,
        raceDate: intent.raceDate, raceType: source.raceType, includePeople: intent.includePeople, copied: response.copied,
        snapshotVersion: 1, createdAt: now.toISOString() }, createdAt: now });
    return { status: "copied", response } as const;
  });
}

interface ContentInput { sourceRaceId: string; raceId: string; timeZone: string; dayShift: number; now: Date }

/** Kontroller, banor (versioner, kontrollföljd, varianter), klasser, sträckor, karta och radiokontroller som nya rader. */
async function copyRaceContent(tx: Transaction, input: ContentInput) {
  const { sourceRaceId, raceId, now } = input;
  const controls = await tx.select().from(schema.controls).where(eq(schema.controls.raceId, sourceRaceId)).orderBy(asc(schema.controls.code));
  const controlIds = new Map(controls.map(control => [control.id, randomUUID()]));
  await insertChunked(controls, chunk => tx.insert(schema.controls).values(chunk.map(control => ({ id: mapped(controlIds, control.id), raceId,
    code: control.code, kind: control.kind, points: control.points, createdAt: now }))));

  const courses = await tx.select().from(schema.courses).where(eq(schema.courses.raceId, sourceRaceId)).orderBy(asc(schema.courses.createdAt));
  const courseIds = new Map(courses.map(course => [course.id, randomUUID()]));
  await insertChunked(courses, chunk => tx.insert(schema.courses).values(chunk.map(course => ({ id: mapped(courseIds, course.id), raceId,
    name: course.name, externalSource: course.externalSource, externalId: course.externalId, createdAt: now }))));

  const versions = courses.length === 0 ? [] : await tx.select().from(schema.courseVersions)
    .where(inArray(schema.courseVersions.courseId, [...courseIds.keys()])).orderBy(asc(schema.courseVersions.version));
  const versionIds = new Map(versions.map(version => [version.id, randomUUID()]));
  await insertChunked(versions, chunk => tx.insert(schema.courseVersions).values(chunk.map(version => ({ id: mapped(versionIds, version.id),
    courseId: mapped(courseIds, version.courseId), version: version.version, createdAt: now }))));

  const courseControls = versions.length === 0 ? [] : await tx.select().from(schema.courseControls)
    .where(inArray(schema.courseControls.courseVersionId, [...versionIds.keys()]));
  await insertChunked(courseControls, chunk => tx.insert(schema.courseControls).values(chunk.map(row => ({ id: randomUUID(),
    courseVersionId: mapped(versionIds, row.courseVersionId), controlId: mapped(controlIds, row.controlId), sequence: row.sequence }))));

  const variants = versions.length === 0 ? [] : await tx.select().from(schema.courseVariants)
    .where(inArray(schema.courseVariants.courseVersionId, [...versionIds.keys()]));
  const variantIds = new Map(variants.map(variant => [variant.id, randomUUID()]));
  await insertChunked(variants, chunk => tx.insert(schema.courseVariants).values(chunk.map(variant => ({ id: mapped(variantIds, variant.id),
    courseVersionId: mapped(versionIds, variant.courseVersionId), code: variant.code, sequence: variant.sequence }))));
  const variantControls = variants.length === 0 ? [] : await tx.select().from(schema.courseVariantControls)
    .where(inArray(schema.courseVariantControls.courseVariantId, [...variantIds.keys()]));
  await insertChunked(variantControls, chunk => tx.insert(schema.courseVariantControls).values(chunk.map(row => ({ id: randomUUID(),
    courseVariantId: mapped(variantIds, row.courseVariantId), controlId: mapped(controlIds, row.controlId), sequence: row.sequence }))));

  const classes = await tx.select().from(schema.classes).where(eq(schema.classes.raceId, sourceRaceId)).orderBy(asc(schema.classes.createdAt));
  const classIds = new Map(classes.map(raceClass => [raceClass.id, randomUUID()]));
  // Eventors klass-id hör till källans Eventor-event; utan dem matchar en ny koppling klasserna på namn.
  await insertChunked(classes, chunk => tx.insert(schema.classes).values(chunk.map(raceClass => {
    const external = raceClass.externalSource === "eventor" ? { externalSource: null, externalId: null }
      : { externalSource: raceClass.externalSource, externalId: raceClass.externalId };
    return { id: mapped(classIds, raceClass.id), raceId, name: raceClass.name, courseVersionId: mapped(versionIds, raceClass.courseVersionId),
      startRule: raceClass.startRule, maxEntries: raceClass.maxEntries, capacityVersion: 1, startDrawId: null,
      rogainingTimeLimitSeconds: raceClass.rogainingTimeLimitSeconds, rogainingPenaltyPointsPerMinute: raceClass.rogainingPenaltyPointsPerMinute,
      ...external, createdAt: now };
  })));

  const legs = await tx.select().from(schema.relayLegs).where(eq(schema.relayLegs.raceId, sourceRaceId))
    .orderBy(asc(schema.relayLegs.classId), asc(schema.relayLegs.leg));
  for (const leg of legs) {
    await tx.insert(schema.relayLegs).values({ classId: mapped(classIds, leg.classId), raceId, leg: leg.leg, startMethod: leg.startMethod,
      startTime: leg.startTime ? await shiftWallClock(tx, leg.startTime, input.timeZone, input.dayShift) : null,
      courseVariantCode: leg.courseVariantCode });
  }

  // Kartbilden kopieras i databasen utan att gå via appen. Rutterna hör till löparna och följer inte med.
  const map = await tx.execute(sql`insert into race_map (race_id, file_name, media_type, image, sha256, byte_length, width, height,
      tie_points, transform, uploaded_at, georeferenced_at)
    select ${raceId}, file_name, media_type, image, sha256, byte_length, width, height, tie_points, transform, ${now},
      case when georeferenced_at is null then null else ${now}::timestamptz end
    from race_map where race_id = ${sourceRaceId}`);

  const [radio] = await tx.select().from(schema.raceRadioLinks).where(eq(schema.raceRadioLinks.raceId, sourceRaceId));
  if (radio) await tx.insert(schema.raceRadioLinks).values({ raceId, source: radio.source, unitId: radio.unitId, enabled: false, updatedAt: now });
  const radioControls = await tx.select().from(schema.raceRadioControls).where(eq(schema.raceRadioControls.raceId, sourceRaceId));
  if (radioControls.length > 0) await tx.insert(schema.raceRadioControls).values(radioControls.map(row => ({ ...row, raceId })));

  return { courses: courses.length, classes: classes.length, controls: controls.length, relayLegs: legs.length,
    radioControls: radioControls.length, map: (map.rowCount ?? 0) > 0 };
}

/** Samma klockslag i tävlingens tidszon, `days` dagar senare (även över sommartidsskiftet). */
async function shiftWallClock(tx: Transaction, instant: Date, timeZone: string, days: number): Promise<Date> {
  const result = await tx.execute<{ shifted_ms: number }>(sql`select (extract(epoch from ((${instant.toISOString()}::timestamptz
    at time zone ${timeZone}) + make_interval(days => ${days}::int)) at time zone ${timeZone}) * 1000)::float8 as shifted_ms`);
  const shifted = result.rows[0]?.shifted_ms;
  if (typeof shifted !== "number" || !Number.isFinite(shifted)) throw new Error("Starttiden kunde inte flyttas");
  return new Date(shifted);
}

/**
 * Den som kopierar blir ägare. Med `include` får källans övriga administratörer (även ägaren) rollen administratör
 * och funktionärerna rollen funktionär. Borttagna behörigheter och spärrade konton följer inte med.
 */
async function copyPeople(tx: Transaction, input: { sourceEventId: string; eventId: string; accountId: string; include: boolean; now: Date }):
  Promise<number> {
  await tx.insert(schema.eventAdministrationGrants).values({ eventId: input.eventId, accountId: input.accountId, role: "OWNER", grantedAt: input.now });
  if (!input.include) return 0;
  const rows = await tx.select({ accountId: schema.eventAdministrationGrants.accountId, role: schema.eventAdministrationGrants.role })
    .from(schema.eventAdministrationGrants)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.eventAdministrationGrants.accountId))
    .leftJoin(schema.eventAdministrationGrantRevocations,
      eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
    .where(and(eq(schema.eventAdministrationGrants.eventId, input.sourceEventId), isNull(schema.eventAdministrationGrantRevocations.id),
      isNull(schema.userAccounts.blockedAt)))
    .orderBy(asc(schema.eventAdministrationGrants.grantedAt), asc(schema.eventAdministrationGrants.id));
  // Den starkaste rollen per konto (ägare/administratör före funktionär).
  const roles = new Map<string, "ADMIN" | "FUNCTIONARY">();
  for (const row of rows) {
    if (row.accountId === input.accountId) continue;
    const role = row.role === "FUNCTIONARY" ? "FUNCTIONARY" : "ADMIN";
    if (roles.get(row.accountId) !== "ADMIN") roles.set(row.accountId, role);
  }
  const grants = [...roles].map(([accountId, role]) => ({ eventId: input.eventId, accountId, role, grantedAt: input.now }));
  if (grants.length > 0) await tx.insert(schema.eventAdministrationGrants).values(grants);
  return grants.length;
}

