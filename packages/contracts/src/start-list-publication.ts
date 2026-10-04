import { z } from "zod";
import { courseVariantCodeSchema } from "./course-edit";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().nonnegative().max(2147483647);
const positive = z.number().int().positive().max(2147483647);
const instant = z.iso.datetime({
    offset: true
});
const timezone = z.string().trim().min(1).max(100).refine((value) => {
    try {
        new Intl.DateTimeFormat("sv-SE", {
            timeZone: value
        });
        return true;
    }
    catch {
        return false;
    }
});
const entry = z.object({
    displayName: z.string().trim().min(1).max(321), organisationName: z.string().trim().min(1).max(240).nullable(), fixedStartTime: instant.nullable(),
    /** Gafflad klass: löparens variant (ADR-0169 beslut 2). Saknas för klasser utan varianter. */
    courseVariantCode: courseVariantCodeSchema.optional()
}).strict();
const raceClass = z.object({
    name: z.string().trim().min(1).max(160), startRule: z.enum(["FIXED", "PUNCH"]), entries: z.array(entry).max(10000)
}).strict().refine((v) => v.startRule === "FIXED" || v.entries.every((e) => e.fixedStartTime === null));
export const startListPublicationContentSchema = z.object({
    eventName: z.string().trim().min(1).max(160), raceName: z.string().trim().min(1).max(160), raceDate: z.iso.date(), timeZone: timezone, classes: z.array(raceClass).max(1000)
}).strict().superRefine((v, c) => {
    if (v.classes.flatMap((x) => x.entries).length > 10000)
        c.addIssue({
            code: "custom", message: "För många deltagare"
        });
});
export const startListPublicationAdminLoginRequestSchema = z.object({
    formatVersion: z.literal(1), accessCredential: z.string().regex(/^otid_org_start_list_publication_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();
export const startListPublicationAdminLoginResponseSchema = z.object({
    formatVersion: z.literal(1), raceId: uuid, capability: z.literal("PUBLISH_START_LIST"), expiresAt: instant
}).strict();
const latest = z.object({
    revision: positive, action: z.enum(["PUBLISH", "WITHDRAW"]), decidedAt: instant, sourceSnapshotVersion: positive, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable()
}).strict().refine((v) => (v.action === "PUBLISH") === (v.sourceHash !== null));
export const startListPublicationPreviewResponseSchema = z.object({
    formatVersion: z.literal(1), raceId: uuid, snapshotVersion: positive, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), latestDecision: latest.nullable(), content: startListPublicationContentSchema.nullable()
}).strict().refine((v) => (v.sourceHash === null) === (v.content === null));
export const startListPublicationRequestSchema = z.discriminatedUnion("action", [z.object({
        formatVersion: z.literal(1), action: z.literal("PUBLISH"), expectedSnapshotVersion: positive, expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: version
    }).strict(), z.object({
        formatVersion: z.literal(1), action: z.literal("WITHDRAW"), expectedRevision: positive
    }).strict()]);
export const startListPublicationIdempotencyKeySchema = z.string().regex(/^start-list-publication:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const startListPublicationResponseSchema = z.object({
    formatVersion: z.literal(1), raceId: uuid, requestId: uuid, replayed: z.boolean(), revision: positive, action: z.enum(["PUBLISH", "WITHDRAW"]), decidedAt: instant, sourceSnapshotVersion: positive, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable()
}).strict().refine((v) => (v.action === "PUBLISH") === (v.sourceHash !== null));
export const publicStartListResponseSchema = z.object({
    iofExportAvailable: z.boolean().default(false),
    formatVersion: z.literal(1), revision: positive, publishedAt: instant, content: startListPublicationContentSchema.refine((v) => v.classes.some((x) => x.entries.length > 0))
}).strict();
export { entryClassAdminErrorResponseSchema as startListPublicationAdminErrorResponseSchema } from "./entry-class-admin";
export type StartListPublicationContent = z.infer<typeof startListPublicationContentSchema>;
export type StartListPublicationAdminLoginRequest = z.infer<typeof startListPublicationAdminLoginRequestSchema>;
export type StartListPublicationAdminLoginResponse = z.infer<typeof startListPublicationAdminLoginResponseSchema>;
export type StartListPublicationPreviewResponse = z.infer<typeof startListPublicationPreviewResponseSchema>;
export type StartListPublicationRequest = z.infer<typeof startListPublicationRequestSchema>;
export type StartListPublicationResponse = z.infer<typeof startListPublicationResponseSchema>;
export type PublicStartListResponse = z.infer<typeof publicStartListResponseSchema>;
