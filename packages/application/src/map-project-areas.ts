import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import {
  mapProjectAreaCreateRequestSchema, mapProjectAreaUpdateRequestSchema, type MapProjectAreaList, type MapProjectAreaView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { areaPolygonProblem, type WorkArea } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { mapProjectAllows, mapProjectJournal, requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 tillägget om arbetssätt (K1): delområden som delas ut till personer. I det egna området ritar man direkt, i någon
 * annans blir ändringarna förslag (`editRoute` i map-revision). Projektets ägare skapar, ändrar och tar bort områden; den som
 * fått ett område får ändra dess status (underlag, grundritat, rekat, klart) och revideringsdatum (etapperna, 0098). Alla medlemmar ser områdena.
 *
 * Den som fått området har ingen främmande nyckel (migration 0091): den nollställs här när personen tas bort ur projektet och när
 * kontot tas bort (`clearAreaAssignee`).
 */
/** Så många delområden får ett projekt ha. */
const MAX_AREAS = 500;
const areas = schema.mapProjectAreas;
type AreaRow = typeof areas.$inferSelect;

/** Projektets områden som regeln i map-revision vill ha dem. */
export async function workAreas(tx: DbExecutor, projectId: string): Promise<WorkArea[]> {
  return (await tx.select({ polygon: areas.polygon, assigneeId: areas.assigneeAccountId }).from(areas).where(eq(areas.projectId, projectId))
    .limit(MAX_AREAS)).map(row => ({ polygon: row.polygon, assigneeId: row.assigneeId }));
}

const view = (row: AreaRow, name: string | null | undefined): MapProjectAreaView => ({ areaId: row.id, name: row.name, polygon: row.polygon,
  assignee: row.assigneeAccountId ? { accountId: row.assigneeAccountId, name: name ?? null } : null, status: row.status, sort: row.sort,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), revisedOn: row.revisedOn ?? null });

/** Projektets områden i ordning (sortering, sedan namn), med namnet på den som fått området. */
export async function mapProjectAreaViews(tx: DbExecutor, projectId: string): Promise<MapProjectAreaView[]> {
  const rows = await tx.select({ area: areas, name: schema.userAccounts.displayName }).from(areas)
    .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, areas.assigneeAccountId))
    .where(eq(areas.projectId, projectId)).orderBy(asc(areas.sort), asc(areas.name), asc(areas.id)).limit(MAX_AREAS);
  return rows.map(row => view(row.area, row.name));
}

/** Nollställer den som fått områden (i ett projekt, eller i alla när `projectId` saknas): personen togs bort eller kontot togs bort. */
export async function clearAreaAssignee(tx: DbExecutor, accountId: string, now: Date, projectId?: string): Promise<void> {
  await tx.update(areas).set({ assigneeAccountId: null, updatedAt: now })
    .where(and(eq(areas.assigneeAccountId, accountId), projectId ? eq(areas.projectId, projectId) : undefined));
}

async function isMember(tx: DbExecutor, projectId: string, accountId: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.mapProjectMembers.accountId }).from(schema.mapProjectMembers)
    .where(and(eq(schema.mapProjectMembers.projectId, projectId), eq(schema.mapProjectMembers.accountId, accountId)));
  return !!row;
}

async function oneView(tx: DbExecutor, row: AreaRow): Promise<MapProjectAreaView> {
  if (!row.assigneeAccountId) return view(row, null);
  const [account] = await tx.select({ name: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, row.assigneeAccountId));
  return view(row, account?.name);
}

export async function listMapProjectAreas(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectAreaList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    return { status: "ok", list: { formatVersion: 1, areas: await mapProjectAreaViews(tx, access.project.id) } } as const;
  });
}

