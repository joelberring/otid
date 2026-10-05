import { z } from "zod";

/**
 * Karta och vägval (ADR-0171, PLAN.md steg 16). Admin laddar upp kartbilden, georefererar den med tre punkter
 * och laddar upp löparnas GPS-rutter (GPX). Den publika sträcktidsanalysen länkar till vägvalen; vägvalsvyn
 * visar bara rutternas delar för en sträcka, aldrig hela rutten.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const name = z.string().trim().min(1).max(400);
const count = z.number().int().nonnegative().max(1_000_000);

/** Kartbilden: PNG eller JPEG, högst 30 MB. */
export const RACE_MAP_MAX_BYTES = 30 * 1024 * 1024;
export const RACE_MAP_MEDIA_TYPES = ["image/png", "image/jpeg"] as const;
/** GPX-filen: högst 8 MB (samma gräns som tolken). */
export const PARTICIPANT_ROUTE_MAX_BYTES = 8 * 1024 * 1024;
export const PARTICIPANT_ROUTE_CONTENT_TYPE = "application/gpx+xml";

/** En sträcka: från- och till-punkt, t.ex. "S-31.1", "31.1-32.1" eller "33.1-F" (som domänens `legKey`). */
export const legKeySchema = z.string().regex(/^(S|\d{1,9}\.\d{1,3})-(F|\d{1,9}\.\d{1,3})$/);

export const raceMapTiePointSchema = z.object({
  pixelX: z.number().finite().min(0).max(30_000), pixelY: z.number().finite().min(0).max(30_000),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180)
}).strict();

export const raceMapGeoreferenceRequestSchema = z.object({
  formatVersion: z.literal(1),
  tiePoints: z.tuple([raceMapTiePointSchema, raceMapTiePointSchema, raceMapTiePointSchema])
}).strict();

export const adminRaceMapStateSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  map: z.object({
    fileName: name, mediaType: z.enum(RACE_MAP_MEDIA_TYPES), width: z.number().int().positive(), height: z.number().int().positive(),
    byteLength: count.max(RACE_MAP_MAX_BYTES), uploadedAt: instant,
    tiePoints: z.array(raceMapTiePointSchema).length(3).nullable(), georeferencedAt: instant.nullable()
  }).strict().nullable(),
  /** Individuella löpare som kan få en rutt (stafettens sträcklöpare stöds inte). */
  runners: z.array(z.object({ entryId: uuid, name, className: name, club: name.nullable() }).strict()).max(20_000),
  routes: z.array(z.object({
    entryId: uuid, fileName: name, pointCount: count, startsAt: instant, endsAt: instant, uploadedAt: instant,
    /** Sträckor som rutten täcker, när löparen har ett publicerat resultat med tider. */
    coveredLegs: count, legs: count
  }).strict()).max(20_000)
}).strict();

export const participantRouteUploadResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, pointCount: count, coveredLegs: count, legs: count
}).strict();

/** Begripliga fel vid uppladdning och georeferens (HTTP 422). */
export const raceMapProblemSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(["INVALID_IMAGE", "IMAGE_TOO_LARGE", "INVALID_GPX", "ROUTE_WITHOUT_TIMES", "INVALID_GEOREFERENCE", "NO_MAP", "NOT_INDIVIDUAL"])
}).strict();

const pixel = z.tuple([z.number().finite(), z.number().finite()]);

/** Vägval på en sträcka: den valda löparens del av rutten och andras på samma sträcka att jämföra med. */
export const publicLegRoutesSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  leg: legKeySchema,
  map: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), version: z.string().regex(/^[a-f0-9]{16}$/) }).strict(),
  runners: z.array(z.object({
    publicResultId: uuid, name, className: name, legMs: z.number().int().nonnegative(), selected: z.boolean(),
    points: z.array(pixel).min(2).max(100_000)
  }).strict()).min(1).max(500)
}).strict();

export type RaceMapTiePoint = z.infer<typeof raceMapTiePointSchema>;
export type RaceMapGeoreferenceRequest = z.infer<typeof raceMapGeoreferenceRequestSchema>;
export type AdminRaceMapState = z.infer<typeof adminRaceMapStateSchema>;
export type ParticipantRouteUploadResponse = z.infer<typeof participantRouteUploadResponseSchema>;
export type RaceMapProblem = z.infer<typeof raceMapProblemSchema>["error"];
export type PublicLegRoutes = z.infer<typeof publicLegRoutesSchema>;
