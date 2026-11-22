import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { regenerableMissingSchema, type RegenerableMissing } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject, sessionGate } from "./map-project-access";
import { createJob, type GeoJobFailure } from "./map-project-geo-jobs";
import type { LaserRuntime } from "./map-project-laser";
import { overLimitProjects, regenerableLimitBytes, regenerableRows } from "./map-regenerable";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * PLAN.md steg M4: när ett projekt öppnas och underlag saknas (taget ur förrådet, `map_content.stored_in = 'GONE'`) visar O-Tid
 * vad som saknas och kan återskapa det. En laserkörning körs om med samma begäran (rutor, klippruta, inställningar) och räknas
 * inte mot laserkvoten; när den är klar tar den över den gamla körningens underlag (samma id, namn, genomskinlighet och
 * ordning) och den gamla tas bort. Hämtade bilder hämtas om i webbläsaren med receptet och ersätter bilden i samma underlag
 * (`createMapProjectLayer` med `replaces`).
 */
const jobs = schema.mapProjectGeoJobs;
const LAYER_KEYS = ["layerId", "moistureLayerId", "shadeLayerId", "depthLayerId", "greenLayerId", "reliefLayerId", "rockLayerId"] as const;

/** Det som saknas i projektet (alla medlemmar ser det; bara den som får föreslå kan återskapa). */
export async function projectRegenerableMissing(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; missing: RegenerableMissing }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const runs = (await tx.execute<{ job_id: string; name: string | null; files: number; bytes: string }>(sql`select j.id as job_id, j.request->>'name' as name,
        count(*)::int as files, sum(c.byte_length)::text as bytes
      from map_project_geo_job j join map_project_geo_output o on o.job_id = j.id join map_content c on c.sha256 = o.content_sha256
      where j.project_id = ${access.project.id}::uuid and j.status = 'DONE' and c.stored_in = 'GONE'
      group by j.id order by max(j.finished_at) desc limit 50`)).rows;
    const layers = (await tx.execute<{ layer_id: string; name: string; source: string | null; job_id: string | null; bytes: number }>(sql`select l.id as layer_id,
        l.name, c.recipe->>'source' as source, c.recipe->>'jobId' as job_id, c.byte_length as bytes
      from map_project_layer l join map_content c on c.sha256 = l.content_sha256
      where l.project_id = ${access.project.id}::uuid and c.stored_in = 'GONE' order by l.sort desc, l.created_at limit 100`)).rows;
    const limit = await regenerableLimitBytes(tx, access.accountId);
    const missing = regenerableMissingSchema.parse({
      formatVersion: 1,
      laserRuns: runs.map(run => ({ jobId: run.job_id, name: (run.name ?? "Karttapullautin").slice(0, 200), files: run.files, bytes: Number(run.bytes) })),
      layers: layers.filter(layer => layer.source && ["LM_ORTHO", "SLU_MOISTURE", "SKS_FOREST", "WMS", "LASER"].includes(layer.source)).map(layer => ({
        layerId: layer.layer_id, name: layer.name.slice(0, 200), source: layer.source,
        jobId: layer.job_id && UUID_PATTERN.test(layer.job_id) ? layer.job_id : null, bytes: Number(layer.bytes) })),
      overLimitProjects: overLimitProjects(await regenerableRows(tx, { accountId: access.accountId }, now), limit)
    });
    return { status: "ok", missing } as const;
  });
}

type Regenerated = GeoJobFailure | { status: "queued"; jobId: string; replayed: boolean };

/**
 * «Återskapa»: kör om en klar laserkörning vars resultat tagits bort ur förrådet, med samma begäran, på det egna kontots
 * uppgifter till Lantmäteriet (Föreslå eller mer, projektet öppet). En omkörning som redan väntar eller pågår ges tillbaka.
 */
