import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const instant = z.iso.datetime({ offset: true });
const timeZone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Tidszonen stöds inte av Intl");

export const startListAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_start_list_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();

export const startListAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  capability: z.literal("VIEW_START_LIST"),
  expiresAt: instant
}).strict();

const entrySchema = z.object({
  id: uuid,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  fixedStartTime: instant.nullable(),
  cardNumber: z.string().trim().min(1).max(32).nullable(),
  multipleActiveAssignments: z.boolean()
}).strict().superRefine((entry, context) => {
  if (entry.multipleActiveAssignments && entry.cardNumber !== null) {
    context.addIssue({ code: "custom", path: ["cardNumber"], message: "Flera aktiva brickkopplingar får inte välja en bricka" });
  }
});

const classSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(160),
  startRule: z.enum(["FIXED", "PUNCH"]),
  entries: z.array(entrySchema).max(10_000)
}).strict().superRefine((raceClass, context) => {
  const entryIds = new Set(raceClass.entries.map((entry) => entry.id));
  if (entryIds.size !== raceClass.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika inom klassen" });
  }
  if (raceClass.startRule === "PUNCH" && raceClass.entries.some((entry) => entry.fixedStartTime !== null)) {
    context.addIssue({ code: "custom", path: ["entries"], message: "PUNCH-klasser får inte exponera fast starttid" });
  }
});

export const startListAdminListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  snapshotVersion: version,
  timeZone,
  generatedAt: instant,
  classes: z.array(classSchema).max(1_000)
}).strict().superRefine((response, context) => {
  const classIds = new Set(response.classes.map((raceClass) => raceClass.id));
  if (classIds.size !== response.classes.length) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Klass-id måste vara unika" });
  }
  const entries = response.classes.flatMap((raceClass) => raceClass.entries);
  if (entries.length > 10_000) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Startlistan får innehålla högst 10 000 deltagare" });
  }
  const entryIds = new Set(entries.map((entry) => entry.id));
  if (entryIds.size !== entries.length) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Deltagar-id måste vara unika i loppet" });
  }
});

export { entryClassAdminErrorResponseSchema as startListAdminErrorResponseSchema } from "./entry-class-admin";
export type { EntryClassAdminErrorCode as StartListAdminErrorCode, EntryClassAdminErrorResponse as StartListAdminErrorResponse } from "./entry-class-admin";
export type StartListAdminLoginRequest = z.infer<typeof startListAdminLoginRequestSchema>;
export type StartListAdminLoginResponse = z.infer<typeof startListAdminLoginResponseSchema>;
export type StartListAdminListResponse = z.infer<typeof startListAdminListResponseSchema>;
