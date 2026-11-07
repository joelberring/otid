import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { groupSessionCreateRequestSchema, type GroupSessionCreateRequest, type MapAgreementIssueCode } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { mapAgreementIssues, repetitionDates } from "@o-tid/domain";
import { lockRaceForSnapshot } from "./concurrency";
import { copyRaceContent } from "./race-copy";
import { purgeRows } from "./purge";
import { applyLibraryMapToRace, libraryMap, raceMapAgreement } from "./training-group-maps";
import { groupToday, requireGroupLeader, type GroupFailure, type GroupTransaction as Transaction } from "./training-groups";
import { UUID_PATTERN } from "./serialization";
import type { UserAccountSessionProof } from "./user-account";

/**
 * Steg 68 (ADR-0182 beslut 3): ny träning ur gruppens mall, förra tillfället eller en vald tävling i gruppen – med klasser,
 * banor, kartan och tidtagningens inställningar (`copyRaceContent` från "Ny tävling som …" och loppets inställningar) – och
 * upprepningen, som skapar alla tillfällen i förväg. Tillfällena har inga egna administratörer: gruppens ledare är ADMIN.
 * "Ångra" tar bort de framtida tillfällena som ingen anmält sig till och som inte har några avläsningar.
 */
type Proof = UserAccountSessionProof;
const DAY_MS = 86_400_000;

export type GroupSessionsResult = GroupFailure
  | { status: "agreement"; issues: MapAgreementIssueCode[] }
  | { status: "created"; replayed: boolean; raceIds: string[]; seriesId: string | null };

