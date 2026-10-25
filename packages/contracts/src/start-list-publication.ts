import { z } from "zod";
import { courseVariantCodeSchema } from "./course-edit";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";
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
    /**
     * Steg 33: löparens aktiva bricka när startlistan publicerades. Visas publikt bara när tävlingens inställning
     * "Visa bricknummer i den publika startlistan" är på; annars tas den bort innan listan lämnar servern.
     */
    cardNumber: z.string().trim().min(1).max(32).optional(),
    /** Steg 46: deltagaren registrerade sig själv på tävlingsdagen (inte bekräftad av arrangören). Visas diskret publikt. */
    selfRegistered: z.literal(true).optional(),
    /** Gafflad klass: löparens variant (ADR-0169 beslut 2). Saknas för klasser utan varianter. */
    courseVariantCode: courseVariantCodeSchema.optional(),
    /** Stafett (ADR-0169 beslut 3): laget och sträckan. Sträcka 2 och senare har ingen starttid före växlingen. */
    relay: z.object({ teamNumber: z.number().int().min(1).max(99999), teamName: z.string().trim().min(1).max(160),
        teamOrganisationName: z.string().trim().min(1).max(200).nullable(), leg: z.number().int().min(1).max(30),
        startMethod: z.enum(["MASS_START", "CHANGEOVER", "RESTART", "FLYING_RESTART"]),
        /** Steg 47: sträckans egen bana när den inte är klassens. */
        courseName: z.string().trim().min(1).max(160).optional() }).strict().optional()
}).strict();
/** Startlistans fakta om klassen (PLAN.md steg 13). Saknas i publiceringar gjorda före steg 13. */
export const startListClassFactsSchema = z.object({
    courseName: z.string().trim().min(1).max(160).optional(),
    /** Banans längd och stigning i meter (PLAN.md steg 25); null när de inte är kända. */
    courseLengthMeters: z.number().int().min(1).max(1_000_000).nullable().optional(),
    courseClimbMeters: z.number().int().min(0).max(100_000).nullable().optional(),
    /** Banans första kontroll: klasser med samma första kontroll startar från samma startfålla. */
    firstControlCode: z.number().int().positive().max(2_147_483_647).nullable().optional(),
    /** Lottningens startsätt; null när klassen inte är lottad. */
    drawMethod: z.enum(["MINUTE", "MASS"]).nullable().optional(),
    /** Lediga lottade starttider (vakanser). */
    vacancies: z.array(instant).max(10000).optional(),
    /** Stafettklass: antal sträckor. */
    relayLegCount: z.number().int().min(2).max(30).optional()
}).strict();
const raceClass = z.object({
    name: z.string().trim().min(1).max(160), startRule: z.enum(["FIXED", "PUNCH"]), entries: z.array(entry).max(10000),
    ...startListClassFactsSchema.shape
}).strict().refine((v) => v.startRule === "FIXED" || v.entries.every((e) => e.fixedStartTime === null));
export const startListPublicationContentSchema = z.object({
    eventName: z.string().trim().min(1).max(160), raceName: z.string().trim().min(1).max(160), raceDate: z.iso.date(), timeZone: timezone, classes: z.array(raceClass).max(1000)
}).strict().superRefine((v, c) => {
    if (v.classes.flatMap((x) => x.entries).length > 10000)
        c.addIssue({
            code: "custom", message: "För många deltagare"
        });
});
const latest = z.object({
    revision: positive, action: z.enum(["PUBLISH", "WITHDRAW"]), decidedAt: instant, sourceSnapshotVersion: positive, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable()
}).strict().refine((v) => (v.action === "PUBLISH") === (v.sourceHash !== null));
export const startListPublicationPreviewResponseSchema = z.object({
    formatVersion: z.literal(1), raceId: uuid, snapshotVersion: positive, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), latestDecision: latest.nullable(), content: startListPublicationContentSchema.nullable()
}).strict().refine((v) => (v.sourceHash === null) === (v.content === null));
export const startListPublicationRequestSchema = z.discriminatedUnion("action", [z.object({
        formatVersion: z.literal(1), action: z.literal("PUBLISH"), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: version
    }).strict(), z.object({
        formatVersion: z.literal(1), action: z.literal("WITHDRAW"), expectedRevision: positive
    }).strict()]);
export const startListPublicationIdempotencyKeySchema = z.string().regex(prefixedUuidPattern("start-list-publication"));
export const startListPublicationResponseSchema = z.object({
    formatVersion: z.literal(1), raceId: uuid, requestId: uuid, replayed: z.boolean(), revision: positive, action: z.enum(["PUBLISH", "WITHDRAW"]), decidedAt: instant, sourceSnapshotVersion: positive, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable()
}).strict().refine((v) => (v.action === "PUBLISH") === (v.sourceHash !== null));
export const publicStartListResponseSchema = z.object({
    iofExportAvailable: z.boolean().default(false),
    /** Steg 33: tävlingens inställning. Av = inga bricknummer i listan, även i en redan publicerad lista. */
    showCardNumbers: z.boolean().default(false),
    /**
     * "Uppdatera startlistan löpande": listan är läget just nu (samma innehåll som en publicering skulle ge), inte en
     * ögonblicksbild. `revision` är då tävlingens version och `publishedAt` när listan lästes.
     */
    live: z.boolean().default(false),
    formatVersion: z.literal(1), revision: positive, publishedAt: instant, content: startListPublicationContentSchema.refine((v) => v.classes.some((x) => x.entries.length > 0))
}).strict().refine((v) => v.showCardNumbers || v.content.classes.every((x) => x.entries.every((e) => e.cardNumber === undefined)));
export { entryClassAdminErrorResponseSchema as startListPublicationAdminErrorResponseSchema } from "./entry-class-admin";
export type StartListPublicationContent = z.infer<typeof startListPublicationContentSchema>;
export type StartListClassFacts = z.infer<typeof startListClassFactsSchema>;
export type StartListPublicationPreviewResponse = z.infer<typeof startListPublicationPreviewResponseSchema>;
export type StartListPublicationRequest = z.infer<typeof startListPublicationRequestSchema>;
export type StartListPublicationResponse = z.infer<typeof startListPublicationResponseSchema>;
export type PublicStartListResponse = z.infer<typeof publicStartListResponseSchema>;