/** Nytt delområde (ägarna). Den som får området ska vara medlem. Idempotent på `requestId`. */
export async function createMapProjectArea(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; area: MapProjectAreaView }> {
  const parsed = mapProjectAreaCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success || areaPolygonProblem(parsed.data.polygon)) return { status: "invalid-request" } as const;
    const { requestId, name, polygon, assigneeAccountId, status, sort } = parsed.data;
    const projectId = access.project.id;
    const [prior] = await tx.select().from(areas).where(eq(areas.requestId, requestId));
    if (prior) return prior.projectId === projectId ? { status: "created", replayed: true, area: await oneView(tx, prior) } as const
      : { status: "conflict" } as const;
    if (assigneeAccountId && !await isMember(tx, projectId, assigneeAccountId)) return { status: "invalid-request" } as const;
    const [total] = await tx.select({ value: count() }).from(areas).where(eq(areas.projectId, projectId));
    if (Number(total?.value ?? 0) >= MAX_AREAS) return { status: "conflict" } as const;
    const [row] = await tx.insert(areas).values({ id: randomUUID(), projectId, name, polygon, assigneeAccountId: assigneeAccountId ?? null,
      status: status ?? "BASE", sort: sort ?? 0, createdBy: access.accountId, createdAt: now, updatedAt: now, requestId }).returning();
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_AREA_CREATED", actorAccountId: access.accountId,
      details: { projectId, areaId: row!.id }, now });
    return { status: "created", replayed: false, area: await oneView(tx, row!) } as const;
  });
}

/** Ändra ett delområde: ägarna allt; den som fått området bara statusen (medan projektet är öppet). */
export async function updateMapProjectArea(db: Database, input: ClubProof & { projectId: string; areaId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; area: MapProjectAreaView }> {
  const parsed = mapProjectAreaUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.areaId)) return { status: "not-found" } as const;
    const where = and(eq(areas.id, input.areaId), eq(areas.projectId, access.project.id));
    const [row] = await tx.select().from(areas).where(where).for("update");
    if (!row) return { status: "not-found" } as const;
    if (!parsed.success || (parsed.data.polygon && areaPolygonProblem(parsed.data.polygon))) return { status: "invalid-request" } as const;
    const { name, polygon, assigneeAccountId, status, sort } = parsed.data;
    // Etapperna: ett område som blir klart utan datum får dagens (det som redan står ändras inte).
    const revisedOn = parsed.data.revisedOn !== undefined ? parsed.data.revisedOn
      : status === "DONE" && row.status !== "DONE" && !row.revisedOn ? now.toISOString().slice(0, 10) : undefined;
    const change = { name, polygon, assigneeAccountId, status, sort, revisedOn };
    const owner = mapProjectAllows(access.role, access.project, "manage");
    // Den som fått området får ändra statusen och revideringsdatumet.
    const onlyStatus = Object.entries(change).every(([key, value]) => key === "status" || key === "revisedOn" || value === undefined);
    const assignee = row.assigneeAccountId === access.accountId && mapProjectAllows(access.role, access.project, "propose");
    if (!owner && !(assignee && onlyStatus)) return { status: "forbidden" } as const;
    if (change.assigneeAccountId && !await isMember(tx, access.project.id, change.assigneeAccountId)) return { status: "invalid-request" } as const;
    const [next] = await tx.update(areas).set({ ...change, updatedAt: now }).where(where).returning();
    await mapProjectJournal(tx, access.project, { action: onlyStatus ? "MAP_PROJECT_AREA_STATUS_CHANGED" : "MAP_PROJECT_AREA_CHANGED",
      actorAccountId: access.accountId, details: { projectId: access.project.id, areaId: row.id, ...(change.status ? { status: change.status } : {}),
        ...(change.revisedOn !== undefined ? { revisedOn: change.revisedOn } : {}) },
      now });
    return { status: "ok", area: await oneView(tx, next!) } as const;
  });
}

/** Ta bort ett delområde (ägarna). Ändringarna som gjorts i det står kvar. */
export async function deleteMapProjectArea(db: Database, input: ClubProof & { projectId: string; areaId: string }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.areaId)) return { status: "not-found" } as const;
    const [row] = await tx.delete(areas).where(and(eq(areas.id, input.areaId), eq(areas.projectId, access.project.id))).returning({ id: areas.id });
    if (!row) return { status: "not-found" } as const;
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_AREA_REMOVED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, areaId: row.id }, now });
    return { status: "removed" } as const;
  });
}

