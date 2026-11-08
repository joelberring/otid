import { and, eq, inArray, sql } from "drizzle-orm";
import type { MapProjectLeaderboardRow, MapProjectStatsView, MapStatsSummary, MyMapStatsView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { addStats, coveredHectares, earnedBadges, EMPTY_STATS, nightStart, type MapStats, type StoredTrackPoint } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 tillägget om spelifieringen (K3b): statistiken och de frivilliga topplistorna. Allt räknas ur det som finns:
 * - ändringarna som gjordes (APPLIED) per författare: nya, ändrade (flytt, form, symbol, text) och borttagna; ändringar från ett
 *   förslag som Claude lämnade räknas inte (källan `AI`), inte heller importerade kandidater (`IMPORT`, K4b);
 * - godkända förslag från personer, spåren (antal, km, timmar, rekad yta, nattrunda), bekräftelserna, notiserna (skrivna och
 *   åtgärdade) och delområden som blivit klara.
 *
 * En säsong är ett kalenderår (svensk tid är inte viktig här: UTC-gränsen räcker). Topplistan finns bara i projekt där ägarna
 * slagit på den och visar bara dem som själva slagit på "Visa mig i topplistorna"; den syns bara för projektets medlemmar och
 * aldrig publikt. Den egna statistiken ser var och en alltid.
 */
type PerAccount = Map<string, MapStats>;
type Range = { from: Date; to: Date } | undefined;

const seasonRange = (season: number | undefined): Range =>
  season === undefined ? undefined : { from: new Date(Date.UTC(season, 0, 1)), to: new Date(Date.UTC(season + 1, 0, 1)) };
const within = (column: Parameters<typeof sql>[1], range: Range) => range ? sql`${column} >= ${range.from} and ${column} < ${range.to}` : sql`true`;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function bump(map: PerAccount, accountId: string | null, change: Partial<MapStats>) {
  if (!accountId) return;
  const current = map.get(accountId) ?? EMPTY_STATS;
  const next = { ...current };
  for (const [key, value] of Object.entries(change) as [keyof MapStats, number | boolean][]) {
    (next as Record<string, number | boolean>)[key] = typeof value === "boolean" ? (current[key] as boolean) || value : (current[key] as number) + value;
  }
  map.set(accountId, next);
}

/** Statistiken per konto i ett projekt (för de konton som gjort något). */
async function projectStats(tx: DbExecutor, projectId: string, range: Range, accounts?: readonly string[]): Promise<PerAccount> {
  const out: PerAccount = new Map();
  const only = (column: Parameters<typeof sql>[1]) => accounts ? (accounts.length ? sql`${column} in (${sql.join(accounts.map(id => sql`${id}::uuid`), sql`, `)})` : sql`false`) : sql`true`;
  const edits = await tx.execute<{ account: string; kind: string; total: string }>(sql`select e.author_account_id as account, e.kind, count(*) as total
    from map_project_edit e left join map_project_proposal p on p.id = e.proposal_id
    where e.project_id = ${projectId} and e.status = 'APPLIED' and (p.source is null or p.source not in ('AI', 'IMPORT')) and ${within(sql`e.received_at`, range)}
      and ${only(sql`e.author_account_id`)}
    group by e.author_account_id, e.kind`);
  for (const row of edits.rows) {
    const count = Number(row.total);
    if (row.kind === "ADD") bump(out, row.account, { added: count });
    else if (row.kind === "DELETE") bump(out, row.account, { deleted: count });
    else if (["MOVE", "RESHAPE", "SYMBOL", "TEXT"].includes(row.kind)) bump(out, row.account, { changed: count });
  }
  const proposals = await tx.execute<{ account: string; total: string }>(sql`select author_account_id as account, count(*) as total
    from map_project_proposal where project_id = ${projectId} and status = 'ACCEPTED' and source = 'PERSON' and ${within(sql`decided_at`, range)}
      and ${only(sql`author_account_id`)} group by author_account_id`);
  for (const row of proposals.rows) bump(out, row.account, { proposalsAccepted: Number(row.total) });
  const checks = await tx.execute<{ account: string; total: string }>(sql`select account_id as account, count(*) as total from map_project_check
    where project_id = ${projectId} and ${within(sql`checked_at`, range)} and ${only(sql`account_id`)} group by account_id`);
  for (const row of checks.rows) bump(out, row.account, { checked: Number(row.total) });
  const written = await tx.execute<{ account: string; total: string }>(sql`select account_id as account, count(*) as total from map_project_note
    where project_id = ${projectId} and ${within(sql`created_at`, range)} and ${only(sql`account_id`)} group by account_id`);
  for (const row of written.rows) bump(out, row.account, { notesWritten: Number(row.total) });
  const resolved = await tx.execute<{ account: string; total: string }>(sql`select resolved_by as account, count(*) as total from map_project_note
    where project_id = ${projectId} and status = 'DONE' and resolved_by is not null and ${within(sql`resolved_at`, range)} and ${only(sql`resolved_by`)}
    group by resolved_by`);
  for (const row of resolved.rows) bump(out, row.account, { notesResolved: Number(row.total) });
  const areas = await tx.execute<{ account: string; total: string }>(sql`select assignee_account_id as account, count(*) as total from map_project_area
    where project_id = ${projectId} and status = 'DONE' and assignee_account_id is not null and ${within(sql`updated_at`, range)}
      and ${only(sql`assignee_account_id`)} group by assignee_account_id`);
  for (const row of areas.rows) bump(out, row.account, { areasDone: Number(row.total) });
  // Spåren: antal, km, timmar och natt per konto; rekad yta ur punkterna (överlapp en gång per person och projekt).
  const tracks = await tx.select({ id: schema.mapProjectTracks.id, account: schema.mapProjectTracks.accountId, lengthM: schema.mapProjectTracks.lengthM,
    startedAt: schema.mapProjectTracks.startedAt, endedAt: schema.mapProjectTracks.endedAt }).from(schema.mapProjectTracks)
    .where(and(eq(schema.mapProjectTracks.projectId, projectId), within(schema.mapProjectTracks.createdAt, range), only(schema.mapProjectTracks.accountId)));
  const byAccount = new Map<string, string[]>();
  for (const track of tracks) {
    const hours = track.startedAt && track.endedAt ? Math.max(0, (track.endedAt.getTime() - track.startedAt.getTime()) / 3_600_000) : 0;
    bump(out, track.account, { tracks: 1, km: track.lengthM / 1000, hours, night: nightStart(track.startedAt?.toISOString() ?? null) });
    byAccount.set(track.account, [...(byAccount.get(track.account) ?? []), track.id]);
  }
  for (const [account, ids] of byAccount) {
    const parts = await tx.select({ trackId: schema.mapProjectTrackParts.trackId, points: schema.mapProjectTrackParts.points })
      .from(schema.mapProjectTrackParts).where(inArray(schema.mapProjectTrackParts.trackId, ids));
    const lines = ids.map(id => parts.filter(part => part.trackId === id).flatMap(part => part.points as StoredTrackPoint[]));
    bump(out, account, { hectares: coveredHectares(lines) });
  }
  for (const [account, stats] of out) out.set(account, { ...stats, projects: 1 });
  return out;
}

const summary = (stats: MapStats): MapStatsSummary => ({ ...stats, km: round(stats.km, 1), hours: round(stats.hours, 1), hectares: round(stats.hectares, 1),
  badges: earnedBadges(stats) });

async function optedIn(tx: DbExecutor, accounts: readonly string[]): Promise<Set<string>> {
  if (accounts.length === 0) return new Set();
  const rows = await tx.select({ id: schema.mapStatsOptIns.accountId }).from(schema.mapStatsOptIns).where(inArray(schema.mapStatsOptIns.accountId, [...accounts]));
  return new Set(rows.map(row => row.id));
}

const shownName = (display: "FIRST" | "FULL" | "NONE", name: string | null): string | null =>
  display === "NONE" || !name ? null : display === "FIRST" ? name.trim().split(/\s+/)[0] ?? null : name;

/** Projektets statistik: den egna och (om topplistan är på) de som valt att synas. Alla medlemmar. */
export async function readMapProjectStats(db: Database, input: ClubProof & { projectId: string; season?: number | undefined }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: MapProjectStatsView }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const range = seasonRange(input.season);
    const display = access.project.leaderboard ?? null;
    const viewer = access.accountId;
    const opted = await optedIn(tx, [viewer]);
    let rows: MapProjectLeaderboardRow[] | null = null;
    let mine: MapStats;
    if (display) {
      const members = (await tx.select({ id: schema.mapProjectMembers.accountId }).from(schema.mapProjectMembers)
        .where(eq(schema.mapProjectMembers.projectId, access.project.id))).map(row => row.id);
      const visible = await optedIn(tx, members);
      const stats = await projectStats(tx, access.project.id, range, [...new Set([...visible, viewer])]);
      mine = stats.get(viewer) ?? EMPTY_STATS;
      const names = new Map((visible.size ? await tx.select({ id: schema.userAccounts.id, name: schema.userAccounts.displayName }).from(schema.userAccounts)
        .where(inArray(schema.userAccounts.id, [...visible])) : []).map(row => [row.id, row.name]));
      rows = [...visible].filter(id => stats.has(id)).map(id => ({ name: id === viewer ? names.get(id) ?? null : shownName(display, names.get(id) ?? null),
        self: id === viewer, stats: summary(stats.get(id)!) }));
    } else mine = (await projectStats(tx, access.project.id, range, [viewer])).get(viewer) ?? EMPTY_STATS;
    return { status: "ok", view: { formatVersion: 1, leaderboard: display, optedIn: opted.has(viewer), season: input.season ?? null,
      mine: summary(mine), rows } } as const;
  });
}

