import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { clubMapsMergeRequestSchema, UUID_PATTERN, type ClubMapMergeResponse, type ClubMapMergeView } from "@o-tid/contracts";
import { schema, type ClubMapMergeAbsorbed, type Database } from "@o-tid/database";
import { clubJournal, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0210 beslut 2 och 5: "Slå ihop till en karta" och "Ångra sammanslagning". En sammanslagning ändrar bara metadata:
 * de uppgående kartornas versioner byter karta (filerna i kartinnehållet, ADR-0189, och dess referenser är orörda),
 * träningsgruppernas kartor som pekade på en uppgången karta pekar på den som behålls, och de tomma kartorna tas bort.
 * Banfilerna och träningarna pekar på sina exakta versioner, så de ändras inte. Allt som behövs för att ångra sparas i
 * `club_map_merge`; ångra går så länge kartan som behölls är oförändrad (samma versioner och ingen ändring av namnet eller
 * rättigheterna). Bara ägare och administratörer.
 */
type MapRow = typeof schema.clubMaps.$inferSelect;
type VersionRow = Pick<typeof schema.clubMapVersions.$inferSelect, "id" | "mapId">;

export type MergeResult = ClubFailure | { status: "ok"; response: ClubMapMergeResponse };

/** Kartans rad som JSON (datumen som text) och tillbaka. */
const mapRowJson = (map: MapRow): Record<string, unknown> => ({ ...map, createdAt: map.createdAt.toISOString(), updatedAt: map.updatedAt.toISOString() });
const mapRowOf = (json: Record<string, unknown>): MapRow => ({ ...json, createdAt: new Date(String(json.createdAt)),
  updatedAt: new Date(String(json.updatedAt)) }) as MapRow;

export async function mergeClubMaps(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date()): Promise<MergeResult> {
  const parsed = clubMapsMergeRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { keepMapId, mapIds } = parsed.data;
    const maps = await tx.select().from(schema.clubMaps).where(and(eq(schema.clubMaps.clubId, input.clubId), inArray(schema.clubMaps.id, mapIds)))
      .for("update");
    if (maps.length !== mapIds.length) return { status: "not-found" } as const;
    const keep = maps.find(map => map.id === keepMapId)!;
    const absorbedMaps = maps.filter(map => map.id !== keepMapId);
    const absorbedIds = absorbedMaps.map(map => map.id);
    const versions = await tx.select({ id: schema.clubMapVersions.id, mapId: schema.clubMapVersions.mapId }).from(schema.clubMapVersions)
      .where(inArray(schema.clubMapVersions.mapId, absorbedIds)).for("update");
    const groupMaps = await tx.select({ id: schema.trainingGroupMaps.id, clubMapId: schema.trainingGroupMaps.clubMapId }).from(schema.trainingGroupMaps)
      .where(inArray(schema.trainingGroupMaps.clubMapId, absorbedIds)).for("update");
    const absorbed: ClubMapMergeAbsorbed[] = absorbedMaps.map(map => ({ map: mapRowJson(map),
      versionIds: versions.filter(version => version.mapId === map.id).map(version => version.id),
      groupMapIds: groupMaps.filter(group => group.clubMapId === map.id).map(group => group.id) }));
    if (versions.length > 0) await tx.update(schema.clubMapVersions).set({ mapId: keep.id }).where(inArray(schema.clubMapVersions.id, versions.map(version => version.id)));
    if (groupMaps.length > 0) await tx.update(schema.trainingGroupMaps).set({ clubMapId: keep.id }).where(inArray(schema.trainingGroupMaps.id, groupMaps.map(group => group.id)));
    await tx.delete(schema.clubMaps).where(inArray(schema.clubMaps.id, absorbedIds));
    await tx.update(schema.clubMaps).set({ updatedAt: now }).where(eq(schema.clubMaps.id, keep.id));
    const targetVersionIds = (await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
      .where(eq(schema.clubMapVersions.mapId, keep.id))).map(row => row.id).sort();
    const mergeId = randomUUID();
    await tx.insert(schema.clubMapMerges).values({ id: mergeId, clubId: input.clubId, targetMapId: keep.id, absorbed, targetVersionIds,
      targetUpdatedAt: now, createdAt: now, createdBy: member.accountId });
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_MERGED", actorAccountId: member.accountId,
      details: { mergeId, into: keep.id, intoName: keep.name, from: absorbedIds, fromNames: absorbedMaps.map(map => map.name), versionsMoved: versions.length },
      now });
    return { status: "ok", response: { formatVersion: 1, mapId: keep.id, mergeId, versionsMoved: versions.length } } as const;
  });
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

