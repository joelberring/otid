import { z } from "zod";
import { speakerBoardEffectiveResultSchema } from "./speaker-board";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const selected = z.object({ id: uuid, revision: version }).strict();
export const administratorControlDetailsSchema = z.object({
  courseName: z.string().min(1).max(160), courseVersionId: uuid,
  startTime: z.iso.datetime({ offset: true }).nullable(), finishTime: z.iso.datetime({ offset: true }).nullable(),
  controls: z.array(z.object({ sequence: version, controlCode: version, occurrence: version,
    elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    legMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable() }).strict()).max(1_000),
  missingControls: z.array(version).max(1_000), extraPunches: z.array(version).max(1_000)
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
const common = { formatVersion: z.literal(1), raceId: uuid, entryId: uuid,
  entryVersion: version, currentClassId: uuid, snapshotVersion: version,
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
    governingDecision: z.enum(["NONE", "DNS", "CHECKIN_DNS", "DSQ", "APPROVAL", "DNF", "OOC", "NT"])
  }).strict()
]).superRefine((value, ctx) => {
  if (value.state !== "ACTIVE_RESULT") return;
  const expected = value.result.status === "OK" ? (value.result.reason === "MANUAL_APPROVAL" ? ["APPROVAL"] : ["NONE"]) :
    value.result.status === "MP" ? ["NONE"] : value.result.status === "DNS" ? ["DNS", "CHECKIN_DNS"] : [value.result.status];
  if (!expected.includes(value.governingDecision) || value.result.revision > value.selectedRevision.revision ||
    value.resultSnapshotVersion > value.snapshotVersion) ctx.addIssue({ code: "custom", message: "Resultatets beslut eller versionsunderlag stämmer inte" });
  if (["DNS", "DNF", "NT"].includes(value.result.status) && value.controlDetails != null) {
    ctx.addIssue({ code: "custom", path: ["controlDetails"], message: "Status utan teknik får inte bära kontrolluppgifter" });
  }
});
export type AdministratorEffectiveResultResponse = z.infer<typeof administratorEffectiveResultResponseSchema>;
