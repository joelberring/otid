import { sql, type SQL } from "drizzle-orm";

/**
 * Tabellerna i säkerhetskopian (ADR-0187) i den ordning de läses in: en tabell kommer efter dem den har en icke uppskjutbar
 * främmande nyckel till (integrationstestet `aterstallning` jämför med databasens katalog). `scope` väljer tävlingens rader.
 * Varje tabell med `race_id` finns antingen här eller i `RACE_BACKUP_EXCLUDED_TABLES`, så att en ny tabell kräver ett beslut.
 */
export interface BackupTable {
  name: string;
  scope: (raceId: string, eventId: string) => SQL;
  /** Kolumner som aldrig skrivs i kopian (hemligheter, serverns egna värden). */
  omit?: readonly string[];
  /** Kolumner vars innehåll följer med orört: id inuti dem byts inte (råa avläsningar och inlästa filer). */
  verbatim?: readonly string[];
}

const byRace = (raceId: string) => sql`t.race_id = ${raceId}`;
const raceTable = (name: string, extra: Partial<BackupTable> = {}): BackupTable => ({ name, scope: byRace, ...extra });
const courseVersionsOf = (raceId: string) => sql`(select v.id from course_version v join course c on c.id = v.course_id where c.race_id = ${raceId})`;

export const RACE_BACKUP_TABLES: readonly BackupTable[] = [
  // Den nya tävlingen får egen kort adress och är opublicerad tills arrangören publicerar den.
  { name: "event", scope: (_raceId, eventId) => sql`t.id = ${eventId}` },
  { name: "race", scope: raceId => sql`t.id = ${raceId}`, omit: ["short_code", "last_backup_at"] },
  raceTable("control"),
  raceTable("course"),
  { name: "course_version", scope: raceId => sql`t.course_id in (select id from course where race_id = ${raceId})` },
  { name: "course_control", scope: raceId => sql`t.course_version_id in ${courseVersionsOf(raceId)}` },
  { name: "course_variant", scope: raceId => sql`t.course_version_id in ${courseVersionsOf(raceId)}` },
  { name: "course_variant_control", scope: raceId => sql`t.course_variant_id in (select id from course_variant
    where course_version_id in ${courseVersionsOf(raceId)})` },
  raceTable("class"),
  raceTable("relay_leg"),
  raceTable("team"),
  raceTable("entry"),
  raceTable("card_assignment"),
  raceTable("start_draw_request"),
  raceTable("start_draw_class"),
  { name: "start_draw_slot", scope: raceId => sql`(t.draw_id, t.class_id) in (select draw_id, class_id from start_draw_class
    where race_id = ${raceId})` },
  raceTable("start_list_publication"),
  raceTable("race_station_correction"),
  raceTable("raw_device_message", { verbatim: ["raw_payload"] }),
  { name: "device_ingest_outcome", scope: raceId => sql`t.raw_message_id in (select id from raw_device_message where race_id = ${raceId})` },
  raceTable("card_readout"),
  raceTable("readout_registration"),
  raceTable("start_checkin_device"),
  raceTable("start_checkin_operation"),
  raceTable("start_checkin_revision"),
  raceTable("shortened_course_class_transfer"),
  raceTable("result_revision"),
  raceTable("shortened_course_class_transfer_item"),
  raceTable("start_checkin_dns_decision"),
  raceTable("start_checkin_dns_withdrawal"),
  raceTable("start_checkin_conflict_review"),
  raceTable("start_checkin_conflict_review_item"),
  raceTable("unknown_readout_resolution"),
  raceTable("result_finalization"),
  raceTable("class_result_recalculation"),
  raceTable("class_result_recalculation_item"),
  raceTable("result_recalculation_request"),
  raceTable("class_capacity_change_request"),
  raceTable("class_edit_request"),
  raceTable("course_edit_request"),
  raceTable("course_variant_assignment_request"),
  raceTable("entry_card_change_request"),
  raceTable("entry_card_rental_change"),
  raceTable("entry_card_rental_return_change"),
  raceTable("entry_card_rental_reuse_request"),
  raceTable("entry_class_change_request"),
  raceTable("entry_identity_change_request"),
  raceTable("entry_registration_request"),
  raceTable("entry_start_time_change_request"),
  raceTable("entry_transfer_request"),
  raceTable("import_file", { verbatim: ["original_xml"] }),
  raceTable("iof_import_request"),
  raceTable("manual_class_create_request"),
  raceTable("manual_course_class_create_request"),
  raceTable("race_settings_request"),
  raceTable("relay_request"),
  raceTable("rogaining_change_request"),
  raceTable("source_snapshot", { verbatim: ["original_xml"] }),
  raceTable("race_radio_link"),
  raceTable("race_radio_control"),
  raceTable("radio_punch"),
  raceTable("race_map"),
  raceTable("race_map_source"),
  raceTable("race_map_agreement"),
  raceTable("race_route_choice"),
  raceTable("participant_route"),
  raceTable("map_print"),
  raceTable("course_setting", { verbatim: ["original_ppen"] }),
  raceTable("course_setting_revision"),
  raceTable("course_setting_change"),
  raceTable("course_setting_grant"),
  raceTable("course_setting_note"),
  raceTable("course_setting_note_reply"),
  raceTable("course_setting_suggestion"),
  raceTable("course_setting_inspection"),
  raceTable("party_setting"),
  raceTable("party_item"),
  raceTable("party_item_price"),
  raceTable("party_guest"),
  raceTable("party_desk_event"),
  raceTable("party_purchase_void"),
  raceTable("party_presence_void"),
  raceTable("party_logo"),
  // Eventor: vilken tävling och klubb, aldrig den krypterade nyckeln. Arrangören klistrar in nyckeln igen.
  raceTable("race_eventor_link", { omit: ["key_id", "iv", "tag", "ciphertext"] }),
  raceTable("audit_event")
];

/**
 * Tävlingens tabeller som inte följer med, och varför:
 * - `race_copy_request`: kvittot för en kopia av en annan tävling,
 * - `public_result_update_event`: tekniska väckningar av resultatströmmen (skapas igen när resultaten läses in),
 * - `course_setting_print_job`: PDF:er för tryck (sparas 7 dagar, görs om från banläggningen),
 * - `user_account_event_creation_request`: kontots kvitto när tävlingen skapades,
 * - `race_restore_request`: kvittot för en återställning (den nya tävlingen får ett eget).
 * Konton, lösenord, sessioner, behörigheternas journal och träningsgrupper har ingen `race_id` och följer inte heller med;
 * behörigheterna följer med som e-postadresser (`personer.json`).
 */
export const RACE_BACKUP_EXCLUDED_TABLES: readonly string[] = [
  "race_copy_request", "public_result_update_event", "course_setting_print_job", "user_account_event_creation_request",
  "race_restore_request"
];

/** Kolumner som töms vid återställningen: de pekar på sådant som inte följer med (träningsgruppen och dess kartor). */
export const RACE_RESTORE_CLEARED: Readonly<Record<string, readonly string[]>> = {
  event: ["training_group_id", "training_group_series_id"],
  race_map_agreement: ["source_map_id"]
};
