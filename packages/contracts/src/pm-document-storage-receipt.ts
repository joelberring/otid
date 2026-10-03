import { z } from "zod";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const pmDocumentStorageReceiptSchema = z.object({
  formatVersion: z.literal(1), uploadId: uuid, raceId: uuid,
  storedAt: z.iso.datetime(), replayed: z.boolean()
}).strict();
