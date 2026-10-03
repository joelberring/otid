import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "UUID måste vara kanonisk och gemen"
);

export const stationPairingRedemptionRequestSchema = z.object({
  formatVersion: z.literal(1),
  attemptId: canonicalUuidSchema,
  deviceId: canonicalUuidSchema,
  credentialSecretHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const stationPairingCredentialMetadataSchema = z.object({
  credentialId: canonicalUuidSchema,
  deviceId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  scope: z.literal("READOUT"),
  generation: z.number().int().positive(),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

export const stationPairingRedemptionResponseSchema = z.object({
  formatVersion: z.literal(1),
  attemptId: canonicalUuidSchema,
  credential: stationPairingCredentialMetadataSchema
}).strict();

export type StationPairingRedemptionRequest = z.infer<typeof stationPairingRedemptionRequestSchema>;
export type StationPairingCredentialMetadata = z.infer<typeof stationPairingCredentialMetadataSchema>;
export type StationPairingRedemptionResponse = z.infer<typeof stationPairingRedemptionResponseSchema>;
