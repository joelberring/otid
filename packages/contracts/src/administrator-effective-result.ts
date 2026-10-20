import { z } from "zod";
import { speakerBoardEffectiveResultSchema } from "./speaker-board";
import { uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);

/**
 * PLAN.md steg 25: startstämplingen vid lottad start, som varning (sen eller tidig start) eller notis (starttiden kom från
 * startstämplingen eftersom lottad tid saknades). Domänens `startPunchNote`. Visas i arbetsytan, aldrig publikt.
 */
export const startPunchNoteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["LATE", "EARLY"]), punchedAt: z.iso.datetime({ offset: true }), scheduledAt: z.iso.datetime({ offset: true }),
    deviationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ kind: z.literal("FROM_PUNCH"), punchedAt: z.iso.datetime({ offset: true }) }).strict()
]);
/** Arbetsytans anteckningar om ett resultat: startstämplingen och diskens orsak (PLAN.md steg 25). */
export const resultNotesSchema = z.object({
  startPunch: startPunchNoteSchema.optional(),
  disqualificationReason: z.string().trim().min(1).max(500).optional()
}).strict();
export type StartPunchNoteDto = z.infer<typeof startPunchNoteSchema>;
export type ResultNotes = z.infer<typeof resultNotesSchema>;
const selected = z.object({ id: uuid, revision: version }).strict();
export const administratorControlDetailsSchema = z.object({
  courseName: z.string().min(1).max(160), courseVersionId: uuid,
  /** Gafflad bana: varianten som kontrollerna nedan hör till (ADR-0169 beslut 2). */
  courseVariantCode: z.string().min(1).max(32).optional(),
  startTime: z.iso.datetime({ offset: true }).nullable(), finishTime: z.iso.datetime({ offset: true }).nullable(),
  controls: z.array(z.object({ sequence: version, controlCode: version, occurrence: version,
    elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    legMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable() }).strict()).max(1_000),
  missingControls: z.array(version).max(1_000), extraPunches: z.array(version).max(1_000),
  /** PLAN.md steg 13: stämplade kontroller utan giltig tid (före start eller efter mål). Arbetsytan visar en notis. */
  untimedControls: z.array(version).max(1_000).optional()
}).strict().superRefine((details, ctx) => {
  const occurrences = new Map<number, number>();
  details.controls.forEach((control, index) => {
    const next = (occurrences.get(control.controlCode) ?? 0) + 1;
    occurrences.set(control.controlCode, next);
    if (control.sequence !== index + 1 || control.occurrence !== next ||
      (control.elapsedMs === null) !== (control.legMs === null)) {
      ctx.addIssue({ code: "custom", path: ["controls", index], message: "Kontrollens ordning eller lagrade tid är ogiltig" });
    }
  });
});
/**
 * Brickans stämplingar från senaste avläsningen (domänens `cardPunchList`), oavsett bana och dag. Bara i arbetsytan
 * (admin), aldrig publikt. Tiderna är oförändrade från den normaliserade avläsningen; datum i tävlingens tidszon.
 */
const localDate = z.iso.date();
const stationPunch = z.object({ punchedAt: z.iso.datetime({ offset: true }), localDate }).strict();
export const cardPunchListSchema = z.object({
  readAt: z.iso.datetime({ offset: true }),
  raceDate: localDate,
  check: stationPunch.optional(), start: stationPunch.optional(), finish: stationPunch.optional(),
  punches: z.array(z.object({ order: version, code: version, punchedAt: z.iso.datetime({ offset: true }), localDate,
    placement: z.enum(["ON_COURSE", "EXTRA", "OTHER_DAY", "NO_COURSE"]) }).strict()).max(256),
  missingControls: z.array(version).max(1_000),
  otherDates: z.array(localDate).max(260),
  allOtherDay: z.boolean(),
  noStartPunch: z.boolean(),
  noFinishPunch: z.boolean()
}).strict();
export type CardPunchListDto = z.infer<typeof cardPunchListSchema>;
/** ADR-0169 beslut 4: deltagarkortets korta historik över resultatändringar, nyaste först. */
export const administratorResultHistoryCauses = ["CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION", "MANUAL_DID_NOT_START", "MANUAL_DISQUALIFICATION", "MANUAL_DISQUALIFICATION_WITHDRAWAL",
  "MANUAL_RESULT_APPROVAL", "MANUAL_RESULT_APPROVAL_WITHDRAWAL", "MANUAL_DID_NOT_FINISH", "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
  "MANUAL_OUT_OF_COMPETITION", "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", "MANUAL_WITHOUT_TIMING", "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
  "START_CHECKIN_DID_NOT_START", "MANUAL_FINISH_TIME_CORRECTION", "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL",
  "MANUAL_PUNCH_START_TIME_CORRECTION", "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL", "SHORTENED_COURSE_CLASS_TRANSFER",
  "MANUAL_DID_NOT_START_WITHDRAWAL", "MANUAL_TIME", "MANUAL_TIME_WITHDRAWAL", "MANUAL_CONTROL_APPROVAL",
  "MANUAL_CONTROL_APPROVAL_WITHDRAWAL", "MANUAL_RESULT_REMOVED"] as const;
