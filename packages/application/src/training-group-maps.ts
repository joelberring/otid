import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  groupMapSaveRequestSchema, groupMapUpdateRequestSchema, raceMapAgreementAcknowledgeRequestSchema, type GroupLibraryMap, type MapAgreement,
  type RaceMapAgreementView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { mapAgreementIssues, mapPublicUseBlocked, type MapAgreementFacts } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import type { DbExecutor } from "./snapshot";
import { UUID_PATTERN } from "./serialization";
import type { UserAccountSessionProof } from "./user-account";
import { requireGroupLeader, type GroupFailure, type GroupTransaction as Transaction } from "./training-groups";

/**
 * Steg 68 (ADR-0182 beslut 4): gruppens kartbibliotek och kartans avtal.
 *
 * Kartbildens och kartfilens rader och banläggningen KOPIERAS: från en tävling in i biblioteket och från biblioteket till en
 * ny träning (`applyLibraryMapToRace`). Raderna pekar på samma innehåll (ADR-0189, `map_content`), som lagras en gång och finns
 * kvar så länge någon rad pekar på det; en borttagen träning, ett evenemang som superadmin tar bort eller en karta som tas bort
 * ur biblioteket påverkar därför aldrig något annat, och ett tillfälle kostar ingen ny kartfil.
 *
 * Avtalet följer med som en kopia (`race_map_agreement`); när det ändras i biblioteket uppdateras tävlingarna som valt kartan.
 */
type Proof = UserAccountSessionProof;

const agreementOf = (row: MapAgreement): MapAgreement => ({ ownership: row.ownership, ownerKind: row.ownerKind, ownerName: row.ownerName,
  agreement: row.agreement, validUntil: row.validUntil, contact: row.contact, trainingOnly: row.trainingOnly, feePerPrint: row.feePerPrint,
  noPublicDisplay: row.noPublicDisplay });

/** Ägaren gäller bara en extern karta; klubbens egen karta har klubben som ägare. */
function normalizedAgreement(agreement: MapAgreement): MapAgreement {
  return agreement.ownership === "CLUB" ? { ...agreement, ownerKind: agreement.ownerKind ?? "CLUB" } : agreement;
}

export async function listGroupLibraryMaps(tx: DbExecutor, groupId: string): Promise<GroupLibraryMap[]> {
  const rows = await tx.select().from(schema.trainingGroupMaps).where(eq(schema.trainingGroupMaps.groupId, groupId))
    .orderBy(asc(schema.trainingGroupMaps.name), asc(schema.trainingGroupMaps.createdAt)).limit(500);
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.id);
  const sources = new Map((await tx.select().from(schema.trainingGroupMapSources).where(inArray(schema.trainingGroupMapSources.mapId, ids)))
    .map(row => [row.mapId, row]));
  const settings = new Set((await tx.select({ mapId: schema.trainingGroupMapCourseSettings.mapId }).from(schema.trainingGroupMapCourseSettings)
    .where(inArray(schema.trainingGroupMapCourseSettings.mapId, ids))).map(row => row.mapId));
  // ADR-0194 beslut 5: kartor från klubbarkivet och om klubben har en nyare version än den i biblioteket.
  const clubMapIds = [...new Set(rows.flatMap(row => row.clubMapId ? [row.clubMapId] : []))];
  const clubMaps = new Map(clubMapIds.length === 0 ? [] : (await tx.execute<{ map_id: string; club_id: string; club_name: string; latest: string | null }>(sql`
    select m.id as map_id, c.id as club_id, c.name as club_name,
      (select v.content_sha256 from club_map_version v where v.map_id = m.id
        order by v.version_date desc nulls last, v.uploaded_at desc limit 1) as latest
    from club_map m join club c on c.id = m.club_id where m.id = any(${sql.param(clubMapIds)}::uuid[])`)).rows.map(row => [row.map_id, row]));
  return rows.map(row => {
    const source = sources.get(row.id);
    const club = row.clubMapId ? clubMaps.get(row.clubMapId) : undefined;
    return { mapId: row.id, name: row.name, fileName: row.fileName, width: row.width, height: row.height, georeferenced: row.transform !== null,
      source: source ? { fileName: source.fileName, format: source.format, scale: source.scale } : null, courseSetting: settings.has(row.id),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), ...agreementOf(row),
      clubMap: club ? { clubId: club.club_id, clubName: club.club_name, latest: club.latest === (source?.contentSha256 ?? null) } : null };
  });
}

