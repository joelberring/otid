import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { GEO_DWG_INPUT, GEO_DWG_MAX_BYTES } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { contentHead, contentLength, mapStorageQuota, readMapContent, storeMapContent, type MapContentInput } from "./map-content";
import { requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";

/**
 * ADR-0219 K6b (ägaren 2026-11-09): en DWG-ritning (t.ex. en baskarta från kommunen) görs om till DXF av geo-arbetaren med
 * LibreDWG, så att den kan läsas in som kandidater som andra vektorfiler. Ritningen sparas som jobbets fil `indata.dwg` och
 * läses bara av geo-arbetaren; DWG-filen tolkas aldrig på O-Tids egen server (LibreDWG körs på geo-servern).
 */
const jobs = schema.mapProjectGeoJobs;
const outputs = schema.mapProjectGeoOutputs;
const ACTIVE_PER_ACCOUNT = 2;
/** DWG börjar med versionen, t.ex. "AC1015" (AutoCAD 2000) eller "AC1032" (2018). */
const DWG_MAGIC = /^AC10\d\d/;

export type DwgJobResult = ClubFailure | { status: "busy" } | { status: "quota" } | { status: "too-large" } | { status: "unsupported-file" }
  | { status: "created"; jobId: string; replayed: boolean };

export async function createDwgJob(db: Database, input: ClubProof & { projectId: string; requestId: string; fileName: string; file: MapContentInput },
  now = new Date()): Promise<DwgJobResult> {
  if (!UUID_PATTERN.test(input.requestId)) return { status: "invalid-request" };
  if (contentLength(input.file) > GEO_DWG_MAX_BYTES) return { status: "too-large" };
  if (!DWG_MAGIC.test(Buffer.from(contentHead(input.file).subarray(0, 6)).toString("latin1"))) return { status: "unsupported-file" };
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    const [prior] = await tx.select({ id: jobs.id, projectId: jobs.projectId, accountId: jobs.accountId }).from(jobs).where(eq(jobs.requestId, input.requestId));
    if (prior) {
      if (prior.projectId !== access.project.id || prior.accountId !== access.accountId) return { status: "conflict" } as const;
      return { status: "created", jobId: prior.id, replayed: true } as const;
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"geo-job:" + access.accountId}, 0))`);
    const [{ active } = { active: 0 }] = await tx.select({ active: sql<number>`count(*)::int` }).from(jobs)
      .where(and(eq(jobs.accountId, access.accountId), inArray(jobs.status, ["QUEUED", "RUNNING"])));
    if (active >= ACTIVE_PER_ACCOUNT) return { status: "busy" } as const;
    const stored = await storeMapContent(tx, input.file, access.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return { status: "quota" } as const;
    const id = randomUUID();
    const name = (input.fileName.replace(/\.dwg$/i, "").trim() || "Ritning").slice(0, 80);
    await tx.insert(jobs).values({ id, projectId: access.project.id, accountId: access.accountId, kind: "DWG", status: "QUEUED",
      request: { name, fileName: input.fileName.slice(0, 200) }, createdAt: now, requestId: input.requestId });
    await tx.insert(outputs).values({ jobId: id, name: GEO_DWG_INPUT, contentSha256: stored.sha256, mediaType: "application/acad",
      byteSize: contentLength(input.file), createdAt: now });
    return { status: "created", jobId: id, replayed: false } as const;
  });
}

/** Ritningen för geo-arbetaren (bara under ett pågående DWG-jobb som är arbetarens). */
export async function readGeoJobInput(db: Database, jobId: string, worker: string): Promise<Buffer | undefined> {
  if (!UUID_PATTERN.test(jobId)) return undefined;
  const [file] = await db.select({ sha: outputs.contentSha256 }).from(outputs).innerJoin(jobs, eq(jobs.id, outputs.jobId))
    .where(and(eq(outputs.jobId, jobId), eq(outputs.name, GEO_DWG_INPUT), eq(jobs.worker, worker), eq(jobs.status, "RUNNING"), eq(jobs.kind, "DWG")));
  return file ? readMapContent(db, file.sha) : undefined;
}
