import { and, count, eq } from "drizzle-orm";
import { mapProjectDecisionRequestSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";

const decisions = schema.mapProjectDecisions;
/** Högst så många beslut per projekt (ett per inlagt utkast); fler tas emot men sparas inte. */
const MAX_DECISIONS = 2_000;

/**
 * Ägaren 2026-11-21 (idé 1, «lär av kartritarens egna beslut»): ett utkast som lades in sparas som ett beslut – källan, inställningarna,
 * hur det lades in, lagren som erbjöds (antal, vald symbol, med eller inte) och nycklarna på det som lades till. Idempotent på id.
 * Den som får redigera (föreslå eller mer) sparar; projektet måste vara öppet.
 */
export async function recordMapProjectDecision(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "recorded"; replayed: boolean } | { status: "full" }> {
  const parsed = mapProjectDecisionRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const body = parsed.data;
    const [prior] = await tx.select({ projectId: decisions.projectId, accountId: decisions.accountId }).from(decisions).where(eq(decisions.id, body.decisionId));
    if (prior) return prior.projectId === access.project.id && prior.accountId === access.accountId ? { status: "recorded", replayed: true } as const : { status: "conflict" } as const;
    const [total] = await tx.select({ value: count() }).from(decisions).where(eq(decisions.projectId, access.project.id));
    if (Number(total?.value ?? 0) >= MAX_DECISIONS) return { status: "full" } as const;
    await tx.insert(decisions).values({ id: body.decisionId, projectId: access.project.id, accountId: access.accountId, source: body.source,
      geoJobId: body.geoJobId ?? null, settings: body.settings, mode: body.mode, layers: body.layers, addedKeys: body.addedKeys, createdAt: now });
    return { status: "recorded", replayed: false } as const;
  });
}

/** Projektets beslut, nyast först (för mätningen; ägarna). */
export async function listMapProjectDecisions(db: Database, input: ClubProof & { projectId: string }, now = new Date()) {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select().from(decisions).where(and(eq(decisions.projectId, access.project.id))).orderBy(decisions.createdAt);
    return { status: "ok" as const, list: rows.map(row => ({ decisionId: row.id, source: row.source, geoJobId: row.geoJobId, settings: row.settings, mode: row.mode,
      layers: row.layers, added: row.addedKeys.length, createdAt: row.createdAt.toISOString() })) };
  });
}
