import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import { queueMapJob } from "./map-project-jobs";
import type { MapPdfResult } from "./map-project-job-pdf";

/**
 * Ägaren 2026-11-15: «Skriv ut PDF» i kartläget. Webben lägger ett jobb (MAP_PDF) i kartjobbskön och frågar sedan efter det;
 * utskriftsarbetaren ritar hela kartan med sparade ändringar. Den som får se projektet får skriva ut det.
 */
export async function startMapProjectPdf(
  db: Database,
  input: ClubProof & { projectId: string; mode?: "OFFICE" | "PRESS" | undefined; lightenForOffice?: boolean | undefined },
  now = new Date()
): Promise<ClubFailure | { status: "throttled" } | { status: "ok"; jobId: string }> {
  const access = await db.transaction(tx => requireMapProject(tx, input, now, "view", true));
  if (access.status !== "ok") return access;
  const request: Record<string, unknown> = {
    title: access.project.name,
    ...(input.mode === "PRESS" || input.mode === "OFFICE" ? { mode: input.mode } : {}),
    ...(input.lightenForOffice === true ? { lightenForOffice: true } : {})
  };
  const jobId = await queueMapJob(db, { accountId: access.accountId, projectId: access.project.id, kind: "MAP_PDF", request }, now);
  return jobId ? { status: "ok", jobId } : { status: "throttled" };
}

export async function readMapProjectPdf(db: Database, input: ClubProof & { projectId: string; jobId: string }, now = new Date())
  : Promise<ClubFailure | { status: "waiting" } | { status: "failed"; error: string } | { status: "ok"; fileName: string; bytes: Uint8Array; result: MapPdfResult }> {
  if (!UUID_PATTERN.test(input.jobId)) return { status: "not-found" };
  const access = await db.transaction(tx => requireMapProject(tx, input, now, "view", false));
  if (access.status !== "ok") return access;
  const [job] = await db.select({ status: schema.mapProjectJobs.status, image: schema.mapProjectJobs.image, result: schema.mapProjectJobs.result, error: schema.mapProjectJobs.error })
    .from(schema.mapProjectJobs).where(and(eq(schema.mapProjectJobs.id, input.jobId), eq(schema.mapProjectJobs.projectId, access.project.id),
      eq(schema.mapProjectJobs.accountId, access.accountId), eq(schema.mapProjectJobs.kind, "MAP_PDF")));
  if (!job) return { status: "not-found" };
  if (job.status === "FAILED") return { status: "failed", error: job.error ?? "Utskriften misslyckades" };
  if (job.status !== "DONE" || !job.image) return { status: "waiting" };
  const stem = access.project.name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "karta";
  return { status: "ok", fileName: `${stem}.pdf`, bytes: new Uint8Array(job.image), result: job.result as MapPdfResult };
}
