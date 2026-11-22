import { sql } from "drizzle-orm";
import type { ClubStorage } from "@o-tid/contracts";
import { CLUB_QUOTA_WARNING_SHARE, clubMapQuotaBytes, clubStorageUsage } from "./map-content";
import type { DbExecutor } from "./snapshot";

/**
 * PLAN.md steg M7 (ägaren 2026-11-22): klubbens lagring på klubbsidan för ledare, administratörer och ägare. Allt i
 * klubbarkivet räknas mot klubben (innehåll som klubbens versioner pekar på, varje innehåll en gång, och banfilerna), också
 * det som en medlem som sedan lämnat klubben laddade upp. Kartorna visas störst först; ett innehåll som flera kartor i
 * klubben delar räknas till kartan med den äldsta versionen.
 */
export async function clubStorage(tx: DbExecutor, clubId: string): Promise<ClubStorage> {
  const usage = await clubStorageUsage(tx, clubId);
  const limitBytes = await clubMapQuotaBytes(tx, clubId);
  const rows = (await tx.execute<{ id: string; name: string; bytes: string; versions: number }>(sql`
    with c as (
      select distinct on (v.content_sha256) v.map_id, m.byte_length from club_map_version v
        join map_content m on m.sha256 = v.content_sha256
      where v.club_id = ${clubId}::uuid order by v.content_sha256, v.uploaded_at, v.id
    )
    select cm.id, cm.name, coalesce(sum(c.byte_length), 0)::text as bytes,
      (select count(*)::int from club_map_version x where x.map_id = cm.id) as versions
    from club_map cm left join c on c.map_id = cm.id
    where cm.club_id = ${clubId}::uuid
    group by cm.id, cm.name order by coalesce(sum(c.byte_length), 0) desc, cm.name limit 100`)).rows;
  return {
    usedBytes: usage.usedBytes, limitBytes, courseFileBytes: usage.courseFileBytes,
    warning: usage.usedBytes >= limitBytes * CLUB_QUOTA_WARNING_SHARE, full: usage.usedBytes >= limitBytes,
    maps: rows.map(row => ({ mapId: row.id, name: row.name.slice(0, 200), bytes: Number(row.bytes), versions: row.versions }))
  };
}
