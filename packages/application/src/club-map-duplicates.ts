import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CLUB_MAP_COPY_FIELDS, clubMapDuplicateDismissRequestSchema, clubMapVersionsCopyRequestSchema, UUID_PATTERN, type ClubMapCopyField,
  type ClubMapDuplicatesResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clusterDuplicates, duplicatePairKey, findDuplicatePairs, guessVersionYear, type DuplicateCandidate, type MapFingerprint } from "@o-tid/domain";
import { clubJournal, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0210 beslut 1, 2 och 4: förslagen om dubbletter ("Möjliga dubbletter"), "Inte samma karta" och "Kopiera till alla
 * versioner". Jämförelsen görs på det som redan är sparat (namnen, versionernas filnamn, fingeravtrycken från kontrollen och
 * träningarna); servern läser aldrig om kartfilerna. Bara ägare och administratörer.
 */
const pairs = (ids: readonly string[]) => ids.flatMap((a, index) => ids.slice(index + 1).map(b => a < b ? [a, b] as const : [b, a] as const));

async function candidates(tx: DbExecutor, clubId: string) {
  const maps = await tx.select({ id: schema.clubMaps.id, name: schema.clubMaps.name }).from(schema.clubMaps).where(eq(schema.clubMaps.clubId, clubId)).limit(2000);
  const versions = await tx.select({ id: schema.clubMapVersions.id, mapId: schema.clubMapVersions.mapId, fileName: schema.clubMapVersions.fileName,
    sourcePath: schema.clubMapVersions.sourcePath, versionDate: schema.clubMapVersions.versionDate, uploadedAt: schema.clubMapVersions.uploadedAt,
    versionYear: schema.clubMapVersions.versionYear, fingerprint: schema.clubMapVersionChecks.fingerprint })
    .from(schema.clubMapVersions).leftJoin(schema.clubMapVersionChecks, eq(schema.clubMapVersionChecks.versionId, schema.clubMapVersions.id))
    .where(eq(schema.clubMapVersions.clubId, clubId));
  const uses = (await tx.execute<{ version_id: string; entry_id: string }>(sql`select distinct version_id, entry_id from (
      select m.version_id, m.entry_id from club_archive_entry_map m join club_map_version v on v.id = m.version_id where v.club_id = ${clubId}
      union all select map_version_id, entry_id from club_archive_course_file where club_id = ${clubId} and map_version_id is not null) u`)).rows;
  const mapOfVersion = new Map(versions.map(version => [version.id, version.mapId]));
  const entries = new Map<string, Set<string>>();
  for (const use of uses) {
    const mapId = mapOfVersion.get(use.version_id);
    if (mapId) entries.set(mapId, (entries.get(mapId) ?? new Set()).add(use.entry_id));
  }
  // Versionerna per karta en gång (B5), inte en genomgång av alla versioner per karta.
  const versionsOf = new Map<string, typeof versions>();
  for (const version of versions) {
    const list = versionsOf.get(version.mapId);
    if (list) list.push(version); else versionsOf.set(version.mapId, [version]);
  }
  return maps.flatMap(map => {
    const own = versionsOf.get(map.id) ?? [];
    if (own.length === 0) return [];
    const candidate: DuplicateCandidate = { mapId: map.id, name: map.name, fileNames: own.map(version => version.fileName),
      fingerprints: own.flatMap(version => version.fingerprint ? [version.fingerprint] : []), entryIds: [...entries.get(map.id) ?? []] };
    const years = own.map(version => ({ version, year: guessVersionYear({ ...version, manualYear: version.versionYear }).year }))
      .sort((a, b) => b.year - a.year);
    const fingerprint = years.find(item => item.version.fingerprint)?.version.fingerprint ?? null;
    return [{ candidate, trainings: candidate.entryIds.length, newest: years[0]!.year, name: map.name, fingerprint }];
  });
}

function extentOf(mapId: string, fingerprint: MapFingerprint | null): ClubMapDuplicatesResponse["clusters"][number]["extents"][number] {
  if (!fingerprint) return { mapId, ground: null, paper: null };
  const { bounds, projected, scale } = fingerprint;
  return { mapId, ground: projected ? { width: Math.round(projected.extent.maxX - projected.extent.minX), height: Math.round(projected.extent.maxY - projected.extent.minY) } : null,
    paper: { width: Math.round(bounds.maxX - bounds.minX), height: Math.round(bounds.maxY - bounds.minY), scale } };
}

type Found = Awaited<ReturnType<typeof candidates>>;
type Clusters = ClubMapDuplicatesResponse["clusters"];

/** Grupperna ur kartorna och de bortvalda paren (alla par jämförs, `findDuplicatePairs`). */
function clusterCandidates(found: Found, dismissed: ReadonlySet<string>): Clusters {
  const byId = new Map(found.map(item => [item.candidate.mapId, item]));
  return clusterDuplicates(findDuplicatePairs(found.map(item => item.candidate), dismissed)).map(cluster => {
    // Förvalet: kartan med flest träningar, sedan den med nyaste versionen.
    const keep = [...cluster.mapIds].map(id => byId.get(id)!).sort((a, b) => b.trainings - a.trainings || b.newest - a.newest
      || a.name.localeCompare(b.name, "sv"))[0]!;
    return { mapIds: [...cluster.mapIds], keepMapId: keep.candidate.mapId, level: cluster.level, reasons: cluster.reasons.map(reason => ({ ...reason })),
      unchecked: cluster.mapIds.filter(id => byId.get(id)!.candidate.fingerprints.length === 0),
      extents: cluster.mapIds.map(id => extentOf(id, byId.get(id)!.fingerprint)) };
  });
}

