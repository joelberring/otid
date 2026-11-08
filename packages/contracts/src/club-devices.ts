import { z } from "zod";

/**
 * Ägaren 2026-11-08: klubbens enhetsregister (migration 0102). En enhet känns igen på serienumret; utläsningen eller
 * inställningen på sidan Läs ut enheter sparar det senaste. Ledare och administratörer sparar och skriver anteckningar,
 * administratörer tar bort, alla medlemmar ser listan.
 */
const serial = z.number().int().min(1).max(4_294_967_295);
const small = (max: number) => z.number().int().min(0).max(max).nullable();

export const clubDeviceRecordSchema = z.object({
  formatVersion: z.literal(1),
  serialNumber: serial,
  model: z.string().trim().max(40).nullable(),
  firmware: z.string().trim().max(20).nullable(),
  code: small(511),
  mode: small(255),
  batteryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  batteryCapacityRaw: small(65_535),
  memoryKb: small(255),
  backupCount: small(1_000_000),
  /** Enhetens klocka minus datorns, ms (positivt = före). */
  clockOffsetMs: z.number().int().min(-2_000_000_000).max(2_000_000_000).nullable()
}).strict();
export type ClubDeviceRecord = z.infer<typeof clubDeviceRecordSchema>;

export const clubDeviceNoteSchema = z.object({ formatVersion: z.literal(1), serialNumber: serial, note: z.string().trim().max(500) }).strict();
export const clubDeviceDeleteSchema = z.object({ formatVersion: z.literal(1), serialNumber: serial }).strict();

export interface ClubDeviceView {
  readonly serialNumber: number; readonly model: string | null; readonly firmware: string | null; readonly code: number | null; readonly mode: number | null;
  readonly batteryDate: string | null; readonly batteryCapacityRaw: number | null; readonly memoryKb: number | null; readonly backupCount: number | null;
  readonly clockOffsetMs: number | null; readonly note: string; readonly firstSeenAt: string; readonly lastReadAt: string;
  readonly lastReadBy: string | null;
}
export interface ClubDeviceList { readonly formatVersion: 1; readonly devices: readonly ClubDeviceView[]; readonly canRecord: boolean; readonly canDelete: boolean }
