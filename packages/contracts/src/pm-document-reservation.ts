import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const pmDocumentReservationResponseSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  requestId: uuid,
  raceId: uuid,
  replayed: z.boolean(),
  reservedAt: z.iso.datetime()
}).strict();