export const administratorResultHistorySchema = z.array(z.object({
  revision: version, cause: z.enum(administratorResultHistoryCauses),
  status: z.enum(["OK", "OVERTIME", "MP", "DSQ", "DNF", "OOC", "DNS", "NT"]), at: z.iso.datetime({ precision: 3 })
}).strict()).max(10);
const common = { formatVersion: z.literal(1), raceId: uuid, entryId: uuid, history: administratorResultHistorySchema,
  entryVersion: version, currentClassId: uuid, snapshotVersion: version,
  /** Senaste avläsningens stämplingar; `null` när löparen inte lästs av. */
  cardPunches: cardPunchListSchema.nullable().optional(),
  generatedAt: z.iso.datetime({ precision: 3 }), timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; } catch { return false; }
  }) };
export const administratorEffectiveResultResponseSchema = z.discriminatedUnion("state", [
  z.object({ ...common, state: z.literal("NO_PUBLISHED_RESULT"), selectedRevision: z.null() }).strict(),
  z.object({ ...common, state: z.literal("NO_ACTIVE_RESULT"), selectedRevision: selected }).strict(),
  z.object({ ...common, state: z.literal("ACTIVE_RESULT"), selectedRevision: selected,
    result: speakerBoardEffectiveResultSchema,
    resultClass: z.object({ id: uuid, name: z.string().min(1).max(160) }).strict(), resultSnapshotVersion: version,
    // ADR-0169: sant så länge löparens eget bedömningsunderlag är oförändrat.
    resultCurrent: z.boolean(),
    controlDetails: administratorControlDetailsSchema.nullable().optional(),
    notes: resultNotesSchema.optional(),
    /** Steg 31: MANUAL_TIME = manuell eller rättad tid, CONTROL_APPROVAL = godkända kontroller (kan vara delvis). */
    governingDecision: z.enum(["NONE", "DNS", "CHECKIN_DNS", "DSQ", "APPROVAL", "DNF", "OOC", "NT", "MANUAL_TIME", "CONTROL_APPROVAL"]),
    /** Arrangörens orsak till det gällande manuella beslutet (steg 31), bara i arbetsytan. */
    decisionNote: z.string().trim().min(1).max(500).optional()
  }).strict()
]).superRefine((value, ctx) => {
  if (value.state !== "ACTIVE_RESULT") return;
  const expected = value.result.status === "OK"
    ? (value.result.reason === "MANUAL_APPROVAL" ? ["APPROVAL", "CONTROL_APPROVAL"] : ["NONE", "MANUAL_TIME"]) :
    value.result.status === "MP" ? ["NONE", "MANUAL_TIME", "CONTROL_APPROVAL"] : value.result.status === "OVERTIME" ? ["NONE", "MANUAL_TIME"] : value.result.status === "DNS" ? ["DNS", "CHECKIN_DNS"] : [value.result.status];
  if (!expected.includes(value.governingDecision) || value.result.revision > value.selectedRevision.revision ||
    value.resultSnapshotVersion > value.snapshotVersion) ctx.addIssue({ code: "custom", message: "Resultatets beslut eller versionsunderlag stämmer inte" });
  if (["DNS", "DNF", "NT"].includes(value.result.status) && value.controlDetails != null) {
    ctx.addIssue({ code: "custom", path: ["controlDetails"], message: "Status utan teknik får inte bära kontrolluppgifter" });
  }
});
export type AdministratorEffectiveResultResponse = z.infer<typeof administratorEffectiveResultResponseSchema>;