/** Källan: vald tävling i gruppen, gruppens mall eller förra tillfället (före det nya datumet, annars det senaste). */
async function sourceRace(tx: Transaction, groupId: string, intent: GroupSessionCreateRequest) {
  const inGroup = async (raceId: string | null) => {
    if (!raceId) return undefined;
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(and(eq(schema.races.id, raceId), eq(schema.events.trainingGroupId, groupId)));
    return race?.id;
  };
  if (intent.source === "RACE") return { found: !!await inGroup(intent.sourceRaceId), raceId: await inGroup(intent.sourceRaceId) };
  if (intent.source === "TEMPLATE") {
    const [group] = await tx.select({ templateRaceId: schema.trainingGroups.templateRaceId }).from(schema.trainingGroups)
      .where(eq(schema.trainingGroups.id, groupId));
    const template = await inGroup(group?.templateRaceId ?? null);
    if (template) return { found: true, raceId: template };
  }
  const previous = async (before: boolean) => (await tx.select({ id: schema.races.id }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(and(eq(schema.events.trainingGroupId, groupId), before ? lte(schema.races.raceDate, intent.raceDate) : undefined))
    .orderBy(desc(schema.races.raceDate), desc(schema.races.createdAt)).limit(1))[0]?.id;
  // Den första träningen i en grupp utan tidigare tillfällen blir en tom träning.
  return { found: true, raceId: await previous(true) ?? await previous(false) };
}

export async function createGroupSessions(db: Database, input: Proof & { groupId: string; request: unknown }, now = new Date())
  : Promise<GroupSessionsResult> {
  const parsed = groupSessionCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    const intent = parsed.data;
    const dates = intent.repeat ? repetitionDates({ weekday: intent.repeat.weekday, firstDate: intent.raceDate, lastDate: intent.repeat.lastDate })
      : [intent.raceDate];
    if (!dates || dates.length === 0) return { status: "invalid-request" } as const;
    const accountId = leader.accountId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"training-group-sessions:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.trainingGroupRequests).where(eq(schema.trainingGroupRequests.requestId, intent.requestId));
    if (prior) {
      if (prior.groupId !== input.groupId || prior.actorAccountId !== accountId || JSON.stringify(sorted(prior.request)) !== JSON.stringify(sorted(intent))) {
        return { status: "conflict" } as const;
      }
      const response = prior.response as { raceIds: string[]; seriesId: string | null };
      return { status: "created", replayed: true, raceIds: response.raceIds, seriesId: response.seriesId } as const;
    }
    const source = await sourceRace(tx, input.groupId, intent);
    if (!source.found) return { status: "not-found" } as const;
    const map = intent.mapId ? await libraryMap(tx, input.groupId, intent.mapId) : undefined;
    if (intent.mapId && !map) return { status: "not-found" } as const;

    const [facts] = source.raceId ? await tx.select({ raceType: schema.races.raceType, raceDate: schema.races.raceDate, timeZone: schema.events.timeZone,
      hidden: schema.races.hiddenBySuperadmin, courseMapScale: schema.races.courseMapScale, info: schema.races.info,
      firstStartTime: schema.races.firstStartTime, selfRegistration: schema.races.selfRegistration, startListLive: schema.races.startListLive,
      cardNumbers: schema.races.publicStartListCardNumbers, mapReserve: schema.races.mapReserve, startDrawSettings: schema.races.startDrawSettings })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, source.raceId)) : [];
    const raceType = facts?.raceType ?? "TRAINING";

    // Kartans avtal (beslut 4): ett utgånget avtal eller "bara träning" för en tävling säger till innan något skapas.
    const agreement = map?.agreement ?? (source.raceId ? await raceMapAgreement(tx, source.raceId) : null);
    if (agreement) {
      const issues = [...new Set(dates.flatMap(date => mapAgreementIssues({ ...agreement, validUntil: agreement.validUntil }, { date, raceType })))]
        .filter(issue => issue === "EXPIRED" || issue === "TRAINING_ONLY");
      if (issues.length > 0 && !intent.acknowledgeAgreement) return { status: "agreement", issues } as const;
    }
    if (source.raceId) await lockRaceForSnapshot(tx, source.raceId);

    const seriesId = intent.repeat ? randomUUID() : null;
    if (seriesId && intent.repeat) {
      await tx.insert(schema.trainingGroupSeries).values({ id: seriesId, groupId: input.groupId, sourceRaceId: source.raceId ?? randomUUID(),
        weekday: intent.repeat.weekday, startTime: intent.startTime ?? facts?.firstStartTime ?? "18:00", firstDate: dates[0]!,
        lastDate: dates[dates.length - 1]!, createdAt: now, createdBy: accountId, requestId: intent.requestId });
    }
    const raceIds: string[] = [];
    for (const date of dates) {
      const [event] = await tx.insert(schema.events).values({ name: intent.eventName, startsOn: date, timeZone: facts?.timeZone ?? "Europe/Stockholm",
        trainingGroupId: input.groupId, trainingGroupSeriesId: seriesId, createdAt: now }).returning({ id: schema.events.id });
      if (!event) throw new Error("Evenemanget kunde inte skapas");
      const [race] = await tx.insert(schema.races).values({ eventId: event.id, name: "", raceDate: date, raceType,
        hiddenBySuperadmin: facts?.hidden ?? false, courseMapScale: facts?.courseMapScale ?? null, snapshotVersion: 1,
        info: facts?.info ?? null, firstStartTime: intent.startTime ?? facts?.firstStartTime ?? null,
        selfRegistration: facts?.selfRegistration ?? false, startListLive: facts?.startListLive ?? false,
        publicStartListCardNumbers: facts?.cardNumbers ?? true, mapReserve: facts?.mapReserve ?? null,
        startDrawSettings: facts?.startDrawSettings ?? null, publishedAt: intent.publish ? now : null, createdAt: now })
        .returning({ id: schema.races.id });
      if (!race) throw new Error("Träningen kunde inte skapas");
      if (source.raceId && facts) {
        await copyRaceContent(tx, { sourceRaceId: source.raceId, raceId: race.id, timeZone: facts.timeZone,
          dayShift: Math.round((Date.parse(date) - Date.parse(facts.raceDate)) / DAY_MS), now, accountId, includePeople: false });
      }
      if (map) await applyLibraryMapToRace(tx, { mapId: map.mapId, groupId: input.groupId, raceId: race.id,
        includeCourseSetting: intent.includeCourseSetting, accountId, now });
      await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "race", entityId: race.id, action: "TRAINING_GROUP_SESSION_CREATED",
        actorKind: "USER_ACCOUNT", actorId: accountId, requestId: raceIds.length === 0 ? intent.requestId : null,
        after: { groupId: input.groupId, seriesId, sourceRaceId: source.raceId ?? null, mapId: intent.mapId, raceDate: date,
          published: intent.publish, acknowledgedAgreement: intent.acknowledgeAgreement }, createdAt: now });
      raceIds.push(race.id);
    }
    await tx.insert(schema.trainingGroupRequests).values({ requestId: intent.requestId, groupId: input.groupId, actorAccountId: accountId,
      kind: "SESSIONS", request: sorted(intent), response: { raceIds, seriesId }, createdAt: now });
    return { status: "created", replayed: false, raceIds, seriesId } as const;
  });
}

