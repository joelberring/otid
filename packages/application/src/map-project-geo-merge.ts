import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { GEO_OUTPUT_NAME } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { readMapContent } from "./map-content";
import { mapProjectAllows, requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * Ägaren 2026-11-14 («det verkade som den andra tråden inte gjorde ihopläsningen på servern. jag skulle vilja att det var
 * så»): en laserkörning som delats i etapper (`split` i `map-project-geo-jobs.ts`) läggs ihop till en körning på
 * geo-servern. När den sista etappen är klar köas ett jobb med `merge` i sin begäran; geo-arbetaren hämtar etappernas
 * filer, lägger ihop dem (`scripts/geo-merge.ts`) och skickar tillbaka dem som jobbets egna. När det jobbet är klart tas
 * etapperna och deras underlag bort, och rutorna flyttas till det sammanlagda jobbet (kvoten räknar dem där). Går
 * sammanläggningen fel står etapperna kvar som förut.
 */
const jobs = schema.mapProjectGeoJobs;
const outputs = schema.mapProjectGeoOutputs;
type Job = typeof jobs.$inferSelect;
type Clip = { minX: number; minY: number; maxX: number; maxY: number };
interface StageRequest { name?: string; clip?: Clip; tiles?: { id?: string }[]; split?: { group?: string; index?: number; total?: number } }
export interface GeoMerge { readonly group: string; readonly stages: readonly { readonly jobId: string; readonly clip: Clip }[]; readonly tiles: readonly unknown[] }

export const geoMergeOf = (job: Pick<Job, "request">): GeoMerge | undefined => {
  const merge = (job.request as { merge?: GeoMerge }).merge;
  return merge && Array.isArray(merge.stages) ? merge : undefined;
};

/**
 * Köar sammanläggningen när alla etapper i jobbets omgång är klara och ingen sammanläggning redan finns. Ger det nya jobbets
 * id, eller inget (jobbet är ingen etapp, någon etapp är inte klar, eller omgången är redan ihoplagd eller på väg).
 */
export async function queueStageMerge(tx: DbExecutor, job: Pick<Job, "projectId" | "request">, now: Date): Promise<string | undefined> {
  const split = (job.request as StageRequest).split;
  if (!split?.group || !(Number(split.total) > 1)) return undefined;
  const batch = await tx.select().from(jobs).where(and(eq(jobs.projectId, job.projectId), sql`${jobs.request}->'split'->>'group' = ${split.group}`)).for("update");
  const stages: Job[] = [];
  for (let index = 1; index <= Number(split.total); index += 1) {
    const stage = batch.find(row => (row.request as StageRequest).split?.index === index);
    if (!stage || stage.status !== "DONE" || !(stage.request as StageRequest).clip) return undefined;
    stages.push(stage);
  }
  const [existing] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.projectId, job.projectId),
    sql`${jobs.request}->'merge'->>'group' = ${split.group}`, inArray(jobs.status, ["QUEUED", "RUNNING", "DONE"])));
  if (existing) return undefined;
  const first = stages[0]!, request = first.request as StageRequest & Record<string, unknown>;
  const clips = stages.map(stage => (stage.request as StageRequest).clip!);
  const seen = new Set<string>();
  const tiles = stages.flatMap(stage => (stage.request as StageRequest).tiles ?? []).filter(tile => {
    const id = typeof tile.id === "string" ? tile.id : JSON.stringify(tile);
    return seen.has(id) ? false : (seen.add(id), true);
  });
  const { split: _split, tiles: _tiles, clip: _clip, name, ...rest } = request;
  const id = randomUUID();
  await tx.insert(jobs).values({ id, projectId: first.projectId, accountId: first.accountId, kind: "PULLAUTIN", status: "QUEUED", createdAt: now, requestId: randomUUID(),
    request: { ...rest, name: (name ?? "Karttapullautin").replace(/ – etapp \d+ av \d+$/, ""), tiles: [],
      clip: { minX: Math.min(...clips.map(c => c.minX)), minY: Math.min(...clips.map(c => c.minY)), maxX: Math.max(...clips.map(c => c.maxX)), maxY: Math.max(...clips.map(c => c.maxY)) },
      merge: { group: split.group, stages: stages.map(stage => ({ jobId: stage.id, clip: (stage.request as StageRequest).clip! })), tiles } satisfies GeoMerge } });
  return id;
}