/** Så många klubbars förslag sparas i serverns minne (de senast använda). */
const CACHED_CLUBS = 32;
const clusterCache = new Map<string, { readonly key: string; readonly clusters: Clusters }>();

/**
 * B5 (ADR-0218): jämförelsen av alla par växer med kvadraten på antalet kartor och gjordes vid varje öppning av fliken
 * Kartor. Förslagen sparas per klubb med en nyckel ur allt som jämförelsen bygger på (kartorna, versionernas namn,
 * fingeravtryck och år, träningarna och de bortvalda paren); ändras något av det räknas de om. Inget annat än det som
 * jämförs avgör svaret, så en sparad lista kan inte bli inaktuell.
 */
export function cachedDuplicateClusters(clubId: string, found: Found, dismissed: ReadonlySet<string>,
  compute: (found: Found, dismissed: ReadonlySet<string>) => Clusters = clusterCandidates): Clusters {
  const key = createHash("sha256").update(JSON.stringify([found, [...dismissed].sort()])).digest("hex");
  const cached = clusterCache.get(clubId);
  if (cached?.key === key) {
    clusterCache.delete(clubId);
    clusterCache.set(clubId, cached);
    return cached.clusters;
  }
  const clusters = compute(found, dismissed);
  clusterCache.delete(clubId);
  clusterCache.set(clubId, { key, clusters });
  while (clusterCache.size > CACHED_CLUBS) clusterCache.delete(clusterCache.keys().next().value!);
  return clusters;
}

export async function readClubMapDuplicates(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: ClubMapDuplicatesResponse }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, false);
    if (member.status !== "ok") return member;
    const found = await candidates(tx, input.clubId);
    const dismissed = new Set((await tx.select({ a: schema.clubMapDuplicateDismissals.mapA, b: schema.clubMapDuplicateDismissals.mapB })
      .from(schema.clubMapDuplicateDismissals).where(eq(schema.clubMapDuplicateDismissals.clubId, input.clubId))).map(row => duplicatePairKey(row.a, row.b)));
    const clusters = cachedDuplicateClusters(input.clubId, found, dismissed);
    return { status: "ok", response: { formatVersion: 1, clusters } } as const;
  });
}

/** "Inte samma karta": alla par bland kartorna sparas och föreslås aldrig igen. */
export async function dismissClubMapDuplicates(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; pairs: number }> {
  const parsed = clubMapDuplicateDismissRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const maps = await tx.select({ id: schema.clubMaps.id }).from(schema.clubMaps)
      .where(and(eq(schema.clubMaps.clubId, input.clubId), inArray(schema.clubMaps.id, parsed.data.mapIds)));
    if (maps.length !== parsed.data.mapIds.length) return { status: "not-found" } as const;
    const rows = pairs(parsed.data.mapIds).map(([mapA, mapB]) => ({ clubId: input.clubId, mapA, mapB, createdAt: now, createdBy: member.accountId }));
    await tx.insert(schema.clubMapDuplicateDismissals).values(rows).onConflictDoNothing();
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_DUPLICATE_DISMISSED", actorAccountId: member.accountId,
      details: { mapIds: parsed.data.mapIds }, now });
    return { status: "ok", pairs: rows.length } as const;
  });
}

/**
 * "Kopiera till alla versioner" (fälten från en version) och "Från kartan" (kartans kartritare). Varje ändrad version och
 * dess tidigare värden står i journalen.
 */
export async function copyClubMapVersionFields(db: Database, input: ClubProof & { clubId: string; mapId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; updated: number }> {
  const parsed = clubMapVersionsCopyRequestSchema.safeParse(input.request);
  if (!parsed.success || !UUID_PATTERN.test(input.mapId)) return { status: "invalid-request" };
  const { fromVersionId, fields, versionIds } = parsed.data;
  // Kartan har bara kartritaren av versionernas fält.
  if (fromVersionId === null && fields.some(field => field !== "maker")) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [map] = await tx.select().from(schema.clubMaps).where(and(eq(schema.clubMaps.id, input.mapId), eq(schema.clubMaps.clubId, input.clubId))).for("update");
    if (!map) return { status: "not-found" } as const;
    const versions = await tx.select({ id: schema.clubMapVersions.id, maker: schema.clubMapVersions.maker, note: schema.clubMapVersions.note })
      .from(schema.clubMapVersions).where(eq(schema.clubMapVersions.mapId, map.id)).for("update");
    const source = fromVersionId === null ? { maker: map.maker, note: null } : versions.find(version => version.id === fromVersionId);
    const targets = versions.filter(version => versionIds.includes(version.id) && version.id !== fromVersionId);
    if (!source || targets.length !== versionIds.filter(id => id !== fromVersionId).length) return { status: "not-found" } as const;
    const values: Partial<Record<ClubMapCopyField, string | null>> = Object.fromEntries(CLUB_MAP_COPY_FIELDS.filter(field => fields.includes(field))
      .map(field => [field, source[field]]));
    const changed = targets.filter(version => fields.some(field => version[field] !== values[field]));
    if (changed.length > 0) await tx.update(schema.clubMapVersions).set(values).where(inArray(schema.clubMapVersions.id, changed.map(version => version.id)));
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MAP_VERSIONS_COPIED", actorAccountId: member.accountId,
      details: { mapId: map.id, from: fromVersionId ?? "MAP", fields, versions: changed.map(version => ({ versionId: version.id,
        before: Object.fromEntries(fields.map(field => [field, version[field]])) })) }, now });
    return { status: "ok", updated: changed.length } as const;
  });
}
