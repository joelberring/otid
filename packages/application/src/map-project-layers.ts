import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import {
  MAP_PROJECT_LAYER_MAX_BYTES, mapProjectLayerMetadataSchema, mapProjectLayerUpdateRequestSchema, type MapProjectLayerList, type MapProjectLayerView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { imageDimensions } from "./image-dimensions";
import { contentHead, contentLength, mapStorageQuota, storeMapContent, type MapContentInput } from "./map-content";
import { mapProjectAllows, requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 tillägget om underlagen (K4a): egna georefererade bilder i kartprojektet (ortofoto, skannad gammal karta,
 * skuggning). Bilden förbereds i webbläsaren (GeoTIFF läses där och blir JPEG; en PNG eller JPEG får sin världsfil), så servern
 * tar bara emot PNG och JPEG och avkodar aldrig bilden; typen och måtten läses ur filens början (`imageDimensions`). Bilden
 * lagras som annat kartinnehåll (en gång per sha256, kvot per konto).
 *
 * Den som får föreslå eller mer (projektet öppet) lägger till underlag; den som lade till det och ägarna ändrar och tar bort.
 * Alla medlemmar ser underlagen.
 */
const layers = schema.mapProjectLayers;
const MAX_LAYERS = 50;

export type MapProjectLayerFailure = ClubFailure | { status: "quota" } | { status: "too-large" } | { status: "unsupported-file" };

async function rows(tx: DbExecutor, projectId: string, layerId?: string) {
  return tx.select({ layer: layers, byteLength: schema.mapContents.byteLength, creator: schema.userAccounts.displayName }).from(layers)
    .innerJoin(schema.mapContents, eq(schema.mapContents.sha256, layers.contentSha256))
    .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, layers.createdBy))
    .where(and(eq(layers.projectId, projectId), layerId ? eq(layers.id, layerId) : undefined)).orderBy(asc(layers.sort), asc(layers.createdAt));
}
function toView(row: Awaited<ReturnType<typeof rows>>[number], viewer: string): MapProjectLayerView {
  const layer = row.layer;
  return { layerId: layer.id, name: layer.name, mediaType: layer.mediaType, width: layer.width, height: layer.height, crs: layer.crs,
    transform: layer.transform, opacity: layer.opacity, sort: layer.sort, sha256: layer.contentSha256, byteLength: row.byteLength,
    createdBy: { accountId: layer.createdBy, name: row.creator }, own: layer.createdBy === viewer, createdAt: layer.createdAt.toISOString() };
}

export async function listMapProjectLayers(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectLayerList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    return { status: "ok", list: { formatVersion: 1, layers: (await rows(tx, access.project.id)).map(row => toView(row, access.accountId)) } } as const;
  });
}

/** Nytt underlag (Föreslå eller mer, projektet öppet). Idempotent på `requestId`. */
export async function createMapProjectLayer(db: Database, input: ClubProof & { projectId: string; metadata: unknown; file: MapContentInput },
  now = new Date()): Promise<MapProjectLayerFailure | { status: "created"; replayed: boolean; layer: MapProjectLayerView }> {
  const parsed = mapProjectLayerMetadataSchema.safeParse(input.metadata);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { requestId, name, crs, transform } = parsed.data;
    const [prior] = await tx.select().from(layers).where(eq(layers.requestId, requestId));
    if (prior) {
      if (prior.projectId !== access.project.id || prior.createdBy !== access.accountId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, layer: toView((await rows(tx, access.project.id, prior.id))[0]!, access.accountId) } as const;
    }
    if (contentLength(input.file) > MAP_PROJECT_LAYER_MAX_BYTES) return { status: "too-large" } as const;
    const image = imageDimensions(contentHead(input.file));
    if (!image) return { status: "unsupported-file" } as const;
    const [total] = await tx.select({ value: count() }).from(layers).where(eq(layers.projectId, access.project.id));
    if (Number(total?.value ?? 0) >= MAX_LAYERS) return { status: "conflict" } as const;
    const stored = await storeMapContent(tx, input.file, access.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return { status: "quota" } as const;
    const id = randomUUID();
    await tx.insert(layers).values({ id, projectId: access.project.id, name, contentSha256: stored.sha256, mediaType: image.mediaType, width: image.width,
      height: image.height, crs, transform, opacity: 0.5, sort: Number(total?.value ?? 0), createdBy: access.accountId, createdAt: now, requestId });
    return { status: "created", replayed: false, layer: toView((await rows(tx, access.project.id, id))[0]!, access.accountId) } as const;
  });
}

async function ownOrOwner(tx: Parameters<typeof requireMapProject>[0], input: ClubProof & { projectId: string; layerId: string }, now: Date) {
  const access = await requireMapProject(tx, input, now, "view", true);
  if (access.status !== "ok") return access;
  if (!UUID_PATTERN.test(input.layerId)) return { status: "not-found" } as const;
  const [row] = await tx.select().from(layers).where(and(eq(layers.id, input.layerId), eq(layers.projectId, access.project.id)));
  if (!row) return { status: "not-found" } as const;
  if (row.createdBy !== access.accountId && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
  return { status: "ok" as const, access, row };
}

/** Byt namn, genomskinlighet, ordning och georeferens (den som lade till det eller ägarna). */
export async function updateMapProjectLayer(db: Database, input: ClubProof & { projectId: string; layerId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; layer: MapProjectLayerView }> {
  const parsed = mapProjectLayerUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const found = await ownOrOwner(tx, input, now);
    if (found.status !== "ok") return found;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { name, opacity, sort, crs, transform } = parsed.data;
    await tx.update(layers).set({ ...(name ? { name } : {}), ...(opacity !== undefined ? { opacity } : {}), ...(sort !== undefined ? { sort } : {}),
      ...(crs !== undefined && transform ? { crs, transform } : {}) })
      .where(eq(layers.id, found.row.id));
    return { status: "ok", layer: toView((await rows(tx, found.access.project.id, found.row.id))[0]!, found.access.accountId) } as const;
  });
}

/** Ta bort underlaget; innehållet släpps när ingen annan pekar på det (utlösaren i migration 0097). */
export async function deleteMapProjectLayer(db: Database, input: ClubProof & { projectId: string; layerId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  return db.transaction(async tx => {
    const found = await ownOrOwner(tx, input, now);
    if (found.status !== "ok") return found;
    await tx.delete(layers).where(eq(layers.id, found.row.id));
    return { status: "deleted" } as const;
  });
}

/** Bildens innehåll att strömma (alla medlemmar). */
export async function readMapProjectLayerImage(db: Database, input: ClubProof & { projectId: string; layerId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; mediaType: string; byteLength: number; contentId: string; sha256: string }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.layerId)) return { status: "not-found" } as const;
    const [row] = await tx.select({ mediaType: layers.mediaType, sha256: layers.contentSha256, byteLength: schema.mapContents.byteLength,
      contentId: schema.mapContents.contentId }).from(layers).innerJoin(schema.mapContents, eq(schema.mapContents.sha256, layers.contentSha256))
      .where(and(eq(layers.id, input.layerId), eq(layers.projectId, access.project.id)));
    return row ? { status: "ok", ...row } as const : { status: "not-found" } as const;
  });
}