export async function regenerateGeoJob(db: Database, input: ClubProof & { projectId: string; jobId: string }, runtime: LaserRuntime, now = new Date())
  : Promise<Regenerated> {
  if (!UUID_PATTERN.test(input.jobId)) return { status: "not-found" };
  const prior = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.projectId, access.project.id)));
    if (!job || job.kind !== "PULLAUTIN" || job.status !== "DONE") return { status: "not-found" } as const;
    const [running] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.projectId, access.project.id), inArray(jobs.status, ["QUEUED", "RUNNING", "DONE"]),
      sql`${jobs.request}->>'regenerates' = ${job.id}`));
    if (running) return { status: "running", jobId: running.id } as const;
    const [gone] = (await tx.execute(sql`select 1 from map_project_geo_output o join map_content c on c.sha256 = o.content_sha256
      where o.job_id = ${job.id}::uuid and c.stored_in = 'GONE' limit 1`)).rows;
    if (!gone) return { status: "conflict" } as const;
    return { status: "found", job } as const;
  });
  if (prior.status === "running") return { status: "queued", jobId: prior.jobId, replayed: true };
  if (prior.status !== "found") return prior;
  const request = prior.job.request as { name?: string; settings?: unknown; cliffs?: unknown; moisture?: unknown; vegetation?: unknown };
  const body = { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: (request.name ?? "Karttapullautin").slice(0, 80), rerunOf: prior.job.id,
    settings: request.settings ?? {}, ...(request.cliffs ? { cliffs: request.cliffs } : {}), ...(request.moisture ? { moisture: request.moisture } : {}),
    ...(request.vegetation ? { vegetation: request.vegetation } : {}) };
  const created = await createJob(db, sessionGate(input, now), body, runtime, now, prior.job.id);
  return created.status === "created" ? { status: "queued", jobId: created.job.jobId, replayed: false } : created;
}

/**
 * En klar omkörning (inte en etapp) tar över den gamla körningens underlag: varje underlag som båda gav får den nya bildens
 * innehåll och georeferens men behåller id, namn, genomskinlighet och ordning; den nya körningens underlag tas bort och den gamla
 * körningen med sina filer. Ger körningens huvudunderlag.
 */
export async function adoptRegeneratedJob(tx: DbExecutor, jobId: string): Promise<{ layerId: string | null } | undefined> {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  const oldId = (job?.request as { regenerates?: unknown } | undefined)?.regenerates;
  if (!job || typeof oldId !== "string" || !UUID_PATTERN.test(oldId)) return undefined;
  const [old] = await tx.select().from(jobs).where(and(eq(jobs.id, oldId), eq(jobs.projectId, job.projectId))).for("update");
  if (!old) return undefined;
  const result: Record<string, unknown> = { ...job.result };
  const layers = schema.mapProjectLayers;
  for (const key of LAYER_KEYS) {
    const oldLayer = old.result?.[key], newLayer = result[key];
    if (typeof oldLayer !== "string" || !UUID_PATTERN.test(oldLayer)) continue;
    if (typeof newLayer === "string" && UUID_PATTERN.test(newLayer)) {
      const [fresh] = await tx.select().from(layers).where(and(eq(layers.id, newLayer), eq(layers.projectId, job.projectId)));
      if (fresh) {
        const moved = await tx.update(layers).set({ contentSha256: fresh.contentSha256, mediaType: fresh.mediaType, width: fresh.width, height: fresh.height,
          crs: fresh.crs, transform: fresh.transform }).where(and(eq(layers.id, oldLayer), eq(layers.projectId, job.projectId))).returning({ id: layers.id });
        if (moved.length) { await tx.delete(layers).where(eq(layers.id, fresh.id)); result[key] = oldLayer; }
        continue;
      }
    }
    // Den nya körningen gav inte det underlaget: det gamla pekar på innehåll som inte finns och tas bort.
    await tx.delete(layers).where(and(eq(layers.id, oldLayer), eq(layers.projectId, job.projectId)));
  }
  await tx.update(jobs).set({ result }).where(eq(jobs.id, job.id));
  await tx.delete(jobs).where(eq(jobs.id, old.id));
  return { layerId: typeof result.layerId === "string" ? result.layerId : null };
}