/** jsonb ordnar om nycklarna; begäran sparas och jämförs med sorterade nycklar. */
function sorted(value: GroupSessionCreateRequest | Record<string, unknown>): Record<string, unknown> {
  const order = (item: unknown): unknown => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, order(field)]))
    : item;
  return order(value) as Record<string, unknown>;
}

/** Tillfällen utan anmälda och utan avläsningar (sådana kan tas bort utan att något försvinner). */
async function untouched(tx: Transaction, raceIds: readonly string[]): Promise<Set<string>> {
  if (raceIds.length === 0) return new Set();
  const used = [...await tx.selectDistinct({ raceId: schema.entries.raceId }).from(schema.entries).where(inArray(schema.entries.raceId, [...raceIds])),
    ...await tx.selectDistinct({ raceId: schema.rawDeviceMessages.raceId }).from(schema.rawDeviceMessages)
      .where(inArray(schema.rawDeviceMessages.raceId, [...raceIds]))];
  const touched = new Set(used.map(row => row.raceId));
  return new Set(raceIds.filter(id => !touched.has(id)));
}

/**
 * Ångra upprepningen: de framtida tillfällena (från och med i dag) som är orörda tas bort med allt som hör till dem;
 * tillfällen som redan har anmälda eller avläsningar, och de som varit, står kvar.
 */
export async function undoGroupSeries(db: Database, input: Proof & { groupId: string; seriesId: string }, now = new Date())
  : Promise<GroupFailure | { status: "undone"; removed: number; kept: number }> {
  if (!UUID_PATTERN.test(input.seriesId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    const [series] = await tx.select().from(schema.trainingGroupSeries).where(and(eq(schema.trainingGroupSeries.id, input.seriesId),
      eq(schema.trainingGroupSeries.groupId, input.groupId))).for("update");
    if (!series) return { status: "not-found" } as const;
    const { today } = await groupToday(tx, input.groupId, now);
    const sessions = await tx.select({ raceId: schema.races.id, eventId: schema.events.id, raceDate: schema.races.raceDate }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(and(eq(schema.events.trainingGroupSeriesId, series.id), eq(schema.events.trainingGroupId, input.groupId)));
    const future = sessions.filter(row => row.raceDate >= today);
    const removable = await untouched(tx, future.map(row => row.raceId));
    const events = [...new Set(future.filter(row => removable.has(row.raceId)).map(row => row.eventId))];
    await purgeRows(tx, "event", events);
    if (!series.undoneAt) await tx.update(schema.trainingGroupSeries).set({ undoneAt: now, undoneBy: leader.accountId })
      .where(eq(schema.trainingGroupSeries.id, series.id));
    return { status: "undone", removed: removable.size, kept: sessions.length - removable.size } as const;
  });
}

/** Ett enskilt tillfälle tas bort av en ledare, bara när det är orört (inga anmälda, inga avläsningar). */
export async function removeGroupSession(db: Database, input: Proof & { groupId: string; raceId: string }, now = new Date())
  : Promise<GroupFailure | { status: "removed" }> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    const [race] = await tx.select({ eventId: schema.events.id }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(and(eq(schema.races.id, input.raceId), eq(schema.events.trainingGroupId, input.groupId)));
    if (!race) return { status: "not-found" } as const;
    // Ett evenemang med egna administratörer (en tillagd tävling) tas inte bort här, bara tillfällen som gruppen skapat.
    const [owned] = await tx.select({ id: schema.eventAdministrationGrants.id }).from(schema.eventAdministrationGrants)
      .leftJoin(schema.eventAdministrationGrantRevocations, eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
      .where(and(eq(schema.eventAdministrationGrants.eventId, race.eventId), isNull(schema.eventAdministrationGrantRevocations.id))).limit(1);
    const races = await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.eventId, race.eventId));
    const free = await untouched(tx, races.map(row => row.id));
    if (owned || free.size !== races.length) return { status: "conflict" } as const;
    await purgeRows(tx, "event", [race.eventId]);
    return { status: "removed" } as const;
  });
}