async function raceInGroup(tx: Transaction, raceId: string, groupId: string) {
  const [race] = await tx.select({ id: schema.races.id }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(and(eq(schema.races.id, raceId), eq(schema.events.trainingGroupId, groupId)));
  return race;
}

/** Tävlingens karta (bild, georeferens, kartfil och, om valt, banläggningen) sparas i gruppens bibliotek med avtalet. */
export async function saveRaceMapToLibrary(db: Database, input: Proof & { groupId: string; request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "saved"; replayed: boolean; mapId: string }> {
  const parsed = groupMapSaveRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const intent = parsed.data;
  const agreement = normalizedAgreement(intent.agreement);
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    const [prior] = await tx.select({ id: schema.trainingGroupMaps.id, groupId: schema.trainingGroupMaps.groupId,
      sourceRaceId: schema.trainingGroupMaps.sourceRaceId }).from(schema.trainingGroupMaps).where(eq(schema.trainingGroupMaps.requestId, intent.requestId));
    if (prior) {
      if (prior.groupId !== input.groupId || prior.sourceRaceId !== intent.raceId) return { status: "conflict" } as const;
      return { status: "saved", replayed: true, mapId: prior.id } as const;
    }
    if (!await raceInGroup(tx, intent.raceId, input.groupId)) return { status: "not-found" } as const;
    await lockRaceForMutation(tx, intent.raceId);
    const mapId = randomUUID();
    const inserted = await tx.execute(sql`insert into training_group_map (id, group_id, name, ownership, owner_kind, owner_name, agreement,
        valid_until, contact, training_only, fee_per_print, no_public_display, file_name, media_type, image, content_sha256, sha256, byte_length,
        width, height, tie_points, transform, source_race_id, created_at, created_by, updated_at, request_id)
      select ${mapId}, ${input.groupId}, ${intent.name}, ${agreement.ownership}, ${agreement.ownerKind}, ${agreement.ownerName},
        ${agreement.agreement}, ${agreement.validUntil}, ${agreement.contact}, ${agreement.trainingOnly}, ${agreement.feePerPrint},
        ${agreement.noPublicDisplay}, file_name, media_type, null, coalesce(content_sha256, otid_map_content_store(image, null)), sha256,
        byte_length, width, height, tie_points, transform, race_id, ${now},
        ${leader.accountId}, ${now}, ${intent.requestId}
      from race_map where race_id = ${intent.raceId}`);
    if ((inserted.rowCount ?? 0) === 0) return { status: "not-found" } as const;
    await tx.execute(sql`insert into training_group_map_source (map_id, file_name, format, version, file, content_sha256, sha256, byte_length,
        scale, bounds, georeference, render, summary)
      select ${mapId}, file_name, format, version, null, coalesce(content_sha256, otid_map_content_store(file, null)), sha256, byte_length,
        scale, bounds, georeference, render, summary
      from race_map_source where race_id = ${intent.raceId}`);
    if (intent.includeCourseSetting) {
      await tx.execute(sql`insert into training_group_map_course_setting (map_id, document, original_ppen, original_file_name)
        select ${mapId}, document, original_ppen, original_file_name from course_setting where race_id = ${intent.raceId}`);
    }
    // Tävlingen som kartan kom ifrån får samma avtal (det är samma karta).
    await writeRaceAgreement(tx, intent.raceId, { mapId, name: intent.name, agreement }, now, true);
    return { status: "saved", replayed: false, mapId } as const;
  });
}

async function writeRaceAgreement(tx: DbExecutor, raceId: string, map: { mapId: string; name: string; agreement: MapAgreement }, now: Date,
  keepAcknowledgement: boolean): Promise<void> {
  const values = { sourceMapId: map.mapId, mapName: map.name, ...map.agreement, updatedAt: now };
  await tx.insert(schema.raceMapAgreements).values({ raceId, ...values })
    .onConflictDoUpdate({ target: schema.raceMapAgreements.raceId, set: keepAcknowledgement ? values
      : { ...values, publicUseAcknowledgedAt: null, publicUseAcknowledgedBy: null } });
}

