import { sql } from "drizzle-orm";
import { accountStorageSchema, type AccountStorage } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { accountMapQuotaBytes, mapStorageUsage } from "./map-content";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { requireSuperadmin } from "./superadmin";
import { authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof } from "./user-account";

/**
 * PLAN.md steg L2 (ägaren 2026-11-13): vad kontots kartlagring består av. Kvoten räknar innehåll efter den som laddade upp det
 * (`map_content.uploaded_by`), och samma innehåll sparas en gång, så varje innehåll räknas här till ett enda ställe: först
 * laserkörningen det kom ur, sedan underlaget, resultatet och sist grundfilen (och det lägsta projekt-id:t om flera projekt
 * delar det). Det som inget kartprojekt pekar på är klubbarkivets, tävlingarnas och träningarnas kartor.
 */
export async function accountStorage(tx: DbExecutor, accountId: string): Promise<AccountStorage> {
  const rows = (await tx.execute<{ project_id: string; name: string; geo: string; layer: string; output: string; base: string; prunable: number;
    last_opened_at: Date | string | null }>(sql`
    with mine as (select sha256, byte_length from map_content where uploaded_by = ${accountId}::uuid),
    refs as (
      select o.content_sha256 as sha, j.project_id as pid, 1 as pri from map_project_geo_output o join map_project_geo_job j on j.id = o.job_id
      union all select content_sha256, project_id, 2 from map_project_layer
      union all select content_sha256, project_id, 3 from map_project_output where content_sha256 is not null
      union all select base_sha256, id, 4 from map_project
    ),
    pick as (select distinct on (r.sha) r.sha, r.pid, r.pri, m.byte_length from refs r join mine m on m.sha256 = r.sha order by r.sha, r.pri, r.pid),
    latest as (select distinct on (project_id) project_id, id from map_project_geo_job where status = 'DONE' order by project_id, finished_at desc nulls last, id),
    prunable as (select j.project_id, count(*)::int as runs from map_project_geo_job j left join latest l on l.project_id = j.project_id
      where j.account_id = ${accountId}::uuid and j.status in ('DONE', 'FAILED', 'CANCELLED') and j.id is distinct from l.id group by j.project_id)
    select p.id as project_id, p.name, p.last_opened_at,
      coalesce(sum(k.byte_length) filter (where k.pri = 1), 0)::text as geo, coalesce(sum(k.byte_length) filter (where k.pri = 2), 0)::text as layer,
      coalesce(sum(k.byte_length) filter (where k.pri = 3), 0)::text as output, coalesce(sum(k.byte_length) filter (where k.pri = 4), 0)::text as base,
      coalesce(max(r.runs), 0)::int as prunable
    from map_project p left join pick k on k.pid = p.id left join prunable r on r.project_id = p.id
    where k.sha is not null or r.runs is not null
    group by p.id, p.name, p.last_opened_at order by coalesce(sum(k.byte_length), 0) desc, p.name limit 100`)).rows;
  const used = (await mapStorageUsage(tx, accountId)).accountBytes;
  const projects = rows.map(row => {
    const [geoBytes, layerBytes, outputBytes, baseBytes] = [Number(row.geo), Number(row.layer), Number(row.output), Number(row.base)];
    return { projectId: row.project_id, name: row.name.slice(0, 200), geoBytes, layerBytes, outputBytes, baseBytes,
      totalBytes: geoBytes + layerBytes + outputBytes + baseBytes, prunableRuns: row.prunable,
      lastOpenedAt: row.last_opened_at === null ? null : new Date(row.last_opened_at).toISOString() };
  });
  return accountStorageSchema.parse({ formatVersion: 1, usedBytes: used, limitBytes: await accountMapQuotaBytes(tx, accountId), projects,
    otherBytes: Math.max(0, used - projects.reduce((sum, project) => sum + project.totalBytes, 0)) });
}

type StorageResult = { status: "unauthorized" | "forbidden" | "not-found" } | { status: "ok"; response: AccountStorage };

/** Det egna kontots lagring (Mitt konto). */
export async function readOwnAccountStorage(db: Database, proof: UserAccountSessionProof, now = new Date()): Promise<StorageResult> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return { status: auth.status === "forbidden" ? "forbidden" : "unauthorized" } as const;
    return { status: "ok", response: await accountStorage(tx, auth.principal.accountId) } as const;
  });
}

/** Ett annat kontos lagring, för superadmin (samma uppdelning som kontot själv ser). */
export async function readAccountStorageAsSuperadmin(db: Database, proof: UserAccountSessionProof, accountId: string, now = new Date()): Promise<StorageResult> {
  return db.transaction(async tx => {
    const auth = await requireSuperadmin(tx, proof, now, "read");
    if (auth.status !== "authenticated") return { status: auth.status === "forbidden" ? "forbidden" : "unauthorized" } as const;
    if (!UUID_PATTERN.test(accountId)) return { status: "not-found" } as const;
    const [account] = (await tx.execute<{ id: string }>(sql`select id from user_account where id = ${accountId}::uuid`)).rows;
    if (!account) return { status: "not-found" } as const;
    return { status: "ok", response: await accountStorage(tx, accountId) } as const;
  });
}
