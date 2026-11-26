import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * Etapp 3.1: Kontrakt för den publika sökbara kartbanken och klubbkartornas nedladdnings- och användningsspärrar.
 */
export const sourceDownloadPolicySchema = z.enum(["ALLOWED", "CUSTODIANS_ONLY"]);
export const mapUsageScopeSchema = z.enum(["ANY", "CLUB_ACTIVITIES_ONLY", "ADMIN_ONLY"]);
export const publicMapAccessModeSchema = z.enum(["INFO_ONLY", "USE_IN_OTID_LOCKED", "OPEN_DOWNLOAD"]);
export const publicMapNormSchema = z.enum(["ISOM", "ISSprOM", "OTHER"]);
export const publicMapFormatSchema = z.enum(["OCD", "OMAP"]);

export const municipalityCodeSchema = z.string().regex(/^\d{4}$/);
export const countyCodeSchema = z.string().regex(/^\d{2}$/);

export const publicMapBoundsSchema = z.object({
  minLon: z.number().min(-180).max(180),
  minLat: z.number().min(-90).max(90),
  maxLon: z.number().min(-180).max(180),
  maxLat: z.number().min(-90).max(90)
}).strict();

export const publicMapFootprintSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(3)
  .max(200);

export const upsertPublicMapListingInputSchema = z.object({
  formatVersion: z.literal(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  clubName: z.string().trim().max(120).default(""),
  maker: z.string().trim().max(200).default(""),
  scale: z.number().int().min(500).max(100_000).nullable().optional(),
  norm: publicMapNormSchema.default("OTHER"),
  mapYear: z.number().int().min(1950).max(2100).nullable().optional(),
  licenseNote: z.string().trim().max(1000).default(""),
  contact: z.string().trim().max(200).default(""),
  accessMode: publicMapAccessModeSchema.default("INFO_ONLY"),
  showPreview: z.boolean().default(false),
  municipalityCodes: z.array(municipalityCodeSchema).max(20).optional(),
  countyCodes: z.array(countyCodeSchema).max(10).optional(),
  bounds: publicMapBoundsSchema.nullable().optional(),
  footprint: publicMapFootprintSchema.nullable().optional(),
  clubMapVersionId: uuidSchema.nullable().optional()
}).strict();

export const publicMapCatalogQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  municipality: municipalityCodeSchema.optional(),
  county: countyCodeSchema.optional(),
  accessMode: publicMapAccessModeSchema.optional(),
  norm: publicMapNormSchema.optional(),
  minScale: z.coerce.number().int().min(500).max(100_000).optional(),
  maxScale: z.coerce.number().int().min(500).max(100_000).optional(),
  minYear: z.coerce.number().int().min(1950).max(2100).optional(),
  maxYear: z.coerce.number().int().min(1950).max(2100).optional(),
  minLon: z.coerce.number().min(-180).max(180).optional(),
  minLat: z.coerce.number().min(-90).max(90).optional(),
  maxLon: z.coerce.number().min(-180).max(180).optional(),
  maxLat: z.coerce.number().min(-90).max(90).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

export const publicMapListingSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  clubName: z.string(),
  maker: z.string(),
  format: publicMapFormatSchema,
  accessMode: publicMapAccessModeSchema,
  showPreview: z.boolean(),
  hasPreview: z.boolean(),
  previewSha: z.string().regex(/^[a-f0-9]{16,64}$/).nullable().optional(),
  scale: z.number().int().nullable(),
  norm: publicMapNormSchema,
  mapYear: z.number().int().nullable(),
  municipalityCodes: z.array(municipalityCodeSchema),
  countyCodes: z.array(countyCodeSchema),
  minLon: z.number().nullable(),
  maxLon: z.number().nullable(),
  minLat: z.number().nullable(),
  maxLat: z.number().nullable(),
  footprint: publicMapFootprintSchema.nullable(),
  publishedAt: z.string(),
  updatedAt: z.string()
}).strict();

export const publicMapListingDetailSchema = publicMapListingSummarySchema.extend({
  description: z.string(),
  licenseNote: z.string(),
  contact: z.string(),
  clubId: uuidSchema.nullable(),
  clubMapId: uuidSchema.nullable(),
  clubMapVersionId: uuidSchema.nullable(),
  mapProjectId: uuidSchema.nullable(),
  canDownload: z.boolean(),
  canUseInOtid: z.boolean()
}).strict();

export const attachClubMapToRaceRequestSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema
}).strict();

export const usePublicMapListingRequestSchema = z.object({
  formatVersion: z.literal(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  raceDate: z.iso.date().optional()
}).strict();

export type SourceDownloadPolicy = z.infer<typeof sourceDownloadPolicySchema>;
export type MapUsageScope = z.infer<typeof mapUsageScopeSchema>;
export type PublicMapAccessMode = z.infer<typeof publicMapAccessModeSchema>;
export type PublicMapNorm = z.infer<typeof publicMapNormSchema>;
export type PublicMapBounds = z.infer<typeof publicMapBoundsSchema>;
export type PublicMapFootprint = z.infer<typeof publicMapFootprintSchema>;
export type PublicMapListingSummary = z.infer<typeof publicMapListingSummarySchema>;
export type PublicMapListingDetail = z.infer<typeof publicMapListingDetailSchema>;
