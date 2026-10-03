import { z } from "zod";

/** The public SSE payload intentionally contains no result or identity data. */
export const publicResultEventStreamPayloadSchema = z.object({
  formatVersion: z.literal(1)
}).strict();

export type PublicResultEventStreamPayload = z.infer<typeof publicResultEventStreamPayloadSchema>;