/** Kan sammanslagningen ångras: inte redan ångrad, målet oförändrat och ingen av de uppgångna kartorna finns igen. */
function undoable(merge: typeof schema.clubMapMerges.$inferSelect, target: Pick<MapRow, "updatedAt"> | undefined, targetVersionIds: readonly string[],
  existing: ReadonlySet<string>): boolean {
  if (merge.undoneAt || !target) return false;
  if (target.updatedAt.getTime() !== merge.targetUpdatedAt.getTime()) return false;
  if (!sameSet(targetVersionIds, merge.targetVersionIds)) return false;
  return merge.absorbed.every(item => !existing.has(String(item.map.id)));
}

export async function undoClubMapMerge(db: Database, input: ClubProof & { clubId: string; mergeId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; mapIds: string[] }> {
  if (!UUID_PATTERN.test(input.mergeId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [merge] = await tx.select().from(schema.clubMapMerges)
      .where(and(eq(schema.clubMapMerges.id, input.mergeId), eq(schema.clubMapMerges.clubId, input.clubId))).for("update");
    if (!merge) return { status: "not-found" } as const;
    const [target] = await tx.select().from(schema.clubMaps)
      .where(and(eq(schema.clubMaps.id, merge.targetMapId), eq(schema.clubMaps.clubId, input.clubId))).for("update");
    const current = (await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
      .where(eq(schema.clubMapVersions.mapId, merge.targetMapId)).for("update")).map(row => row.id);
    const absorbedIds = merge.absorbed.map(item => String(item.map.id));
    const existing = new Set((await tx.select({ id: schema.clubMaps.id }).from(schema.clubMaps).where(inArray(schema.clubMaps.id, absorbedIds))).map(row => row.id));
    if (!undoable(merge, target, current, existing)) return { status: "conflict" } as const;
    for (const item of merge.absorbed) {
      const map = mapRowOf(item.map);
      await tx.insert(schema.clubMaps).values(map);
      if (item.versionIds.length > 0) {
        await tx.update(schema.clubMapVersions).set({ mapId: map.id })
          .where(and(inArray(schema.clubMapVersions.id, [...item.versionIds]), eq(schema.clubMapVersions.mapId, merge.targetMapId)));
      }
      if (item.groupMapIds.length > 0) {
        await tx.update(schema.trainingGroupMaps).set({ clubMapId: map.id })
          .where(and(inArray(schema.trainingGroupMaps.id, [...item.groupMapIds]), eq(schema.trainingGroupMaps.clubMapId, merge.targetMapId)));
      }
    }
    await tx.update(schema.clubMaps).set({ updatedAt: now }).where(eq(schema.clubMaps.id, merge.targetMapId));
    await tx.update(schema.clubMapMerges).set({ undoneAt: now, undoneBy: member.accountId }).where(eq(schema.clubMapMerges.id, merge.id));
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_MERGE_UNDONE", actorAccountId: member.accountId,
      details: { mergeId: merge.id, from: merge.targetMapId, restored: absorbedIds }, now });
    return { status: "ok", mapIds: [merge.targetMapId, ...absorbedIds] } as const;
  });
}

/** Kartornas sammanslagningar (nyaste först, högst tio per karta) med om de går att ångra. */
export async function mapMergeHistory(tx: DbExecutor, clubId: string, maps: readonly Pick<MapRow, "id" | "updatedAt">[], versions: readonly VersionRow[])
  : Promise<Map<string, ClubMapMergeView[]>> {
  if (maps.length === 0) return new Map();
  const rows = await tx.select().from(schema.clubMapMerges).where(and(eq(schema.clubMapMerges.clubId, clubId),
    inArray(schema.clubMapMerges.targetMapId, maps.map(map => map.id)))).orderBy(desc(schema.clubMapMerges.createdAt)).limit(2000);
  if (rows.length === 0) return new Map();
  const absorbedIds = [...new Set(rows.flatMap(row => row.absorbed.map(item => String(item.map.id))))];
  const existing = new Set((await tx.select({ id: schema.clubMaps.id }).from(schema.clubMaps).where(and(eq(schema.clubMaps.clubId, clubId),
    inArray(schema.clubMaps.id, absorbedIds)))).map(row => row.id));
  const byId = new Map(maps.map(map => [map.id, map]));
  const history = new Map<string, ClubMapMergeView[]>();
  for (const row of rows) {
    const list = history.get(row.targetMapId) ?? [];
    if (list.length >= 10) continue;
    const current = versions.filter(version => version.mapId === row.targetMapId).map(version => version.id);
    list.push({ mergeId: row.id, createdAt: row.createdAt.toISOString(), absorbedNames: row.absorbed.map(item => String(item.map.name)),
      versions: row.absorbed.reduce((sum, item) => sum + item.versionIds.length, 0), undoable: undoable(row, byId.get(row.targetMapId), current, existing),
      undoneAt: row.undoneAt?.toISOString() ?? null });
    history.set(row.targetMapId, list);
  }
  return history;
}
