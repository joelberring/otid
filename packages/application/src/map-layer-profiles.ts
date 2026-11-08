import { randomUUID } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import { mapLayerProfileCreateRequestSchema, type MapLayerProfileView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";

/**
 * ADR-0219 K6b (planen för baskartor): lagermappningsprofiler. Den som får föreslå i ett kartprojekt sparar en vektorfils
 * lager → symbolnummer som en profil, för sig själv eller delad med projektets klubb; nästa fil med samma lagernamn får
 * mappningen direkt (webbläsaren jämför lagren). Ett namn som redan finns hos kontot ersätts. Bara den som sparade tar bort.
 */
const profiles = schema.mapLayerProfiles;
const MAX_PROFILES = 100;

type Row = typeof profiles.$inferSelect;
const toView = (row: Row, viewer: string): MapLayerProfileView => ({ profileId: row.id, name: row.name, shared: row.clubId !== null,
  own: row.accountId === viewer, rules: row.rules, updatedAt: row.updatedAt.toISOString() });

/** Kontots egna profiler och de som delats med projektets klubb. */
export async function listMapLayerProfiles(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; profiles: MapLayerProfileView[] }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", false);
    if (access.status !== "ok") return access;
    const club = access.project.clubId;
    const rows = await tx.select().from(profiles).where(or(eq(profiles.accountId, access.accountId), club ? eq(profiles.clubId, club) : undefined))
      .orderBy(asc(profiles.name)).limit(MAX_PROFILES * 2);
    return { status: "ok", profiles: rows.map(row => toView(row, access.accountId)) } as const;
  });
}

export async function saveMapLayerProfile(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "saved"; profile: MapLayerProfileView }> {
  const parsed = mapLayerProfileCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const request = parsed.data;
    const [replayed] = await tx.select().from(profiles).where(eq(profiles.requestId, request.requestId));
    if (replayed) return replayed.accountId === access.accountId ? { status: "saved", profile: toView(replayed, access.accountId) } as const : { status: "conflict" } as const;
    const clubId = request.shareWithClub ? access.project.clubId : null;
    const rules = [...new Map(request.rules.map(rule => [rule.layer, rule])).values()];
    const [existing] = await tx.select().from(profiles).where(and(eq(profiles.accountId, access.accountId), eq(profiles.name, request.name))).for("update");
    if (existing) {
      const [updated] = await tx.update(profiles).set({ rules, clubId, updatedAt: now, requestId: request.requestId }).where(eq(profiles.id, existing.id)).returning();
      return { status: "saved", profile: toView(updated!, access.accountId) } as const;
    }
    const count = (await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.accountId, access.accountId))).length;
    if (count >= MAX_PROFILES) return { status: "conflict" } as const;
    const [created] = await tx.insert(profiles).values({ id: randomUUID(), accountId: access.accountId, clubId, name: request.name, rules,
      createdAt: now, updatedAt: now, requestId: request.requestId }).returning();
    return { status: "saved", profile: toView(created!, access.accountId) } as const;
  });
}

export async function deleteMapLayerProfile(db: Database, input: ClubProof & { projectId: string; profileId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.profileId)) return { status: "not-found" } as const;
    const deleted = await tx.delete(profiles).where(and(eq(profiles.id, input.profileId), eq(profiles.accountId, access.accountId))).returning({ id: profiles.id });
    return deleted.length ? { status: "deleted" } as const : { status: "not-found" } as const;
  });
}
