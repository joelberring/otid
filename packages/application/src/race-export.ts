import { eq, sql, type SQL } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";

/**
 * "Exportera tävlingen" (PLAN.md steg 27, `docs/export.md`): allt om ett lopp i en JSON-fil med versionerat format, som
 * säkerhetskopia och underlag för en senare import. Raderna skrivs som databasen har dem (kolumnnamn i snake_case), med
 * binärdata (karta, GPS-spår) i base64. Hemligheter (klubbens krypterade Eventor-nyckel) och konton (bara id) följer inte med.
 * Bara administratören; läser i en ögonblicksbild (repeatable read) och ändrar inget.
 */
export const RACE_EXPORT_FORMAT = "otid-race-export";
export const RACE_EXPORT_FORMAT_VERSION = 1;

/** Varje avsnitt: namnet i filen och frågan som ger raderna som en JSON-array (tom array när inget finns). */
function sections(raceId: string): readonly (readonly [string, SQL])[] {
  const rows = (from: SQL, order: SQL, select: SQL = sql`to_jsonb(t)`) =>
    sql`select coalesce(jsonb_agg(${select} order by ${order}), '[]'::jsonb) as rows from ${from}`;
  const race = sql`t.race_id = ${raceId}`;
  return [
    ["controls", rows(sql`control t where ${race}`, sql`t.code, t.id`)],
    ["courses", rows(sql`course t where ${race}`, sql`t.name, t.id`)],
    ["courseVersions", rows(sql`course_version t join course c on c.id = t.course_id where c.race_id = ${raceId}`, sql`t.course_id, t.version`)],
    ["courseControls", rows(sql`course_control t join course_version v on v.id = t.course_version_id join course c on c.id = v.course_id
      where c.race_id = ${raceId}`, sql`t.course_version_id, t.sequence`)],
    ["courseVariants", rows(sql`course_variant t join course_version v on v.id = t.course_version_id join course c on c.id = v.course_id
      where c.race_id = ${raceId}`, sql`t.course_version_id, t.sequence`)],
    ["courseVariantControls", rows(sql`course_variant_control t join course_variant cv on cv.id = t.course_variant_id
      join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id where c.race_id = ${raceId}`,
      sql`t.course_variant_id, t.sequence`)],
    ["classes", rows(sql`class t where ${race}`, sql`t.name, t.id`)],
    ["classControlNeutralizations", rows(sql`class_control_neutralization t where ${race}`, sql`t.created_at, t.id`)],
    ["relayLegs", rows(sql`relay_leg t where ${race}`, sql`t.class_id, t.leg`)],
    ["teams", rows(sql`team t where ${race}`, sql`t.class_id, t.number, t.id`)],
    ["entries", rows(sql`entry t where ${race}`, sql`t.class_id, t.family_name, t.given_name, t.id`)],
    ["cardAssignments", rows(sql`card_assignment t where ${race}`, sql`t.created_at, t.id`)],
    ["startDraws", rows(sql`start_draw_request t where ${race}`, sql`t.drawn_at, t.id`)],
    ["startDrawClasses", rows(sql`start_draw_class t where ${race}`, sql`t.draw_id, t.class_id`)],
    ["startDrawSlots", rows(sql`start_draw_slot t join start_draw_class d on d.draw_id = t.draw_id and d.class_id = t.class_id
      where d.race_id = ${raceId}`, sql`t.draw_id, t.class_id, t.position`)],
    ["startListPublications", rows(sql`start_list_publication t where ${race}`, sql`t.revision`)],
    ["rawReadouts", rows(sql`raw_device_message t where ${race}`, sql`t.server_received_at, t.id`)],
    ["cardReadouts", rows(sql`card_readout t where ${race}`, sql`t.read_at, t.id`)],
    ["readoutOutcomes", rows(sql`device_ingest_outcome t join raw_device_message m on m.id = t.raw_message_id where m.race_id = ${raceId}`,
      sql`t.created_at, t.raw_message_id`)],
    ["readoutRegistrations", rows(sql`readout_registration t where ${race}`, sql`t.created_at, t.request_id`)],
    ["unknownReadoutResolutions", rows(sql`unknown_readout_resolution t where ${race}`, sql`t.resolved_at, t.request_id`)],
    ["resultRevisions", rows(sql`result_revision t where ${race}`, sql`t.entry_id, t.revision`)],
    ["resultFinalizations", rows(sql`result_finalization t where ${race}`, sql`t.finalized_at, t.id`)],
    ["radioControls", rows(sql`race_radio_control t where ${race}`, sql`t.control_code`)],
    ["radioLink", rows(sql`race_radio_link t where ${race}`, sql`t.race_id`)],
    ["radioPunches", rows(sql`radio_punch t where ${race}`, sql`t.punched_at, t.id`)],
    ["maps", rows(sql`race_map t where ${race}`, sql`t.race_id`,
      sql`(to_jsonb(t) - 'image') || jsonb_build_object('image_base64', encode(t.image, 'base64'))`)],
    ["participantRoutes", rows(sql`participant_route t where ${race}`, sql`t.entry_id`,
      sql`(to_jsonb(t) - 'gpx') || jsonb_build_object('gpx_base64', encode(t.gpx, 'base64'))`)],
    // Eventor: vilken tävling och klubb loppet hör till, utan den krypterade nyckeln.
    ["eventorLink", rows(sql`race_eventor_link t where ${race}`, sql`t.race_id`,
      sql`to_jsonb(t) - 'key_id' - 'iv' - 'tag' - 'ciphertext'`)],
    ["auditEvents", rows(sql`audit_event t where ${race}`, sql`t.created_at, t.id`)]
  ];
}

export type RaceExportResult =
  | { status: "unauthorized" | "forbidden" | "not-found" }
  | { status: "ok"; bytes: Uint8Array; fileName: string };

export async function exportRaceAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">,
  now = new Date()): Promise<RaceExportResult> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const [race] = await tx.execute<{ race: Record<string, unknown>; event: Record<string, unknown> }>(sql`select to_jsonb(r) as race,
      to_jsonb(e) as event from race r join event e on e.id = r.event_id where r.id = ${raceId}`).then((result) => result.rows);
    const [names] = await tx.select({ name: schema.races.name, raceDate: schema.races.raceDate, shortCode: schema.races.shortCode })
      .from(schema.races).where(eq(schema.races.id, raceId));
    if (!race || !names) return { status: "not-found" };
    const content: Record<string, unknown> = { format: RACE_EXPORT_FORMAT, formatVersion: RACE_EXPORT_FORMAT_VERSION,
      exportedAt: now.toISOString(), engineVersion: RESULT_ENGINE_VERSION, event: race.event, race: race.race };
    for (const [name, query] of sections(raceId)) {
      const result = await tx.execute<{ rows: unknown[] }>(query);
      content[name] = result.rows[0]?.rows ?? [];
    }
    const slug = names.name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 60) || names.shortCode;
    return { status: "ok", bytes: new TextEncoder().encode(JSON.stringify(content)),
      fileName: `otid-${slug}-${names.raceDate}.json` };
  }, { isolationLevel: "repeatable read" });
}