export async function updateLibraryMap(db: Database, input: Proof & { groupId: string; mapId: string; request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "ok"; races: number }> {
  const parsed = groupMapUpdateRequestSchema.safeParse(input.request);
  if (!parsed.success || !UUID_PATTERN.test(input.mapId)) return { status: "invalid-request" };
  const agreement = normalizedAgreement(parsed.data.agreement);
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    const [map] = await tx.update(schema.trainingGroupMaps).set({ name: parsed.data.name, ...agreement, updatedAt: now })
      .where(and(eq(schema.trainingGroupMaps.id, input.mapId), eq(schema.trainingGroupMaps.groupId, input.groupId)))
      .returning({ id: schema.trainingGroupMaps.id });
    if (!map) return { status: "not-found" } as const;
    // Tävlingarna i gruppen som använder kartan får det nya avtalet; ett medvetet val att visa publikt står kvar.
    const updated = await tx.execute(sql`update race_map_agreement a set map_name = ${parsed.data.name}, ownership = ${agreement.ownership},
        owner_kind = ${agreement.ownerKind}, owner_name = ${agreement.ownerName}, agreement = ${agreement.agreement},
        valid_until = ${agreement.validUntil}, contact = ${agreement.contact}, training_only = ${agreement.trainingOnly},
        fee_per_print = ${agreement.feePerPrint}, no_public_display = ${agreement.noPublicDisplay}, updated_at = ${now}
      from race r join event e on e.id = r.event_id
      where a.race_id = r.id and a.source_map_id = ${input.mapId} and e.training_group_id = ${input.groupId}`);
    return { status: "ok", races: updated.rowCount ?? 0 } as const;
  });
}

export async function deleteLibraryMap(db: Database, input: Proof & { groupId: string; mapId: string }, now = new Date())
  : Promise<GroupFailure | { status: "deleted" }> {
  if (!UUID_PATTERN.test(input.mapId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const leader = await requireGroupLeader(tx, input, now, true);
    if (leader.status !== "ok") return leader;
    const [map] = await tx.select({ id: schema.trainingGroupMaps.id }).from(schema.trainingGroupMaps)
      .where(and(eq(schema.trainingGroupMaps.id, input.mapId), eq(schema.trainingGroupMaps.groupId, input.groupId))).for("update");
    if (!map) return { status: "not-found" } as const;
    // Tävlingarna har egna kopior av kartan och avtalet och påverkas inte.
    await tx.delete(schema.trainingGroupMapSources).where(eq(schema.trainingGroupMapSources.mapId, map.id));
    await tx.delete(schema.trainingGroupMapCourseSettings).where(eq(schema.trainingGroupMapCourseSettings.mapId, map.id));
    await tx.delete(schema.trainingGroupMaps).where(eq(schema.trainingGroupMaps.id, map.id));
    return { status: "deleted" } as const;
  });
}

/** Bibliotekets karta med avtal, eller undefined när den inte finns i gruppen. */
export async function libraryMap(tx: DbExecutor, groupId: string, mapId: string) {
  const [map] = await tx.select().from(schema.trainingGroupMaps)
    .where(and(eq(schema.trainingGroupMaps.id, mapId), eq(schema.trainingGroupMaps.groupId, groupId)));
  return map ? { mapId: map.id, name: map.name, agreement: agreementOf(map) } : undefined;
}

/**
 * Bibliotekets karta till en (ny) tävling: ersätter kartbilden, kartfilen och avtalet, och med `includeCourseSetting`
 * banläggningen (utan notiser och förslag, som hör till den gamla banläggningen).
 */
export async function applyLibraryMapToRace(tx: DbExecutor, input: { mapId: string; groupId: string; raceId: string;
  includeCourseSetting: boolean; accountId: string; now: Date }): Promise<boolean> {
  const map = await libraryMap(tx, input.groupId, input.mapId);
  if (!map) return false;
  const { raceId, now } = input;
  await tx.execute(sql`delete from race_map_source where race_id = ${raceId}`);
  await tx.execute(sql`delete from race_map where race_id = ${raceId}`);
  await tx.execute(sql`insert into race_map (race_id, file_name, media_type, image, content_sha256, sha256, byte_length, width, height,
      tie_points, transform, uploaded_at, georeferenced_at)
    select ${raceId}, file_name, media_type, null, coalesce(content_sha256, otid_map_content_store(image, null)), sha256, byte_length, width,
      height, tie_points, transform, ${now},
      case when transform is null then null else ${now}::timestamptz end
    from training_group_map where id = ${input.mapId}`);
  // Kartfilen räknas som den som bilden är ritad ur (samma uppladdningstid som georeferensen, som i kopieringen).
  await tx.execute(sql`insert into race_map_source (race_id, file_name, format, version, file, content_sha256, sha256, byte_length, scale,
      bounds, georeference, render, summary, uploaded_at)
    select ${raceId}, file_name, format, version, null, coalesce(content_sha256, otid_map_content_store(file, null)), sha256, byte_length,
      scale, bounds, georeference, render, summary, ${now}
    from training_group_map_source where map_id = ${input.mapId}`);
  if (input.includeCourseSetting) {
    const [setting] = await tx.select({ mapId: schema.trainingGroupMapCourseSettings.mapId }).from(schema.trainingGroupMapCourseSettings)
      .where(eq(schema.trainingGroupMapCourseSettings.mapId, input.mapId));
    if (setting) {
      for (const table of ["course_setting_note_edit", "course_setting_note_reply", "course_setting_note", "course_setting_suggestion", "course_setting_change",
        "course_setting_revision", "course_setting_inspection", "course_setting"]) {
        await tx.execute(sql`delete from ${sql.identifier(table)} where race_id = ${raceId}`);
      }
      await tx.execute(sql`insert into course_setting (race_id, document, version, updated_at, updated_by, original_ppen, original_file_name,
          original_imported_at)
        select ${raceId}, document, 1, ${now}, ${input.accountId}, original_ppen, original_file_name,
          case when original_ppen is null then null else ${now}::timestamptz end
        from training_group_map_course_setting where map_id = ${input.mapId}`);
      await tx.execute(sql`insert into course_setting_change (race_id, version, touches, created_at, created_by)
        values (${raceId}, 1, '"ALL"'::jsonb, ${now}, ${input.accountId})`);
    }
  }
  await writeRaceAgreement(tx, raceId, map, now, false);
  return true;
}

