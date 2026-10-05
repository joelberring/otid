import { z } from "zod";

/**
 * Rogaining (ADR-0170 beslut 5, PLAN.md steg 15): klassens tidsgräns och straff, kontrollernas poäng och
 * resultatets poäng. Ändringar av poäng och regler sparas direkt när inget resultat påverkas; annars visas
 * beskedet först och berörda resultat räknas om med nya revisioner (samma mekanism som Redigera bana).
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const name = z.string().trim().min(1).max(160);
const controlCode = z.number().int().positive().max(2_147_483_647);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const ROGAINING_MAX_POINTS = 1_000;
/** Längsta tidsgräns i minuter (två dygn). */
export const ROGAINING_MAX_TIME_LIMIT_MINUTES = 2_880;

export const rogainingPointsSchema = z.number().int().min(0).max(ROGAINING_MAX_POINTS);

/** Klassens regler i ögonblicksbilden (sekunder, som domänen). */
export const rogainingRulesSchema = z.object({
  timeLimitSeconds: z.number().int().min(60).max(ROGAINING_MAX_TIME_LIMIT_MINUTES * 60),
  penaltyPointsPerMinute: rogainingPointsSchema
}).strict();

/** Klassens regler som arrangören anger dem (minuter). */
export const rogainingClassRulesInputSchema = z.object({
  timeLimitMinutes: z.number().int().min(1).max(ROGAINING_MAX_TIME_LIMIT_MINUTES),
  penaltyPoints: rogainingPointsSchema
}).strict();

const safeMilliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Resultatets poäng: kontrollpoäng, straff och summa samt de räknade kontrollerna. */
export const rogainingScoreSchema = z.object({
  controlPoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  penalty: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  timeLimitMs: safeMilliseconds,
  penaltyPointsPerMinute: rogainingPointsSchema,
  overtimeMinutes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  controls: z.array(z.object({ controlCode, points: rogainingPointsSchema }).strict()).max(1_000)
}).strict().superRefine((value, context) => {
  if (value.controlPoints !== value.controls.reduce((sum, control) => sum + control.points, 0) ||
      value.total !== Math.max(0, value.controlPoints - value.penalty) ||
      new Set(value.controls.map((control) => control.controlCode)).size !== value.controls.length) {
    context.addIssue({ code: "custom", message: "Poängen måste gå ihop" });
  }
});

/** Underlaget för "Kontroller & poäng": tävlingens kontroller med poäng och klassernas regler. */
export const rogainingSetupSchema = z.object({
  controls: z.array(z.object({ code: controlCode, points: rogainingPointsSchema, defaultPoints: rogainingPointsSchema }).strict())
    .max(1_000),
  classes: z.array(z.object({ classId: uuid, rules: rogainingClassRulesInputSchema.nullable() }).strict()).max(1_000)
}).strict();

const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;

const changeFields = {
  expectedSnapshotVersion: version,
  /** Kontrollkodens poäng i hela tävlingen. Samma värde som förvalet sparas som förval. */
  controlPoints: z.array(z.object({ code: controlCode, points: rogainingPointsSchema }).strict()).max(1_000),
  /** Klassens tidsgräns och straff; en klass utan regler blir rogaining. */
  classRules: z.array(z.object({ classId: uuid, ...rogainingClassRulesInputSchema.shape }).strict()).max(1_000)
};

function validChange(value: { controlPoints: readonly { code: number }[]; classRules: readonly { classId: string }[] },
  context: z.RefinementCtx): void {
  if (value.controlPoints.length + value.classRules.length === 0 || !unique(value.controlPoints.map((row) => row.code)) ||
      !unique(value.classRules.map((row) => row.classId))) {
    context.addIssue({ code: "custom", message: "Ändringen måste innehålla unika kontroller eller klasser" });
  }
}

export const rogainingChangePreviewRequestSchema = z.object({ formatVersion: z.literal(1), ...changeFields }).strict()
  .superRefine(validChange);

const outcome = z.object({ status: z.enum(["OK", "MP"]), total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).strict();

export const rogainingChangePreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  /** Avlästa löpare i de berörda klasserna; de räknas om när ändringen sparas. */
  readOutCount: count,
  /** Löpare med manuellt rättad tid räknas inte om. */
  notRecalculatedCount: count,
  /** Löpare vars status eller summa ändras. */
  changes: z.array(z.object({ entryId: uuid, displayName: z.string().min(1).max(400), className: name, before: outcome, after: outcome })
    .strict()).max(10_000),
  requiresConfirmation: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.requiresConfirmation !== value.changes.length > 0 || value.notRecalculatedCount > value.readOutCount) {
    context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  }
});

export const rogainingChangeRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, ...changeFields, confirmResultChanges: z.boolean()
}).strict().superRefine(validChange);

export const rogainingChangeIdempotencyKeySchema = z.string().regex(
  /^rogaining-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const rogainingChangeResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, request: rogainingChangeRequestSchema,
  snapshotVersionBefore: version, snapshotVersionAfter: version,
  recalculated: z.array(z.object({ entryId: uuid, resultRevisionId: uuid, revision: version }).strict()).max(10_000),
  changedAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.snapshotVersionBefore !== value.request.expectedSnapshotVersion) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och versionsföljd" });
  }
});

export type RogainingSetup = z.infer<typeof rogainingSetupSchema>;
export type RogainingClassRulesInput = z.infer<typeof rogainingClassRulesInputSchema>;
export type RogainingChangePreviewRequest = z.infer<typeof rogainingChangePreviewRequestSchema>;
export type RogainingChangePreviewResponse = z.infer<typeof rogainingChangePreviewResponseSchema>;
export type RogainingChangeRequest = z.infer<typeof rogainingChangeRequestSchema>;
export type RogainingChangeResponse = z.infer<typeof rogainingChangeResponseSchema>;
