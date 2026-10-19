import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);
const name = z.string().trim().min(1).max(160);
const utcMilliseconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value =>
  Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const manualClassCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid,   courseVersionId: uuid, className: name, startRule: z.enum(["FIXED", "PUNCH"])
}).strict();
export const manualClassCreateIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("manual-class-create"));

export const manualClassCreateResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  courseId: uuid, courseVersionId: uuid, courseName: z.string().min(1), courseVersion: version,
  classId: uuid, request: manualClassCreateRequestSchema,
  snapshotVersionBefore: version, snapshotVersionAfter: version, createdAt: utcMilliseconds
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Snapshotversionen måste öka exakt ett steg" });
  }
  if (value.requestId !== value.request.requestId || value.courseVersionId !== value.request.courseVersionId) {
    context.addIssue({ code: "custom", path: ["requestId"], message: "Kvittensen måste binda request och banversion" });
  }
});

export type ManualClassCreateRequest = z.infer<typeof manualClassCreateRequestSchema>;
export type ManualClassCreateResponse = z.infer<typeof manualClassCreateResponseSchema>;
