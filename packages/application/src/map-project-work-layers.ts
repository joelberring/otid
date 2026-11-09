import { and, asc, count, eq } from "drizzle-orm";
import {
  mapProjectSketchCreateRequestSchema, mapProjectWorkLayerCreateRequestSchema, mapProjectWorkLayerUpdateRequestSchema, type MapProjectSketchView,
  type MapProjectWorkLayerList, type MapProjectWorkLayerView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { mapProjectAllows, requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 (ägaren 2026-11-09, lagren fas 2): arbetslager och skisslager. Alla medlemmar ser dem; den som får föreslå eller mer
 * (projektet öppet) lägger till lager och skisser; den som skapade ett lager eller en skiss och ägarna ändrar och tar bort. Ett
 * skisslager tas bort med sina skisser.
 */
const layers = schema.mapProjectWorkLayers;
const sketches = schema.mapProjectSketches;
const MAX_LAYERS = 50;
const MAX_SKETCHES = 5000;

type LayerRow = typeof layers.$inferSelect & { name_: string | null };
const layerColumns = { id: layers.id, projectId: layers.projectId, kind: layers.kind, name: layers.name, codes: layers.codes, color: layers.color,
  createdBy: layers.createdBy, createdAt: layers.createdAt, name_: schema.userAccounts.displayName };

const layerView = (row: LayerRow, viewer: string): MapProjectWorkLayerView => ({ layerId: row.id, kind: row.kind, name: row.name, codes: row.codes,
  color: row.color, own: row.createdBy === viewer, createdBy: { accountId: row.createdBy, name: row.name_ }, createdAt: row.createdAt.toISOString() });
const sketchView = (row: typeof sketches.$inferSelect, viewer: string): MapProjectSketchView => ({ sketchId: row.id, layerId: row.layerId, kind: row.kind,
  points: row.points, text: row.text, own: row.accountId === viewer, createdAt: row.createdAt.toISOString() });

async function oneLayer(tx: DbExecutor, projectId: string, layerId: string): Promise<LayerRow | undefined> {
  const [row] = await tx.select(layerColumns).from(layers).leftJoin(schema.userAccounts, eq(schema.userAccounts.id, layers.createdBy))
    .where(and(eq(layers.id, layerId), eq(layers.projectId, projectId)));
  return row;
}

export async function listMapProjectWorkLayers(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectWorkLayerList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select(layerColumns).from(layers).leftJoin(schema.userAccounts, eq(schema.userAccounts.id, layers.createdBy))
      .where(eq(layers.projectId, access.project.id)).orderBy(asc(layers.createdAt), asc(layers.id)).limit(MAX_LAYERS);
    const drawn = await tx.select().from(sketches).where(eq(sketches.projectId, access.project.id))
      .orderBy(asc(sketches.createdAt), asc(sketches.id)).limit(MAX_SKETCHES);
    return { status: "ok", list: { formatVersion: 1, layers: rows.map(row => layerView(row, access.accountId)),
      sketches: drawn.map(row => sketchView(row, access.accountId)) } } as const;
  });
}

/** Nytt arbetslager eller skisslager (föreslå eller mer, projektet öppet). Idempotent på lagrets id. */
export async function createMapProjectWorkLayer(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; layer: MapProjectWorkLayerView }> {
  const parsed = mapProjectWorkLayerCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { layerId, kind, name, codes, color } = parsed.data;
    const [prior] = await tx.select({ projectId: layers.projectId, createdBy: layers.createdBy }).from(layers).where(eq(layers.id, layerId));
    if (prior) {
      if (prior.projectId !== access.project.id || prior.createdBy !== access.accountId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, layer: layerView((await oneLayer(tx, access.project.id, layerId))!, access.accountId) } as const;
    }
    const [total] = await tx.select({ value: count() }).from(layers).where(eq(layers.projectId, access.project.id));
    if (Number(total?.value ?? 0) >= MAX_LAYERS) return { status: "conflict" } as const;
    await tx.insert(layers).values({ id: layerId, projectId: access.project.id, kind, name, codes: kind === "SYMBOLS" ? [...new Set(codes)] : [],
      color: color ?? "#c0262d", createdBy: access.accountId, createdAt: now });
    return { status: "created", replayed: false, layer: layerView((await oneLayer(tx, access.project.id, layerId))!, access.accountId) } as const;
  });
}

