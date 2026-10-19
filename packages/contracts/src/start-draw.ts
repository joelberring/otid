import { z } from "zod";
import { courseEditChangeSchema, courseVariantCodeSchema } from "./course-edit";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

/**
 * Lottning (PLAN.md steg 9 och 26): startsätt per klass, flera klasser på en gång,
 * startgrupper, klubbseparering och vakanser; under "Avancerat" regler för startgrupp,
 * tak per minut, sista start, seedning, startordning och senare start per klass.
 * Förhandsvisningen läser bara; sparandet binder samma underlag, samma frö och samma tävlingsläge.
 */
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

const limit = z.number().int().min(1).max(1_000);
const controlCode = z.number().int().nonnegative();

/** Senare start för en klass: eget klockslag eller minuter efter tävlingens första start. */
export const startDrawLaterStartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CLOCK"), startTime: minuteInstant }).strict(),
  z.object({ kind: z.literal("OFFSET"), minutes: z.number().int().min(1).max(1_440) }).strict()
]);

/** Reglerna under "Avancerat". Standard: en kontroll, inga tak, ingen sista start, seedade sist, automatisk ordning. */
export const startDrawRulesSchema = z.object({
  /** Hur många av banans första kontroller som avgör startgruppen. */
  groupControls: z.number().int().min(1).max(3),
  maxPerMinute: limit.nullable(),
  /** Startfålla = klasser med samma första kontroll. Spelar roll när fler än en kontroll avgör startgruppen. */
  maxPerMinutePerPen: limit.nullable(),
  lastStartTime: minuteInstant.nullable(),
  seeding: z.enum(["LAST", "SPREAD"]),
  /** Egen startordning mellan klasserna; null = automatisk (masstart först, sedan största klassen). */
  classOrder: z.array(uuid).max(1_000).nullable()
}).strict();

/** Inställningarna som sparas med lottningen och visas nästa gång. */
export const startDrawSavedSettingsSchema = z.object({
  rules: startDrawRulesSchema,
  laterStarts: z.array(z.object({ classId: uuid, laterStart: startDrawLaterStartSchema }).strict()).max(1_000)
}).strict();

export const startDrawSeedSchema = z.object({ entryId: uuid, rank: z.number().int().min(1).max(10_000) }).strict();

export const startDrawSetupResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, raceDate: z.iso.date(), timeZone,
  /** Tidigaste första start i gällande lottningar, annars null. */
  firstStartTime: instant.nullable(),
  classes: z.array(z.object({
    id: uuid, name, courseName: name, firstControlCode: z.number().int().nonnegative().nullable(), entryCount: count,
    method: startDrawMethodSchema, intervalMinutes: z.number().int().min(1).max(60), vacancies: startDrawVacanciesSchema,
    /** Klassen har redan starttider som en ny lottning ersätter. */
    hasStartTimes: z.boolean()
  }).strict()).max(1_000),
  /** Inställningarna från senaste lottningen (PLAN.md steg 26), null om inga sparats. */
  settings: startDrawSavedSettingsSchema.nullable(),
  /** Löparna för seedningen, med nuvarande seedning. */
  entries: z.array(z.object({ id: uuid, classId: uuid, name: z.string().min(1).max(321), club: z.string().min(1).max(200).nullable(),
    card: z.string().min(1).max(32).nullable(), seedRank: z.number().int().min(1).max(10_000).nullable() }).strict()).max(10_000)
}).strict().refine(value => new Set(value.classes.map(row => row.id)).size === value.classes.length);

export const startDrawClassSettingSchema = z.object({
  classId: uuid, method: startDrawMethodSchema, intervalMinutes: z.number().int().min(1).max(60), vacancies: startDrawVacanciesSchema,
  laterStart: startDrawLaterStartSchema.optional()
}).strict();

const drawSettings = {
  firstStartTime: minuteInstant, clubSeparation: z.boolean(),
  classes: z.array(startDrawClassSettingSchema).min(1).max(1_000),
  /** Utan regler gäller standard (det enkla läget). */
  rules: startDrawRulesSchema.optional(),
  /** Seedningen för de lottade klassernas löpare; sparas med lottningen. Utan fältet gäller den sparade seedningen. */
  seeds: z.array(startDrawSeedSchema).max(10_000).optional()
};
const uniqueClasses = (value: { classes: readonly { classId: string }[]; seeds?: readonly { entryId: string }[] | undefined }) =>
  new Set(value.classes.map(row => row.classId)).size === value.classes.length &&
  (!value.seeds || new Set(value.seeds.map(row => row.entryId)).size === value.seeds.length);

