import { syncApplyResponseSchema, type SyncApplyRequest } from "@o-tid/contracts";
import { courseSettingBase, previewCourseSettingTransfer } from "./course-setting-api";
import { adminFetch } from "./retrying-fetch";

/** Vad "Använd igen" förde över till tidtagningen: banornas och de nya klassernas namn, eller varför det inte gick. */
export type ReuseTransferOutcome = { kind: "done"; courses: string[]; classes: string[] } | { kind: "failed"; reason: "problem" | "confirm" | "error" };

/**
 * Användartestet 2026-11-12 (A): efter Använd igen förs banläggningens banor över till tävlingen med samma funktion som
 * Fil → Överför till tävlingen (förhandsvisningen, sedan banfilens godkännande), utan att visa förhandsvisningen: tävlingen
 * är ny och tom. Skulle godkännandet kräva en bekräftelse (resultat som ändras) görs ingenting; det ska inte hända i en tom
 * tävling, och då får banläggaren göra det själv med förhandsvisningen.
 */
export async function transferReusedCourses(raceId: string, version: number): Promise<ReuseTransferOutcome> {
  const preview = await previewCourseSettingTransfer(raceId, version);
  if (preview.kind !== "preview") return { kind: "failed", reason: preview.kind === "problem" ? "problem" : "error" };
  const { snapshotId, consequence, rows } = preview.preview;
  if (consequence.requiresConfirmation) return { kind: "failed", reason: "confirm" };
  const request: SyncApplyRequest = { formatVersion: 1, requestId: crypto.randomUUID(), snapshotId, excludedRowIds: [], confirmResultChanges: false };
  const response = await adminFetch(`${courseSettingBase(raceId)}/source-sync`, { method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `source-sync:${request.requestId}` }, body: JSON.stringify(request) });
  if (!response.ok) return { kind: "failed", reason: "error" };
  const receipt = syncApplyResponseSchema.parse(await response.json());
  if (receipt.requestId !== request.requestId || receipt.raceId !== raceId) return { kind: "failed", reason: "error" };
  const named = (subject: "COURSE" | "CLASS") => rows.filter(row => row.subject === subject && row.kind === "NEW").map(row => row.label);
  return { kind: "done", courses: named("COURSE"), classes: named("CLASS") };
}
