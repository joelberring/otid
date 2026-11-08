import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import {
  MAP_PROJECT_MAX_TRACKS, mapProjectChecksRequestSchema, mapProjectTrackCreateRequestSchema, mapProjectTrackPartRequestSchema,
  mapProjectTrackUpdateRequestSchema, type MapProjectCheckList, type MapProjectTrackList, type MapProjectTrackPoints, type MapProjectTrackView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 tillägget om rekningen (K3): GPS-spår och bekräftade objekt.
 *
 * - **Spåren** är personuppgifter (var någon gått). Alla medlemmar ser projektets spår med namn och datum; de syns aldrig
 *   publikt eller via delade länkar. Den som får föreslå eller mer (projektet öppet) lägger till spår; var och en döper om och
 *   tar bort sina egna, också i ett avslutat projekt. Spåren tas bort med kontot (`purgeMapProjectTracksForAccount`).
 * - **Bekräftelser** ("kollat") görs av den som får föreslå eller mer. En bekräftelse gäller objektets dåvarande senaste ändring
 *   (`basis`); sidan räknar bort den när objektet ändrats sedan (`checkStillValid` i map-revision). En ny bekräftelse av samma
 *   objekt ersätter den förra.
 */
const tracks = schema.mapProjectTracks, parts = schema.mapProjectTrackParts, checks = schema.mapProjectChecks;
type TrackRow = typeof tracks.$inferSelect;

const EARTH_M = 6_371_000;
function lengthOf(points: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lon1] = points[i - 1]!, [lat2, lon2] = points[i]!;
    const p1 = lat1! * Math.PI / 180, p2 = lat2! * Math.PI / 180;
    const dp = p2 - p1, dl = (lon2! - lon1!) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    total += 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

async function trackView(tx: DbExecutor, row: TrackRow, viewer: string): Promise<MapProjectTrackView> {
  const [account] = await tx.select({ name: schema.userAccounts.displayName }).from(schema.userAccounts).where(eq(schema.userAccounts.id, row.accountId));
  const seqs = await tx.select({ seq: parts.seq }).from(parts).where(eq(parts.trackId, row.id)).orderBy(asc(parts.seq));
  return view(row, account?.name ?? null, seqs.map(part => part.seq), viewer);
}

const view = (row: TrackRow, name: string | null, seqs: number[], viewer: string): MapProjectTrackView => ({ trackId: row.id, name: row.name,
  source: row.source, account: { accountId: row.accountId, name }, own: row.accountId === viewer, startedAt: row.startedAt?.toISOString() ?? null,
  endedAt: row.endedAt?.toISOString() ?? null, pointCount: row.pointCount, lengthM: Math.round(row.lengthM), createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(), parts: seqs });

/** Projektets spår (alla medlemmar), nyast först. */
export async function listMapProjectTracks(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectTrackList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select({ track: tracks, name: schema.userAccounts.displayName }).from(tracks)
      .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, tracks.accountId))
      .where(eq(tracks.projectId, access.project.id)).orderBy(asc(tracks.createdAt), asc(tracks.id)).limit(MAP_PROJECT_MAX_TRACKS);
    const ids = rows.map(row => row.track.id);
    const seqs = new Map<string, number[]>();
    if (ids.length > 0) {
      for (const part of await tx.select({ trackId: parts.trackId, seq: parts.seq }).from(parts).where(inArray(parts.trackId, ids)).orderBy(asc(parts.seq))) {
        const list = seqs.get(part.trackId) ?? [];
        list.push(part.seq);
        seqs.set(part.trackId, list);
      }
    }
    return { status: "ok", list: { formatVersion: 1, tracks: rows.map(row => view(row.track, row.name, seqs.get(row.track.id) ?? [], access.accountId)).reverse() } } as const;
  });
}

/** Spårets punkter (alla medlemmar). */
export async function mapProjectTrackPoints(db: Database, input: ClubProof & { projectId: string; trackId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; points: MapProjectTrackPoints }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.trackId)) return { status: "not-found" } as const;
    const [row] = await tx.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, input.trackId), eq(tracks.projectId, access.project.id)));
    if (!row) return { status: "not-found" } as const;
    const rows = await tx.select({ points: parts.points }).from(parts).where(eq(parts.trackId, row.id)).orderBy(asc(parts.seq));
    return { status: "ok", points: { formatVersion: 1, trackId: row.id, points: rows.flatMap(part => part.points) } } as const;
  });
}

/** Nytt spår (föreslå eller mer, projektet öppet). Idempotent på spårets id. */
export async function createMapProjectTrack(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; track: MapProjectTrackView }> {
  const parsed = mapProjectTrackCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { trackId, name, source, startedAt } = parsed.data;
    const [prior] = await tx.select().from(tracks).where(eq(tracks.id, trackId));
    if (prior) return prior.projectId === access.project.id && prior.accountId === access.accountId
      ? { status: "created", replayed: true, track: await trackView(tx, prior, access.accountId) } as const : { status: "conflict" } as const;
    const [total] = await tx.select({ value: count() }).from(tracks).where(eq(tracks.projectId, access.project.id));
    if (Number(total?.value ?? 0) >= MAP_PROJECT_MAX_TRACKS) return { status: "conflict" } as const;
    const [row] = await tx.insert(tracks).values({ id: trackId, projectId: access.project.id, accountId: access.accountId, name, source,
      startedAt: startedAt ? new Date(startedAt) : null, createdAt: now, updatedAt: now }).returning();
    return { status: "created", replayed: false, track: await trackView(tx, row!, access.accountId) } as const;
  });
}

