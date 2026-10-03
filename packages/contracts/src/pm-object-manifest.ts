import { z } from "zod";

const maximumBytes = 10 * 1024 * 1024;
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const byteLength = z.number().int().min(1).max(maximumBytes);
const versionId = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+/-]+$/).refine(value => value !== "null");

/** Shape validation only: storage reads must still enforce exact version and hash. */
export const pmObjectManifestSchema = z.object({
  formatVersion: z.literal(1),
  storeId: uuid,
  key: z.string().regex(new RegExp(`^pm/${uuidPattern}/${uuidPattern}$`)),
  versionId,
  sha256,
  byteLength
}).strict();

export type PmObjectManifest = z.infer<typeof pmObjectManifestSchema>;
