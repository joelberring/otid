import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Steg 65 (ADR-0184): PDF för tryck som jobb på servern. Förhandsvisningen skickar vad som ska skrivas ut (banor eller
 * en karta per löpare, mallen, profilen); servern lägger jobbet i kön och skriver PDF:en med låg prioritet. Mallen och
 * profilen kontrolleras av `@o-tid/course-setting` i servern (`validateLayoutTemplate`, `validatePrintProfile`).
 */

/** PRESS = tryckeri med kartans och banans dekorfärger; PROCESS = tryckeri med kartan i CMYK; OFFICE = kontorsskrivare. */
export const printJobKindSchema = z.enum(["PRESS", "PROCESS", "OFFICE"]);
export type PrintJobKind = z.infer<typeof printJobKindSchema>;
export const printJobStatusSchema = z.enum(["QUEUED", "RUNNING", "DONE", "FAILED", "EXPIRED"]);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

/** Högst så många kartor (banor, varianter eller löpare) i ett jobb. */
export const PRINT_JOB_MAX_ITEMS = 2000;
/** Förfrågan med en mall (logotyper högst 300 kB) och en profil. */
export const PRINT_JOB_REQUEST_MAX_BYTES = 2 * 1024 * 1024;

const text = (max: number) => z.string().max(max);
const runnerSchema = z.object({
  kind: z.enum(["RUNNER", "VACANT", "RESERVE"]), name: text(200).nullable(), club: text(200).nullable().optional(), className: text(200).nullable(),
  startTime: text(40).nullable(), startNumber: z.number().int().min(0).max(1_000_000).nullable()
}).strict();
const mapRect = z.object({ minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite() }).strict();

/** En karta: bana (eller ALL_CONTROLS), variant, skala och tryckyta som i förhandsvisningen, och löparen. */
export const printJobItemSchema = z.object({
  course: text(64).min(1), variant: text(64).optional(), printScale: z.number().positive().max(1_000_000).optional(),
  printArea: z.object({ automatic: z.boolean(), restrictToPageSize: z.boolean(), rect: mapRect.optional(),
    page: z.object({ width: z.number().positive(), height: z.number().positive(), margins: z.number().min(0), landscape: z.boolean() }).strict().optional() })
    .strict().optional(),
  runner: runnerSchema.optional(),
  /** Träningsläget (ADR-0192 beslut 7): kontrollantens karta, kepsens karta och ett avsnitt (stjärnans udd). */
  training: z.object({ view: z.enum(["RUNNER", "CONTROLLER"]).optional(), pairMap: z.enum(["COMMON", "A", "B"]).optional(),
    section: z.object({ from: z.number().int().min(0).max(10_000), to: z.number().int().min(0).max(10_000) }).strict().optional() }).strict().optional()
}).strict();
export type PrintJobItem = z.infer<typeof printJobItemSchema>;

export const printJobRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  kind: printJobKindSchema,
  /** Profilen: en färdig eller sparad (`profileId`) eller en osparad (`profile`, kontrolleras i servern). OFFICE använder "office" om inget anges. */
  profileId: text(200).min(1),
  profile: z.unknown().optional(),
  /** PAGES = Purple Pens en bana per sida (`layoutCoursePage`); TEMPLATE = layoutmallen (`layoutTemplateSheets`). */
  layout: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("PAGES"), header: z.boolean() }).strict(),
    z.object({ kind: z.literal("TEMPLATE"), template: z.unknown(), fill: z.enum(["FILL", "REPEAT"]) }).strict(),
    // Träningsläget: en liten kartbit per sträcka (minnes- och pusselorientering, ADR-0192 beslut 6).
    z.object({ kind: z.literal("PIECES") }).strict()
  ]),
  /** En karta per löpare: ett ark (och en baksida med `duplex`) per post. */
  perRunner: z.boolean(),
  duplex: z.boolean(),
  items: z.array(printJobItemSchema).min(1).max(PRINT_JOB_MAX_ITEMS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Förhandskontrollens varningar är lästa och bekräftade (blockerande fel stoppar alltid). */
  warningsConfirmed: z.boolean(),
  /** Reglerna som arrangören bekräftat i förhandskontrollen ("behöver bekräftas"). */
  confirmedRules: z.array(text(200)).max(500).optional()
}).strict();
export type PrintJobRequest = z.infer<typeof printJobRequestSchema>;

export const printJobSchema = z.object({
  id: uuid, kind: printJobKindSchema, status: printJobStatusSchema, label: text(500), documentVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(), startedAt: z.iso.datetime().nullable(), finishedAt: z.iso.datetime().nullable(),
  pages: z.number().int().nonnegative().nullable(), byteLength: z.number().int().nonnegative().nullable(), error: text(2000).nullable(),
  /** Plåtarna (dekorfärgerna) i PDF:en, om övertryck används och notiser om förenklingar. */
  plates: z.array(text(200)).max(200), overprint: z.boolean(), notes: z.array(text(2000)).max(200),
  /** Plats i kön (1 = nästa) för väntande jobb. */
  position: z.number().int().positive().nullable()
}).strict();
export type PrintJob = z.infer<typeof printJobSchema>;

export const printJobsSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, jobs: z.array(printJobSchema).max(100),
  /** Hur länge en klar PDF sparas (dagar) och största storlek (byte). */
  keepDays: z.number().int().positive(), maxBytes: z.number().int().positive()
}).strict();
export type PrintJobs = z.infer<typeof printJobsSchema>;

export const printJobProblemSchema = z.object({
  formatVersion: z.literal(1),
  problem: z.enum(["NO_COURSE_SETTING", "TOO_MANY_JOBS", "PREFLIGHT_BLOCKED", "WARNINGS_NOT_CONFIRMED", "INVALID_TEMPLATE", "INVALID_PROFILE"]),
  message: text(2000)
}).strict();
export type PrintJobProblem = z.infer<typeof printJobProblemSchema>;