/** Den som skapade lagret eller ägarna. */
async function ownLayer(tx: Parameters<typeof requireMapProject>[0], input: ClubProof & { projectId: string; layerId: string }, now: Date) {
  const access = await requireMapProject(tx, input, now, "view", true);
  if (access.status !== "ok") return access;
  if (!UUID_PATTERN.test(input.layerId)) return { status: "not-found" } as const;
  const row = await oneLayer(tx, access.project.id, input.layerId);
  if (!row) return { status: "not-found" } as const;
  if (row.createdBy !== access.accountId && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
  return { status: "ok" as const, access, row };
}

export async function updateMapProjectWorkLayer(db: Database, input: ClubProof & { projectId: string; layerId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; layer: MapProjectWorkLayerView }> {
  const parsed = mapProjectWorkLayerUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const found = await ownLayer(tx, input, now);
    if (found.status !== "ok") return found;
    if (!parsed.success || (parsed.data.codes && found.row.kind !== "SYMBOLS")) return { status: "invalid-request" } as const;
    const { name, codes, color } = parsed.data;
    await tx.update(layers).set({ ...(name ? { name } : {}), ...(codes ? { codes: [...new Set(codes)] } : {}), ...(color ? { color } : {}) })
      .where(eq(layers.id, found.row.id));
    return { status: "ok", layer: layerView((await oneLayer(tx, found.access.project.id, found.row.id))!, found.access.accountId) } as const;
  });
}

/** Tar bort lagret och (för ett skisslager) dess skisser. */
export async function deleteMapProjectWorkLayer(db: Database, input: ClubProof & { projectId: string; layerId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  return db.transaction(async tx => {
    const found = await ownLayer(tx, input, now);
    if (found.status !== "ok") return found;
    await tx.delete(sketches).where(eq(sketches.layerId, found.row.id));
    await tx.delete(layers).where(eq(layers.id, found.row.id));
    return { status: "deleted" } as const;
  });
}

/** Ny skiss i ett skisslager (föreslå eller mer, projektet öppet). Idempotent på skissens id. */
export async function createMapProjectSketch(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; sketch: MapProjectSketchView }> {
  const parsed = mapProjectSketchCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { sketchId, layerId, kind, points, text } = parsed.data;
    const [prior] = await tx.select().from(sketches).where(eq(sketches.id, sketchId));
    if (prior) {
      if (prior.projectId !== access.project.id || prior.accountId !== access.accountId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, sketch: sketchView(prior, access.accountId) } as const;
    }
    const layer = await oneLayer(tx, access.project.id, layerId);
    if (!layer || layer.kind !== "SKETCH") return { status: "not-found" } as const;
    const [total] = await tx.select({ value: count() }).from(sketches).where(eq(sketches.projectId, access.project.id));
    if (Number(total?.value ?? 0) >= MAX_SKETCHES) return { status: "conflict" } as const;
    const row = { id: sketchId, projectId: access.project.id, layerId, accountId: access.accountId, kind, points: points.map(([x, y]) => [x, y] as [number, number]),
      text: text ?? null, createdAt: now };
    await tx.insert(sketches).values(row);
    return { status: "created", replayed: false, sketch: sketchView(row, access.accountId) } as const;
  });
}

/** Den som ritade skissen eller ägarna. */
export async function deleteMapProjectSketch(db: Database, input: ClubProof & { projectId: string; sketchId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.sketchId)) return { status: "not-found" } as const;
    const [row] = await tx.select().from(sketches).where(and(eq(sketches.id, input.sketchId), eq(sketches.projectId, access.project.id)));
    if (!row) return { status: "not-found" } as const;
    if (row.accountId !== access.accountId && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
    await tx.delete(sketches).where(eq(sketches.id, row.id));
    return { status: "deleted" } as const;
  });
}