/** Den egna statistiken i alla projekt kontot är med i (alltid, utan topplista). */
export async function readMyMapStats(db: Database, input: ClubProof & { season?: number | undefined }, now = new Date())
  : Promise<{ status: "unauthorized" | "forbidden" } | { status: "ok"; view: MyMapStatsView }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, input, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    const range = seasonRange(input.season);
    const projects = await tx.select({ id: schema.mapProjects.id, name: schema.mapProjects.name }).from(schema.mapProjectMembers)
      .innerJoin(schema.mapProjects, eq(schema.mapProjects.id, schema.mapProjectMembers.projectId)).where(eq(schema.mapProjectMembers.accountId, accountId));
    let total = EMPTY_STATS;
    const perProject: MyMapStatsView["projects"] = [];
    for (const project of projects) {
      const stats = (await projectStats(tx, project.id, range, [accountId])).get(accountId);
      if (!stats) continue;
      total = addStats(total, stats);
      perProject.push({ projectId: project.id, name: project.name, stats: summary(stats) });
    }
    const opted = await optedIn(tx, [accountId]);
    return { status: "ok", view: { formatVersion: 1, optedIn: opted.has(accountId), season: input.season ?? null, total: summary(total),
      projects: perProject.sort((a, b) => b.stats.hectares - a.stats.hectares || a.name.localeCompare(b.name, "sv")) } } as const;
  });
}

/** Slå på eller av "Visa mig i topplistorna". */
export async function setMapStatsOptIn(db: Database, input: ClubProof & { enabled: boolean }, now = new Date())
  : Promise<{ status: "unauthorized" | "forbidden" } | { status: "ok"; optedIn: boolean }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    if (input.enabled) await tx.insert(schema.mapStatsOptIns).values({ accountId, enabledAt: now }).onConflictDoNothing();
    else await tx.delete(schema.mapStatsOptIns).where(eq(schema.mapStatsOptIns.accountId, accountId));
    return { status: "ok", optedIn: input.enabled } as const;
  });
}
