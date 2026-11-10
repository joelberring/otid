import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { courseSettingRead, courseSettingWrite, type Failure, type ReadProof } from "./course-setting";
import type { RaceSessionProof } from "./race-session";
import { sha256Hex } from "./serialization";

/**
 * Ägaren 2026-11-10 (ADR-0221 tillägg): utskrifternas PDF:er sparade i träningen. De som får läsa banläggningen (också den
 * med en uppgift i terminsplanen) ser och laddar ner dem; den som får ändra sparar och tar bort. Tryckjobbens PDF:er rensas
 * efter sju dagar; en sparad kopia här ligger kvar.
 */
export const RACE_PRINT_FILE_LIMITS = { maxBytes: 40_000_000, perRace: 30 } as const;

export interface RacePrintFileView {
  readonly fileId: string; readonly fileName: string; readonly label: string; readonly source: "UPLOAD" | "PRINT_JOB";
  readonly byteLength: number; readonly createdAt: string; readonly createdBy: string | null;
}

const columns = {
  id: schema.racePrintFiles.id, fileName: schema.racePrintFiles.fileName, label: schema.racePrintFiles.label, source: schema.racePrintFiles.source,
  byteLength: schema.racePrintFiles.byteLength, createdAt: schema.racePrintFiles.createdAt, createdBy: schema.racePrintFiles.createdBy
};

/** Filnamnet utan katalog och med .pdf, högst 120 tecken. */
export function printFileName(name: string): string {
  const base = [...(name.split(/[\\/]/).pop() ?? "")].filter(char => char >= " " && char !== "\"").join("").trim().slice(0, 116) || "utskrift";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

const isPdf = (bytes: Uint8Array) => bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

export async function listRacePrintFiles(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; files: RacePrintFileView[] }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const rows = await tx.select({ ...columns, name: schema.userAccounts.displayName }).from(schema.racePrintFiles)
      .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.racePrintFiles.createdBy))
      .where(eq(schema.racePrintFiles.raceId, raceId)).orderBy(asc(schema.racePrintFiles.createdAt)).limit(RACE_PRINT_FILE_LIMITS.perRace);
    return { status: "ok" as const, files: rows.map(row => ({ fileId: row.id, fileName: row.fileName, label: row.label, source: row.source,
      byteLength: row.byteLength, createdAt: row.createdAt.toISOString(), createdBy: row.name || null })) };
  }, "COMMENT");
}

export async function readRacePrintFile(db: Database, input: ReadProof & { fileId: string }, now = new Date())
  : Promise<Failure | { status: "ok"; pdf: Uint8Array; fileName: string }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const [row] = await tx.select({ pdf: schema.racePrintFiles.pdf, fileName: schema.racePrintFiles.fileName }).from(schema.racePrintFiles)
      .where(and(eq(schema.racePrintFiles.raceId, raceId), eq(schema.racePrintFiles.id, input.fileId)));
    return row ? { status: "ok" as const, pdf: row.pdf as Uint8Array, fileName: row.fileName } : { status: "not-found" as const };
  }, "COMMENT");
}

type SaveResult = Failure | { status: "too-many" } | { status: "ok"; file: RacePrintFileView };

/** En egen PDF (kontrolleras: börjar med %PDF-, högst 40 MB) eller ett klart tryckjobbs PDF (`fromJobId`). */
export async function saveRacePrintFile(db: Database, input: RaceSessionProof & { fileName: string; label: string } &
  ({ pdf: Uint8Array } | { fromJobId: string }), now = new Date()): Promise<SaveResult> {
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.racePrintFiles).where(eq(schema.racePrintFiles.raceId, raceId));
    if ((count?.n ?? 0) >= RACE_PRINT_FILE_LIMITS.perRace) return { status: "too-many" as const };
    let pdf: Uint8Array, source: "UPLOAD" | "PRINT_JOB", fileName = input.fileName, label = input.label;
    if ("fromJobId" in input) {
      const [job] = await tx.select({ pdf: schema.courseSettingPrintJobs.pdf, status: schema.courseSettingPrintJobs.status,
        label: schema.courseSettingPrintJobs.label }).from(schema.courseSettingPrintJobs)
        .where(and(eq(schema.courseSettingPrintJobs.raceId, raceId), eq(schema.courseSettingPrintJobs.id, input.fromJobId)));
      if (!job || job.status !== "DONE" || !job.pdf) return { status: "not-found" as const };
      pdf = job.pdf as Uint8Array; source = "PRINT_JOB"; label = label || job.label;
    } else {
      if (!isPdf(input.pdf) || input.pdf.byteLength > RACE_PRINT_FILE_LIMITS.maxBytes) return { status: "invalid-request" as const };
      pdf = input.pdf; source = "UPLOAD";
    }
    fileName = printFileName(fileName);
    const id = randomUUID();
    const [row] = await tx.insert(schema.racePrintFiles).values({ id, raceId, fileName, label: label.trim().slice(0, 200), source,
      pdf: Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength),
      byteLength: pdf.byteLength, sha256: sha256Hex(pdf), createdBy: actorId, createdAt: now }).returning(columns);
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_PRINT_FILE_SAVED",
      actorKind: "USER_ACCOUNT", actorId, after: { fileId: id, fileName, source, byteLength: pdf.byteLength }, createdAt: now });
    return { status: "ok" as const, file: { fileId: row!.id, fileName: row!.fileName, label: row!.label, source: row!.source,
      byteLength: row!.byteLength, createdAt: row!.createdAt.toISOString(), createdBy: null } };
  });
}

export async function removeRacePrintFile(db: Database, input: RaceSessionProof & { fileId: string }, now = new Date()): Promise<Failure | { status: "ok" }> {
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
    const removed = await tx.delete(schema.racePrintFiles).where(and(eq(schema.racePrintFiles.raceId, raceId), eq(schema.racePrintFiles.id, input.fileId)))
      .returning({ id: schema.racePrintFiles.id, fileName: schema.racePrintFiles.fileName });
    if (removed.length === 0) return { status: "not-found" as const };
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_PRINT_FILE_REMOVED",
      actorKind: "USER_ACCOUNT", actorId, after: { fileId: input.fileId, fileName: removed[0]!.fileName }, createdAt: now });
    return { status: "ok" as const };
  });
}
