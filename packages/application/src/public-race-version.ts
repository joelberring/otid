import { sql } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { UUID_PATTERN } from "./serialization";

/**
 * Steg 51 (lasttest): en billig nyckel för de publika listornas innehåll, så att webben kan räkna listorna en gång per
 * tävlingsversion i stället för en gång per besökare. Nyckeln ändras när
 * - ett publicerat resultat eller en radiostämpling kommer in (resultatströmmens markör `public_result_update_event`),
 * - avläsningspaketets innehåll ändras (`race.snapshot_version`: anmälda, namn, klasser, banor, lag),
 * - resultaten fastställs eller görs preliminära igen (`race.official_result_finalization_id`),
 * - startlistan publiceras eller dras tillbaka (`start_list_publication`),
 * - tävlingen publiceras om.
 * Ändringar som inte syns i nyckeln (t.ex. banans längd) täcks av cachens maxålder i webben.
 * Ger null för en okänd tävling.
 */
export async function publicRaceContentVersion(db: Database, raceId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(raceId)) return null;
  const result = await db.execute<{ snapshot_version: number; finalization: string | null; published_at: string | null; sequence: string | null; start_list: number | null }>(sql`
    select r.snapshot_version, r.official_result_finalization_id::text as finalization, r.published_at::text as published_at,
      (select max(e.event_sequence) from public_result_update_event e where e.race_id = r.id)::text as sequence,
      (select max(p.revision) from start_list_publication p where p.race_id = r.id) as start_list
    from race r where r.id = ${raceId}`);
  const row = result.rows[0];
  if (!row) return null;
  return [row.snapshot_version, row.sequence ?? "0", row.finalization ?? "-", row.published_at ?? "-", row.start_list ?? 0].join(":");
}
