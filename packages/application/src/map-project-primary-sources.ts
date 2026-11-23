import { and, asc, eq, sql } from "drizzle-orm";
import { MAP_PROJECT_PRIMARY_LIMITS, mapProjectPrimaryCreateRequestSchema, type MapProjectOsmOriginView, type MapProjectPrimaryKind,
  type MapProjectPrimarySourceView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { osmOnlyCodes } from "@o-tid/map-revision/base-map";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject, type MapProjectTransaction } from "./map-project-access";

const sources = schema.mapProjectPrimarySources;

/**
 * PLAN K4c Huvudkälla (ägaren 2026-11-23, migration 0143): kartprojektets huvudkällor – inlästa vektorfiler som går före
 * OpenStreetMap inom sitt område för de slag de täcker. Alla medlemmar läser dem (grundkartan hoppar över OpenStreetMap där);
 * den som får föreslå ändringar markerar och tar bort markeringen, som med det den läser in. Idempotent på id.
 */
export async function listMapProjectPrimarySources(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; sources: MapProjectPrimarySourceView[] }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    return { status: "ok" as const, sources: await primarySourcesOf(tx, access.project.id) };
  });
}

/** Projektets huvudkällor, äldst först (för grundkartan i AI-kopplingen också). */
export async function primarySourcesOf(tx: MapProjectTransaction, projectId: string): Promise<MapProjectPrimarySourceView[]> {
  const rows = await tx.select().from(sources).where(eq(sources.projectId, projectId)).orderBy(asc(sources.createdAt), asc(sources.id));
  return rows.map(row => ({ sourceId: row.id, name: row.name, kinds: row.kinds as MapProjectPrimaryKind[], area: row.area, createdAt: row.createdAt.toISOString() }));
}

export async function createMapProjectPrimarySource(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; source: MapProjectPrimarySourceView } | { status: "full" }> {
  const parsed = mapProjectPrimaryCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const body = parsed.data;
    const [prior] = await tx.select().from(sources).where(eq(sources.id, body.sourceId));
    if (prior) {
      if (prior.projectId !== access.project.id) return { status: "conflict" } as const;
      return { status: "created", replayed: true, source: { sourceId: prior.id, name: prior.name, kinds: prior.kinds as MapProjectPrimaryKind[], area: prior.area,
        createdAt: prior.createdAt.toISOString() } } as const;
    }
    const [total] = await tx.select({ value: sql<number>`count(*)::int` }).from(sources).where(eq(sources.projectId, access.project.id));
    if ((total?.value ?? 0) >= MAP_PROJECT_PRIMARY_LIMITS.sources) return { status: "full" } as const;
    const area = body.area.map(polygon => polygon.map(ring => ring.map(point => ({ x: point.x, y: point.y }))));
    await tx.insert(sources).values({ id: body.sourceId, projectId: access.project.id, name: body.name, area, kinds: [...new Set(body.kinds)],
      createdBy: access.accountId, createdAt: now });
    return { status: "created", replayed: false, source: { sourceId: body.sourceId, name: body.name, kinds: [...new Set(body.kinds)], area, createdAt: now.toISOString() } } as const;
  });
}

/** Tar bort markeringen (kartans objekt påverkas inte). En markering som redan är borta räknas som borttagen. */
export async function removeMapProjectPrimarySource(db: Database, input: ClubProof & { projectId: string; sourceId: string }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    await tx.delete(sources).where(and(eq(sources.projectId, access.project.id), eq(sources.id, input.sourceId)));
    return { status: "removed" } as const;
  });
}

/**
 * Ursprunget för kartans objekt (K4c): för varje inlagt utkast (0132) nycklarna på det som lades till och som ingen ändrat
 * sedan (version 1, inte borttaget), och symbolnumren som i utkastet bara kom ur OpenStreetMaps lager. Ur det avgör webben
 * vilka av OpenStreetMaps objekt som kan tas bort inom en huvudkälla; utkast utan rad här (före 0132) avgörs inte.
 */
export async function mapProjectOsmOrigin(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | ({ status: "ok" } & MapProjectOsmOriginView)> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select({ id: schema.mapProjectDecisions.id, layers: schema.mapProjectDecisions.layers })
      .from(schema.mapProjectDecisions).where(eq(schema.mapProjectDecisions.projectId, access.project.id)).orderBy(asc(schema.mapProjectDecisions.createdAt));
    const decisions: { codes: string[]; keys: string[] }[] = [];
    for (const row of rows) {
      const codes = osmOnlyCodes(row.layers);
      if (codes.length === 0) continue;
      const untouched = await tx.execute<{ object_key: string }>(sql`select o.object_key from map_project_decision d
        cross join lateral jsonb_array_elements_text(d.added_keys) as added(key)
        join map_project_object o on o.project_id = d.project_id and o.object_key = added.key
        where d.id = ${row.id}::uuid and o.version = 1 and o.state->>'kind' = 'OBJECT'`);
      const keys = untouched.rows.map(found => found.object_key);
      if (keys.length > 0) decisions.push({ codes, keys });
    }
    return { status: "ok" as const, decisions };
  });
}
