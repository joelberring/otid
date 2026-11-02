import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);
export const newEntryCardNumberSchema = z.string().trim().regex(/^[1-9][0-9]{0,31}$/);
const assignment = z.object({ id: uuid, cardNumber: z.string().min(1).max(32) }).strict();

export const entryCardAdminListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  entries: z.array(z.object({ id: uuid, displayName: z.string().min(1).max(321), classId: uuid,
    className: z.string().min(1).max(160), version,
    activeAssignment: assignment.nullable(), multipleActiveAssignments: z.boolean()
  }).strict().refine((row) => !row.multipleActiveAssignments || row.activeAssignment === null)).max(10_000)
}).strict().refine((value) => new Set(value.entries.map((row) => row.id)).size === value.entries.length);
/**
 * Översynen 2026-11-02: "Byt bricka med …" – två löpare har bytt brickor. Brickan som anges är den andra löparens aktiva
 * bricka; den andra löparen får den här löparens bricka. Båda byts i samma transaktion.
 */
const swapWithSchema = z.object({ entryId: uuid, expectedEntryVersion: version, expectedClassId: uuid, expectedAssignment: assignment }).strict();
export const entryCardChangeRequestSchema = z.object({ formatVersion: z.literal(1),
  expectedEntryVersion: version, expectedClassId: uuid,   expectedAssignment: assignment.nullable(), cardNumber: newEntryCardNumberSchema,
  swapWith: swapWithSchema.optional()
}).strict().refine((row) => !row.swapWith || (row.expectedAssignment !== null && row.swapWith.expectedAssignment.cardNumber === row.cardNumber));
export const entryCardChangeIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("entry-card-change"));
/** En avläsning som redan fanns för brickan och nu kopplades till löparen och räknades (översynen 2026-11-02). */
export const linkedReadoutSchema = z.object({ entryId: uuid, readoutId: uuid, cardNumber: z.string().min(1).max(32),
  readAt: z.iso.datetime({ offset: true }), status: z.enum(["OK", "OVERTIME", "MP"]), revision: version }).strict();
export const entryCardChangeResponseSchema = z.object({ formatVersion: z.literal(1), replayed: z.boolean(),
  requestId: uuid, raceId: uuid, entryId: uuid, classId: uuid,
  previousAssignment: assignment.nullable(), activeAssignment: assignment,
  entryVersionBefore: version, entryVersionAfter: version, snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true }),
  /** Den andra löparen vid "Byt bricka med …". */
  swappedWith: z.object({ entryId: uuid, displayName: z.string().min(1).max(321), previousAssignment: assignment,
    activeAssignment: assignment, entryVersionBefore: version, entryVersionAfter: version }).strict().optional(),
  /** Avläsningar av den nya brickan som kopplades och räknades. */
  linkedReadouts: z.array(linkedReadoutSchema).max(2).optional(),
  /**
   * Löpare som har kvar ett resultat från en avläsning av den bricka de inte längre har (bytet upptäcktes när bara en av
   * dem lästs ut). Resultatet ersätts när löparen läses ut med sin nya bricka.
   */
  staleResults: z.array(z.object({ entryId: uuid, displayName: z.string().min(1).max(321) }).strict()).max(2).optional()
}).strict().refine((row) => row.previousAssignment?.id !== row.activeAssignment.id &&
  row.previousAssignment?.cardNumber !== row.activeAssignment.cardNumber &&
  row.entryVersionAfter === row.entryVersionBefore + 1 && row.snapshotVersionAfter === row.snapshotVersionBefore + 1);
export { entryClassAdminErrorResponseSchema as entryCardAdminErrorResponseSchema } from "./entry-class-admin";
/**
 * 409 när brickan är aktiv hos en annan löpare (översynen 2026-11-02). Inte "har ändrats under tiden": svaret säger vem
 * som har brickan så att administratören kan välja "Byt bricka med …".
 */
export const entryCardInUseResponseSchema = z.object({ formatVersion: z.literal(1), error: z.literal("CARD_IN_USE"),
  holder: z.object({ entryId: uuid, displayName: z.string().min(1).max(321), classId: uuid, className: z.string().min(1).max(160),
    version, assignment }).strict() }).strict();
export type EntryCardInUseResponse = z.infer<typeof entryCardInUseResponseSchema>;
export type LinkedReadout = z.infer<typeof linkedReadoutSchema>;
export type { EntryClassAdminErrorCode as EntryCardAdminErrorCode } from "./entry-class-admin";
export type EntryCardAdminListResponse = z.infer<typeof entryCardAdminListResponseSchema>;
export type EntryCardChangeRequest = z.infer<typeof entryCardChangeRequestSchema>;
export type EntryCardChangeResponse = z.infer<typeof entryCardChangeResponseSchema>;