export const startDrawPreviewRequestSchema = z.object({ formatVersion: z.literal(1), ...drawSettings }).strict().refine(uniqueClasses);

const slotSchema = z.object({
  startTime: instant,
  entry: z.object({ id: uuid, name: z.string().min(1).max(321), club: z.string().min(1).max(200).nullable(),
    card: z.string().min(1).max(32).nullable(),
    /** Gafflad klass: löparens variant efter lottningen (ADR-0169 beslut 2). */
    variantCode: courseVariantCodeSchema.nullable(),
    seedRank: z.number().int().min(1).max(10_000).nullable() }).strict().nullable()
}).strict();

/** Regelbrott som lottningen inte kunde undvika (PLAN.md steg 26). De hindrar inte sparandet. */
export const startDrawWarningSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("AFTER_LAST_START"), classNames: z.array(name).min(1), lastStartTime: instant, firstAfterTime: instant,
    neededLastStartTime: instant }).strict(),
  z.object({ code: z.literal("LATER_START_MOVED"), className: name, wantedTime: instant, actualTime: instant }).strict(),
  z.object({ code: z.literal("EXISTING_OVER_LIMIT"), scope: z.enum(["TOTAL", "PEN"]), limit, firstTime: instant, minuteCount: count }).strict(),
  z.object({ code: z.literal("EXISTING_GROUP_CLASH"), classNames: z.array(name).min(2), firstTime: instant, minuteCount: count }).strict()
]);

export const startDrawPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version, timeZone,
  /** Fröet följer med så att sparandet ger exakt samma lottning. Det visas aldrig. */
  seed,
  classes: z.array(z.object({
    classId: uuid, className: name, method: startDrawMethodSchema, firstStartTime: instant.nullable(),
    intervalMinutes: z.number().int().min(1).max(60), vacancyCount: count, replacesStartTimes: z.boolean(),
    slots: z.array(slotSchema).max(11_000)
  }).strict()).min(1).max(1_000),
  /** Startgrupper: klasser vars banor börjar med samma kontroller och aldrig startar samma minut. */
  startGroups: z.array(z.object({ controlCodes: z.array(controlCode).min(1).max(3), classNames: z.array(name).min(2),
    alternating: z.boolean() }).strict()).max(1_000),
  warnings: z.array(startDrawWarningSchema).max(1_000),
  /** Klasser som inte lottas nu men har tider; deras tider rörs inte. */
  existingClasses: z.array(z.object({ className: name, startCount: count, firstStartTime: instant, lastStartTime: instant }).strict()).max(1_000),
  /** Minut för minut: var de nya tiderna hamnar bland de befintliga. */
  timeline: z.array(z.object({ startTime: instant, starts: z.array(z.object({ className: name, count: z.number().int().positive().max(11_000),
    existing: z.boolean() }).strict()).min(1).max(1_000) }).strict()).max(20_000),
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
  prefixedUuidPattern("start-draw"));

export const startDrawResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, request: startDrawRequestSchema,
  classCount: count, entryCount: count, vacancyCount: count, recalculatedCount: count,
  snapshotVersionBefore: version, snapshotVersionAfter: version, drawnAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.classCount !== value.request.classes.length) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och ett steg i versionsföljden" });
  }
});


export type StartDrawMethod = z.infer<typeof startDrawMethodSchema>;
export type StartDrawLaterStart = z.infer<typeof startDrawLaterStartSchema>;
export type StartDrawRules = z.infer<typeof startDrawRulesSchema>;
export type StartDrawSavedSettings = z.infer<typeof startDrawSavedSettingsSchema>;
export type StartDrawWarning = z.infer<typeof startDrawWarningSchema>;
export type StartDrawVacancies = z.infer<typeof startDrawVacanciesSchema>;
export type StartDrawSetupResponse = z.infer<typeof startDrawSetupResponseSchema>;
export type StartDrawClassSetting = z.infer<typeof startDrawClassSettingSchema>;
export type StartDrawPreviewRequest = z.infer<typeof startDrawPreviewRequestSchema>;
export type StartDrawPreviewResponse = z.infer<typeof startDrawPreviewResponseSchema>;
export type StartDrawRequest = z.infer<typeof startDrawRequestSchema>;
export type StartDrawResponse = z.infer<typeof startDrawResponseSchema>;
