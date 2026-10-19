import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

const revision = z.number().int().min(1).max(2_147_483_647);
const instant = z.iso.datetime({ precision: 3 });
const milliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timeZone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Tidszonen stöds inte av Intl");



/** Projection validation only: the application must resolve stored provenance first. */
export const speakerBoardEffectiveResultSchema = z.discriminatedUnion("status", [
  z.object({
    revision,
    status: z.literal("OK"),
    reason: z.enum(["COMPLETE", "MANUAL_APPROVAL"]),
    elapsedMs: milliseconds
  }).strict(),
  z.object({
    revision,
    status: z.literal("MP"),
    reason: z.enum(["MISSING_START", "MISSING_FINISH", "MISSING_CONTROL", "WRONG_ORDER", "INVALID_TIME_ORDER"]),
    elapsedMs: milliseconds.optional()
  }).strict(),
  z.object({ revision, status: z.literal("DSQ"), reason: z.literal("MANUAL_DISQUALIFICATION"), elapsedMs: milliseconds.optional() }).strict(),
  z.object({ revision, status: z.literal("OOC"), reason: z.literal("OUT_OF_COMPETITION"), elapsedMs: milliseconds.optional() }).strict(),
  z.object({ revision, status: z.literal("DNF"), reason: z.literal("DID_NOT_FINISH") }).strict(),
  z.object({ revision, status: z.literal("DNS"), reason: z.literal("DID_NOT_START") }).strict(),
  z.object({ revision, status: z.literal("NT"), reason: z.literal("WITHOUT_TIMING") }).strict()
]).superRefine((result, context) => {
  if (result.status === "MP") {
    const timed = result.reason === "MISSING_CONTROL" || result.reason === "WRONG_ORDER";
    if (timed !== (result.elapsedMs !== undefined)) {
      context.addIssue({ code: "custom", path: ["elapsedMs"], message: "MP-tiden måste motsvara den tekniska orsaken" });
    }
  }
});

const common = {
  slot: z.number().int().min(1).max(25),
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  className: z.string().trim().min(1).max(160),
  selectedRevision: revision,
  registeredAt: instant
};

export const speakerBoardRowSchema = z.discriminatedUnion("state", [
  z.object({ ...common, state: z.literal("ACTIVE_RESULT"), result: speakerBoardEffectiveResultSchema }).strict(),
  z.object({ ...common, state: z.literal("NO_ACTIVE_RESULT") }).strict()
]).superRefine((row, context) => {
  if (row.state === "ACTIVE_RESULT" && row.result.revision > row.selectedRevision) {
    context.addIssue({ code: "custom", path: ["result", "revision"], message: "Effektivt resultat får inte vara nyare än valt publicerat huvud" });
  }
});

export const speakerBoardResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  eventName: z.string().trim().min(1).max(240),
  raceName: z.string().trim().min(1).max(240),
  raceSnapshotVersion: revision,
  timeZone,
  generatedAt: instant,
  selection: z.literal("LATEST_PUBLISHED_HEADS_BY_REGISTRATION"),
  rows: z.array(speakerBoardRowSchema).max(25)
}).strict().superRefine((response, context) => {
  response.rows.forEach((row, index) => {
    if (row.slot !== index + 1) {
      context.addIssue({ code: "custom", path: ["rows", index, "slot"], message: "Slot måste motsvara radens position i svaret" });
    }
    const previous = response.rows[index - 1];
    if (previous && row.registeredAt > previous.registeredAt) {
      context.addIssue({ code: "custom", path: ["rows", index, "registeredAt"], message: "Underlaget måste vara ordnat på fallande registreringstid" });
    }
  });
});

export { entryClassAdminErrorResponseSchema as speakerBoardErrorResponseSchema } from "./entry-class-admin";
export type SpeakerBoardEffectiveResult = z.infer<typeof speakerBoardEffectiveResultSchema>;
export type SpeakerBoardRow = z.infer<typeof speakerBoardRowSchema>;
export type SpeakerBoardResponse = z.infer<typeof speakerBoardResponseSchema>;
