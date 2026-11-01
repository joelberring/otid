import { and, asc, eq, lte } from "drizzle-orm";
import {
  courseSettingInspectionRequestSchema, courseSettingInspectionSchema, courseSettingInspectionsSchema, type CourseSettingInspection,
  type CourseSettingInspections
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { actor, actors, courseSettingRead, courseSettingWrite, type Failure, type ReadProof, type Transaction } from "./course-setting";
import type { RaceSessionProof } from "./race-session";

/**
 * Steg 67 (ADR-0181 beslut 6): "kollad" per kontroll. Sparas utanför dokumentet (`course_setting_inspection`), som
 * notiserna: den som läser och kommenterar (bankontrollanten) får bocka, en bock blir ingen ny version, inget förslag och
 * ingen konflikt med andras ändringar, en ny .ppen tar inte bort bockarna, och banpåtryck, beskrivningar, .ppen och
 * överföringen läser dem aldrig.
 *
 * Telefonen köar bockarna utan nät och skickar dem senare, så tiden i begäran (när det gjordes) avgör: den senaste vinner,
 * också över en avbockning (raden står kvar med `checked` false). Tiden får ligga högst 2 minuter i framtiden (telefonens
 * klocka; den sparas då som serverns tid) och högst 30 dagar bakåt.
 */
const inspections = schema.courseSettingInspections;
type Row = typeof inspections.$inferSelect;
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 2 * 60_000;

async function list(tx: Transaction, raceId: string): Promise<CourseSettingInspections> {
  const rows: Row[] = await tx.select().from(inspections).where(and(eq(inspections.raceId, raceId), eq(inspections.checked, true)))
    .orderBy(asc(inspections.changedAt), asc(inspections.controlId)).limit(5000);
  const names = await actors(tx, rows.map(row => row.changedBy));
  const dtos: CourseSettingInspection[] = rows.map(row => courseSettingInspectionSchema.parse({ control: row.controlId,
    checkedAt: row.changedAt.toISOString(), checkedBy: actor(names, row.changedBy),
    at: row.atX !== null && row.atY !== null ? { x: row.atX, y: row.atY } : null }));
  return courseSettingInspectionsSchema.parse({ formatVersion: 1, raceId, inspections: dtos });
}

export async function listCourseSettingInspectionsAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingInspections }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => ({ status: "ok" as const, response: await list(tx, raceId) }));
}

/** Bocka i eller av (COMMENT räcker). Svaret är bockarna efteråt; `changed` är falskt om en nyare bock eller avbockning gällde. */
export async function setCourseSettingInspectionAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; changed: boolean; response: CourseSettingInspections }> {
  const parsed = courseSettingInspectionRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const at = new Date(request.at).getTime();
  if (at > now.getTime() + CLOCK_SKEW_MS || at < now.getTime() - MAX_AGE_MS) return { status: "invalid-request" };
  const when = new Date(Math.min(at, now.getTime()));
  return courseSettingWrite(db, input, now, "COMMENT", async (tx, raceId, actorId) => {
    const values = { checked: request.checked, changedAt: when, changedBy: actorId,
      atX: request.checked ? request.position?.x ?? null : null, atY: request.checked ? request.position?.y ?? null : null };
    const written = await tx.insert(inspections).values({ raceId, controlId: request.control, ...values })
      .onConflictDoUpdate({ target: [inspections.raceId, inspections.controlId], set: values, setWhere: lte(inspections.changedAt, when) })
      .returning({ control: inspections.controlId });
    return { status: "ok" as const, changed: written.length > 0, response: await list(tx, raceId) };
  });
}
