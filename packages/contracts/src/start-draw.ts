import { z } from "zod";
import { courseEditChangeSchema, courseVariantCodeSchema } from "./course-edit";

/**
 * Lottning (PLAN.md steg 9): startsätt per klass, flera klasser på en gång,
 * startfållor, klubbseparering och vakanser. Förhandsvisningen läser bara;
 * sparandet binder samma underlag, samma frö och samma tävlingsläge.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const name = z.string().trim().min(1).max(160);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const minuteInstant = instant.refine(value => Date.parse(value) % 60_000 === 0, "Tiden måste vara en hel minut");
const timeZone = z.string().min(1).max(100);
const seed = z.number().int().min(1).max(4_294_967_295);

/** FREE = fri start (startstämpling), MINUTE = lottad minutstart, MASS = masstart. */
export const startDrawMethodSchema = z.enum(["FREE", "MINUTE", "MASS"]);
export const startDrawVacanciesSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("COUNT"), value: z.number().int().min(0).max(1_000) }).strict(),
  z.object({ kind: z.literal("PERCENT"), value: z.number().int().min(0).max(100) }).strict()
]);

export const startDrawSetupResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, raceDate: z.iso.date(), timeZone,
  /** Tidigaste första start i gällande lottningar, annars null. */
  firstStartTime: instant.nullable(),
  classes: z.array(z.object({
    id: uuid, name, courseName: name, firstControlCode: z.number().int().nonnegative().nullable(), entryCount: count,
    method: startDrawMethodSchema, intervalMinutes: z.number().int().min(1).max(60), vacancies: startDrawVacanciesSchema,
    /** Klassen har redan starttider som en ny lottning ersätter. */
    hasStartTimes: z.boolean()
  }).strict()).max(1_000)
}).strict().refine(value => new Set(value.classes.map(row => row.id)).size === value.classes.length);

export const startDrawClassSettingSchema = z.object({
  classId: uuid, method: startDrawMethodSchema, intervalMinutes: z.number().int().min(1).max(60), vacancies: startDrawVacanciesSchema
}).strict();

const drawSettings = {
  expectedSnapshotVersion: version, firstStartTime: minuteInstant, clubSeparation: z.boolean(),
  classes: z.array(startDrawClassSettingSchema).min(1).max(1_000)
};
const uniqueClasses = (value: { classes: readonly { classId: string }[] }) =>
  new Set(value.classes.map(row => row.classId)).size === value.classes.length;

export const startDrawPreviewRequestSchema = z.object({ formatVersion: z.literal(1), ...drawSettings }).strict().refine(uniqueClasses);

const slotSchema = z.object({
  startTime: instant,
  entry: z.object({ id: uuid, name: z.string().min(1).max(321), club: z.string().min(1).max(200).nullable(),
    card: z.string().min(1).max(32).nullable(),
    /** Gafflad klass: löparens variant efter lottningen (ADR-0169 beslut 2). */
    variantCode: courseVariantCodeSchema.nullable() }).strict().nullable()
}).strict();

export const startDrawPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone,
  /** Fröet följer med så att sparandet ger exakt samma lottning. Det visas aldrig. */
  seed,
  classes: z.array(z.object({
    classId: uuid, className: name, method: startDrawMethodSchema, firstStartTime: instant.nullable(),
    intervalMinutes: z.number().int().min(1).max(60), vacancyCount: count, replacesStartTimes: z.boolean(),
    slots: z.array(slotSchema).max(11_000)
  }).strict()).min(1).max(1_000),
  /** Startfållor: klasser med samma första kontroll som aldrig startar samma minut. */
  startGroups: z.array(z.object({ firstControlCode: z.number().int().nonnegative(), classNames: z.array(name).min(2),
    alternating: z.boolean() }).strict()).max(1_000),
  replacesStartTimes: z.boolean(),
  readOutCount: count, becomesOkCount: count, becomesMispunchedCount: count, unchangedCount: count, notRecalculatedCount: count,
  changes: z.array(courseEditChangeSchema).max(10_000), requiresConfirmation: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.becomesOkCount + value.becomesMispunchedCount + value.unchangedCount + value.notRecalculatedCount !== value.readOutCount ||
      value.changes.length !== value.becomesOkCount + value.becomesMispunchedCount ||
      value.requiresConfirmation !== (value.changes.length > 0 || value.replacesStartTimes) ||
      value.replacesStartTimes !== value.classes.some(row => row.replacesStartTimes)) {
    context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  }
});

export const startDrawRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, seed, ...drawSettings,
  /** Bekräftar att befintliga starttider ersätts och/eller att resultat ändras. */
  confirmChanges: z.boolean()
}).strict().refine(uniqueClasses);

export const startDrawIdempotencyKeySchema = z.string().regex(
  /^start-draw:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const startDrawResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, request: startDrawRequestSchema,
  classCount: count, entryCount: count, vacancyCount: count, recalculatedCount: count,
  snapshotVersionBefore: version, snapshotVersionAfter: version, drawnAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.snapshotVersionBefore !== value.request.expectedSnapshotVersion || value.classCount !== value.request.classes.length) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och ett steg i versionsföljden" });
  }
});

/** Äldre funktionsbehörighet för lottning (inloggning med åtkomstkod). Lottningen själv kräver admin. */
export const classStartDrawAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1), accessCredential: z.string().regex(/^otid_org_class_start_draw_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();

export type StartDrawMethod = z.infer<typeof startDrawMethodSchema>;
export type StartDrawVacancies = z.infer<typeof startDrawVacanciesSchema>;
export type StartDrawSetupResponse = z.infer<typeof startDrawSetupResponseSchema>;
export type StartDrawClassSetting = z.infer<typeof startDrawClassSettingSchema>;
export type StartDrawPreviewRequest = z.infer<typeof startDrawPreviewRequestSchema>;
export type StartDrawPreviewResponse = z.infer<typeof startDrawPreviewResponseSchema>;
export type StartDrawRequest = z.infer<typeof startDrawRequestSchema>;
export type StartDrawResponse = z.infer<typeof startDrawResponseSchema>;