/** Etapperna med sina filers namn, för geo-arbetaren som ska lägga ihop dem. */
export async function claimedStages(db: DbExecutor, merge: GeoMerge): Promise<{ jobId: string; clip: Clip; outputs: string[] }[]> {
  const files = merge.stages.length ? await db.select({ jobId: outputs.jobId, name: outputs.name }).from(outputs).where(inArray(outputs.jobId, merge.stages.map(stage => stage.jobId))) : [];
  return merge.stages.map(stage => ({ jobId: stage.jobId, clip: stage.clip, outputs: files.filter(file => file.jobId === stage.jobId).map(file => file.name).sort() }));
}

/** En etapps resultatfil för geo-arbetaren som kör sammanläggningen (bara etapper som jobbet lägger ihop). */
export async function readGeoStageOutput(db: Database, jobId: string, worker: string, stageId: string, name: string): Promise<Buffer | undefined> {
  if (!UUID_PATTERN.test(jobId) || !UUID_PATTERN.test(stageId) || !GEO_OUTPUT_NAME.test(name)) return undefined;
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.worker, worker), eq(jobs.status, "RUNNING")));
  if (!job || !geoMergeOf(job)?.stages.some(stage => stage.jobId === stageId)) return undefined;
  const [file] = await db.select({ sha: outputs.contentSha256 }).from(outputs).innerJoin(jobs, eq(jobs.id, outputs.jobId))
    .where(and(eq(outputs.jobId, stageId), eq(outputs.name, name), eq(jobs.projectId, job.projectId)));
  return file ? readMapContent(db, file.sha) : undefined;
}

/**
 * Sammanläggningen är klar: etapperna och underlagen de gav tas bort (filerna frigörs av den vanliga städningen), och
 * rutorna står nu på det sammanlagda jobbet.
 */
export async function completeStageMerge(tx: DbExecutor, job: Job, merge: GeoMerge): Promise<void> {
  const ids = merge.stages.map(stage => stage.jobId);
  const stages = ids.length ? await tx.select().from(jobs).where(and(eq(jobs.projectId, job.projectId), inArray(jobs.id, ids))).for("update") : [];
  const layerIds = stages.flatMap(stage => Object.entries(stage.result ?? {})
    .filter(([key, value]) => /LayerId$|^layerId$/.test(key) && typeof value === "string" && UUID_PATTERN.test(value)).map(([, value]) => value as string));
  if (layerIds.length) await tx.delete(schema.mapProjectLayers).where(and(eq(schema.mapProjectLayers.projectId, job.projectId), inArray(schema.mapProjectLayers.id, layerIds)));
  if (stages.length) await tx.delete(jobs).where(inArray(jobs.id, stages.map(stage => stage.id)));
  await tx.update(jobs).set({ request: { ...job.request, tiles: [...merge.tiles] } }).where(eq(jobs.id, job.id));
}

/**
 * «Lägg ihop etapperna» för en körning som delades innan geo-servern gjorde det själv: köar sammanläggningen för etappens
 * omgång. Den som startade körningen eller förvaltar projektet.
 */
export async function mergeGeoStages(db: Database, input: ClubProof & { projectId: string; jobId: string }, now = new Date())
  : Promise<ClubFailure | { status: "queued"; jobId: string }> {
  // Samma åtkomst som när en körning tas bort (`removeGeoJob`).
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.jobId)) return { status: "not-found" } as const;
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.projectId, access.project.id)));
    if (!job) return { status: "not-found" } as const;
    if (job.accountId !== access.accountId && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
    const id = await queueStageMerge(tx, job, now);
    return id ? { status: "queued", jobId: id } as const : { status: "conflict" } as const;
  });
}
