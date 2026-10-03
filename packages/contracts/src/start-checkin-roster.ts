import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positivePostgresIntegerSchema = z.number().int().positive().max(2_147_483_647);
const nonnegativePostgresIntegerSchema = z.number().int().nonnegative().max(2_147_483_647);
const utcMillisecondSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
).refine((value) => {
  const year = Number(value.slice(0, 4));
  const milliseconds = Date.parse(value);
  return year >= 1 && year <= 9_999 && Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}, "Tidpunkten måste vara en giltig kanonisk UTC-tid med millisekunder");
const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Tidszonen stöds inte av Intl");

const rosterEntrySchema = z.object({
  entryId: canonicalUuidSchema,
  entryVersion: positivePostgresIntegerSchema,
  classId: canonicalUuidSchema,
  className: z.string().max(160),
  displayName: z.string().max(321),
  organisationName: z.string().max(240).nullable(),
  startRule: z.enum(["FIXED", "PUNCH"]),
  fixedStartTime: z.iso.datetime({ offset: true }).nullable(),
  cardNumber: z.string().max(32).nullable(),
  multipleActiveAssignments: z.boolean(),
  revision: nonnegativePostgresIntegerSchema,
  startState: z.enum(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"]),
  manualReturnRegistered: z.boolean(),
  readoutReturnRegistered: z.boolean(),
  activeDns: z.boolean(),
  conflictingReports: z.boolean(),
  reviewedConflictRequestIds: z.array(canonicalUuidSchema).max(100_000).refine(ids =>
    ids.every((id, index) => index === 0 || ids[index - 1]! < id), "Granskade id måste vara unika och sorterade").optional(),
  forestState: z.enum(["STARTED_NO_RETURN", "UNCONFIRMED", "NOT_STARTED", "RETURNED", "CONFLICT"]),
  needsFollowUp: z.boolean()
}).strict().superRefine((entry, context) => {
  if (entry.startRule === "PUNCH" && entry.fixedStartTime !== null) {
    context.addIssue({ code: "custom", path: ["fixedStartTime"], message: "PUNCH-klasser får inte ha fast starttid" });
  }
  if (entry.multipleActiveAssignments && entry.cardNumber !== null) {
    context.addIssue({ code: "custom", path: ["cardNumber"], message: "Tvetydig aktiv brickkoppling får inte välja bricknummer" });
  }
  if (entry.revision === 0 && entry.startState !== "UNMARKED") {
    context.addIssue({ code: "custom", path: ["startState"], message: "Revision 0 måste vara omarkerad" });
  }
  if (entry.revision === 0 && entry.manualReturnRegistered) {
    context.addIssue({ code: "custom", path: ["manualReturnRegistered"], message: "Revision 0 får inte ha manuell returregistrering" });
  }
  const expectedNeedsFollowUp = entry.forestState === "STARTED_NO_RETURN" ||
    entry.forestState === "UNCONFIRMED" || entry.forestState === "CONFLICT";
  if (entry.needsFollowUp !== expectedNeedsFollowUp) {
    context.addIssue({ code: "custom", path: ["needsFollowUp"], message: "Uppföljningsbehovet måste motsvara skogstillståndet" });
  }
});

const deviceSchema = z.object({
  deviceId: canonicalUuidSchema,
  label: z.string().max(120),
  capability: z.enum(["START_CHECKIN", "FINISH_FOREST_WATCH"]),
  lastReceivedAt: utcMillisecondSchema.nullable(),
  lastSequence: nonnegativePostgresIntegerSchema
}).strict().superRefine((device, context) => {
  if ((device.lastSequence === 0) !== (device.lastReceivedAt === null)) {
    context.addIssue({ code: "custom", path: ["lastSequence"], message: "Sekvens 0 måste exakt motsvara avsaknad av mottagningstid" });
  }
});

export const StartCheckinRosterResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positivePostgresIntegerSchema,
  timeZone: timeZoneSchema,
  generatedAt: utcMillisecondSchema,
  knowledge: z.literal("LAST_SYNCED_ONLY"),
  entries: z.array(rosterEntrySchema).max(10_000),
  devices: z.array(deviceSchema).max(1_000)
}).strict().superRefine((response, context) => {
  const reviewedIds = response.entries.flatMap(entry => entry.reviewedConflictRequestIds ?? []);
  if (reviewedIds.length > 100_000 || new Set(reviewedIds).size !== reviewedIds.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Granskade id måste vara unika i hela loppet och rymmas inom journalgränsen" });
  }
  if (new Set(response.entries.map((entry) => entry.entryId)).size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entry-id måste vara unika" });
  }
  if (new Set(response.devices.map((device) => device.deviceId)).size !== response.devices.length) {
    context.addIssue({ code: "custom", path: ["devices"], message: "Device-id måste vara unika" });
  }
});

export type StartCheckinRosterResponse = z.infer<typeof StartCheckinRosterResponseSchema>;