type AgreementRow = typeof schema.raceMapAgreements.$inferSelect;
const facts = (row: AgreementRow): MapAgreementFacts => ({ ownership: row.ownership, validUntil: row.validUntil, trainingOnly: row.trainingOnly,
  feePerPrint: row.feePerPrint, noPublicDisplay: row.noPublicDisplay });

/** Kartans avtal på tävlingen med varningarna för tävlingens datum och typ. Null när kartan inte har något avtal. */
export async function raceMapAgreement(tx: DbExecutor, raceId: string): Promise<RaceMapAgreementView | null> {
  const [row] = await tx.select({ agreement: schema.raceMapAgreements, raceDate: schema.races.raceDate, raceType: schema.races.raceType })
    .from(schema.raceMapAgreements).innerJoin(schema.races, eq(schema.races.id, schema.raceMapAgreements.raceId))
    .where(eq(schema.raceMapAgreements.raceId, raceId));
  if (!row) return null;
  const agreement = row.agreement;
  return { mapName: agreement.mapName, ...agreementOf(agreement), raceDate: row.raceDate,
    issues: mapAgreementIssues(facts(agreement), { date: row.raceDate, publicUse: true, raceType: row.raceType }),
    publicUseBlocked: mapPublicUseBlocked(facts(agreement), row.raceDate, agreement.publicUseAcknowledgedAt !== null),
    acknowledgedAt: agreement.publicUseAcknowledgedAt?.toISOString() ?? null };
}

/**
 * Får kartan visas publikt (kartbilden, och därmed vägvalskartan och GPS-rutterna)? Nej när avtalet gått ut eller inte
 * tillåter publik visning och admin inte medvetet valt att visa den ändå.
 */
export async function racePublicMapBlocked(tx: DbExecutor, raceId: string): Promise<boolean> {
  return (await raceMapAgreement(tx, raceId))?.publicUseBlocked ?? false;
}

export async function readRaceMapAgreementAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">, now = new Date())
  : Promise<GroupFailure | { status: "ok"; agreement: RaceMapAgreementView | null }> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    return { status: "ok", agreement: await raceMapAgreement(tx, input.raceId) } as const;
  });
}

/** "Visa kartan publikt ändå": admin har stämt av med kartans ägare (eller tar tillbaka valet). */
export async function acknowledgeRaceMapPublicUse(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<GroupFailure | { status: "ok"; agreement: RaceMapAgreementView }> {
  const parsed = raceMapAgreementAcknowledgeRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.update(schema.raceMapAgreements).set(parsed.data.acknowledge
      ? { publicUseAcknowledgedAt: now, publicUseAcknowledgedBy: auth.principal.accountId }
      : { publicUseAcknowledgedAt: null, publicUseAcknowledgedBy: null })
      .where(eq(schema.raceMapAgreements.raceId, input.raceId)).returning({ raceId: schema.raceMapAgreements.raceId });
    if (!row) return { status: "not-found" } as const;
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "race_map_agreement", entityId: input.raceId,
      action: parsed.data.acknowledge ? "MAP_PUBLIC_USE_ACKNOWLEDGED" : "MAP_PUBLIC_USE_ACKNOWLEDGEMENT_WITHDRAWN", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, after: { acknowledge: parsed.data.acknowledge }, createdAt: now });
    const agreement = await raceMapAgreement(tx, input.raceId);
    if (!agreement) return { status: "not-found" } as const;
    return { status: "ok", agreement } as const;
  });
}