async function ownTrack(tx: DbExecutor, projectId: string, trackId: string, accountId: string, lock: boolean) {
  if (!UUID_PATTERN.test(trackId)) return undefined;
  const query = tx.select().from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.projectId, projectId)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) return undefined;
  return row.accountId === accountId ? row : "forbidden" as const;
}

/** En del av ett eget spår (projektet öppet). Samma del två gånger görs en gång; en annan del med samma nummer är en krock. */
export async function addMapProjectTrackPart(db: Database, input: ClubProof & { projectId: string; trackId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; replayed: boolean; track: MapProjectTrackView }> {
  const parsed = mapProjectTrackPartRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    const row = await ownTrack(tx, access.project.id, input.trackId, access.accountId, true);
    if (!row) return { status: "not-found" } as const;
    if (row === "forbidden") return { status: "forbidden" } as const;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { seq, points, endedAt } = parsed.data;
    const [prior] = await tx.select({ points: parts.points }).from(parts).where(and(eq(parts.trackId, row.id), eq(parts.seq, seq)));
    if (prior) return JSON.stringify(prior.points) === JSON.stringify(points)
      ? { status: "ok", replayed: true, track: await trackView(tx, row, access.accountId) } as const : { status: "conflict" } as const;
    await tx.insert(parts).values({ trackId: row.id, seq, points, createdAt: now });
    const [next] = await tx.update(tracks).set({ pointCount: row.pointCount + points.length, lengthM: row.lengthM + lengthOf(points),
      ...(endedAt ? { endedAt: new Date(endedAt) } : {}), updatedAt: now }).where(eq(tracks.id, row.id)).returning();
    return { status: "ok", replayed: false, track: await trackView(tx, next!, access.accountId) } as const;
  });
}

/** Byt namn på ett eget spår. */
export async function updateMapProjectTrack(db: Database, input: ClubProof & { projectId: string; trackId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; track: MapProjectTrackView }> {
  const parsed = mapProjectTrackUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    const row = await ownTrack(tx, access.project.id, input.trackId, access.accountId, true);
    if (!row) return { status: "not-found" } as const;
    if (row === "forbidden") return { status: "forbidden" } as const;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const [next] = await tx.update(tracks).set({ name: parsed.data.name, updatedAt: now }).where(eq(tracks.id, row.id)).returning();
    return { status: "ok", track: await trackView(tx, next!, access.accountId) } as const;
  });
}

/** Ta bort ett eget spår (alla medlemmar, också i ett avslutat projekt). Bekräftelserna står kvar. */
export async function deleteMapProjectTrack(db: Database, input: ClubProof & { projectId: string; trackId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    const row = await ownTrack(tx, access.project.id, input.trackId, access.accountId, true);
    if (!row) return { status: "not-found" } as const;
    if (row === "forbidden") return { status: "forbidden" } as const;
    await tx.delete(tracks).where(eq(tracks.id, row.id));
    return { status: "deleted" } as const;
  });
}

/** Kontots alla spår i alla projekt (kontot tas bort). Delarna följer med (ON DELETE CASCADE). */
export async function purgeMapProjectTracksForAccount(tx: DbExecutor, accountId: string): Promise<void> {
  await tx.delete(tracks).where(eq(tracks.accountId, accountId));
}

/** Projektets bekräftelser (alla medlemmar). */
export async function listMapProjectChecks(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectCheckList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select({ check: checks, name: schema.userAccounts.displayName }).from(checks)
      .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, checks.accountId)).where(eq(checks.projectId, access.project.id));
    return { status: "ok", list: { formatVersion: 1, checks: rows.map(row => ({ key: row.check.objectKey, basis: row.check.basisEditId,
      accountId: row.check.accountId, name: row.name ?? null, at: row.check.checkedAt.toISOString() })) } } as const;
  });
}

/** Bekräfta objekt och ta bort bekräftelser (föreslå eller mer, projektet öppet). */
export async function changeMapProjectChecks(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; set: number; cleared: number }> {
  const parsed = mapProjectChecksRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const projectId = access.project.id;
    const set = [...new Map(parsed.data.set.map(row => [row.key, row])).values()];
    const clear = parsed.data.clear.filter(key => !set.some(row => row.key === key));
    if (set.length > 0) {
      await tx.insert(checks).values(set.map(row => ({ projectId, objectKey: row.key, accountId: access.accountId, basisEditId: row.basis, checkedAt: now })))
        .onConflictDoUpdate({ target: [checks.projectId, checks.objectKey], set: { accountId: access.accountId,
          basisEditId: sqlExcluded("basis_edit_id"), checkedAt: now } });
    }
    if (clear.length > 0) await tx.delete(checks).where(and(eq(checks.projectId, projectId), inArray(checks.objectKey, clear)));
    return { status: "ok", set: set.length, cleared: clear.length } as const;
  });
}

const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);
