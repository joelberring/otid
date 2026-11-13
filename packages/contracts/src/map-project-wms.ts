import { z } from "zod";

/**
 * Ortofoto från valfri öppen WMS-tjänst (t.ex. en kommuns): användaren anger adressen, servern läser tjänstens lager
 * (`capabilities`) och hämtar bilden för kartans ruta (`image`, en bildruta per anrop). Servern hämtar bara från publika
 * https-adresser (se `public-fetch.ts` i application).
 */
export const WMS_URL_MAX_LENGTH = 500;
/** Finaste och grövsta upplösning i meter per pixel (förvalet 0,5 sätts i webbpanelen). */
export const WMS_MIN_METERS_PER_PIXEL = 0.25;
export const WMS_MAX_METERS_PER_PIXEL = 2;
/** Bildrutornas största sida i pixlar och högsta antal rutor per hämtning. */
export const WMS_TILE_MAX_PIXELS = 4000;
export const WMS_MAX_TILES = 16;

const urlSchema = z.string().trim().min(1).max(WMS_URL_MAX_LENGTH);

const mapEpsgSchema = z.number().int().min(1).max(99_999).optional();

export const mapProjectWmsCapabilitiesRequestSchema = z.object({ formatVersion: z.literal(1), url: urlSchema, mapEpsg: mapEpsgSchema }).strict();

export const mapProjectWmsImageRequestSchema = z.object({
  formatVersion: z.literal(1),
  url: urlSchema,
  layer: z.string().min(1).max(200),
  metersPerPixel: z.number().finite().min(WMS_MIN_METERS_PER_PIXEL).max(WMS_MAX_METERS_PER_PIXEL),
  /** Kartprojektets eget koordinatsystem (EPSG), om det är metriskt; används bara när tjänsten inte har SWEREF 99 TM. */
  mapEpsg: mapEpsgSchema,
  box: z.object({ south: z.number().finite(), west: z.number().finite(), north: z.number().finite(), east: z.number().finite() }).strict(),
  /** Vilken bildruta (0 är första); antalet står i svarets `x-otid-tiles`. */
  tile: z.number().int().min(0).max(WMS_MAX_TILES - 1).default(0)
}).strict();

export const mapProjectWmsLayerSchema = z.object({
  name: z.string(), title: z.string(),
  /** Koordinatsystemet som hämtas i: 3006, kartans eget, eller null när lagret inte har något av dem. */
  epsg: z.number().int().nullable()
}).strict();
export const mapProjectWmsCapabilitiesResponseSchema = z.object({
  formatVersion: z.literal(1),
  title: z.string(),
  version: z.enum(["1.3.0", "1.1.1"]),
  formats: z.array(z.string()),
  layers: z.array(mapProjectWmsLayerSchema)
}).strict();

export type MapProjectWmsCapabilitiesResponse = z.infer<typeof mapProjectWmsCapabilitiesResponseSchema>;
