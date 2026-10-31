import { z } from "zod";
import { courseVariantCodeSchema } from "./course-edit";
import { uuidSchema as uuid } from "./ids";
import { legKeySchema } from "./race-map";
import { raceMapSourceGeoreferenceSchema, raceMapSourceRenderSchema } from "./race-map-source";

/**
 * Steg 60 (ADR-0179 beslut 7–13): vägvalsanalysen. Analysen räknas i arrangörens webbläsare och sparas inte; här finns
 * tävlingens inställningar (`RouteChoiceSettings` i `@o-tid/route-choice`), de bästa vägarna som arrangören publicerar och
 * det arbetsytan behöver för att räkna (kontrollernas lägen i kartfilens mm). Inga personuppgifter i GPS-delarna.
 */
export const ROUTE_CHOICE_SPEED_CLASSES = ["FAST", "NORMAL", "SLOW", "VERY_SLOW", "FIGHT", "IMPASSABLE", "IGNORE"] as const;
export const ROUTE_CHOICE_SPEED_FACTOR_CLASSES = ["FAST", "NORMAL", "SLOW", "VERY_SLOW", "FIGHT"] as const;
/** Publiceringens storlek: en bana med många sträckor och förenklade linjer ryms gott. */
export const ROUTE_CHOICE_PUBLISH_MAX_BYTES = 512 * 1024;
export const ROUTE_CHOICE_SETTINGS_MAX_BYTES = 64 * 1024;

const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const mm = z.number().finite().min(-1_000_000).max(1_000_000);
const count = z.number().int().nonnegative().max(1_000_000);
const code = z.number().int().positive().max(100_000);
/** Symbolnummer som i kartfilen: "406", "406.0", "105.100". */
export const routeChoiceSymbolCodeSchema = z.string().regex(/^\d{1,4}(\.\d{1,4})?$/);
export const routeChoiceSpeedClassSchema = z.enum(ROUTE_CHOICE_SPEED_CLASSES);

export const routeChoiceSettingsSchema = z.object({
  version: z.literal(1),
  classBySymbol: z.record(routeChoiceSymbolCodeSchema, routeChoiceSpeedClassSchema)
    .refine(value => Object.keys(value).length <= 2000).optional(),
  speedByClass: z.object(Object.fromEntries(ROUTE_CHOICE_SPEED_FACTOR_CLASSES.map(name => [name, z.number().finite().min(0.01).max(3).optional()])))
    .strict().optional(),
  contourIntervalMeters: z.number().finite().min(0.5).max(50).optional(),
  climbFactor: z.number().finite().min(0).max(50).optional(),
  referencePaceSecondsPerKm: z.number().finite().min(120).max(1800).optional()
}).strict();
export type RouteChoiceSettingsDto = z.infer<typeof routeChoiceSettingsSchema>;

/** Kartfilens mm (y uppåt) för en punkt; null när läget saknas eller inte kan räknas om. */
const paper = z.object({ x: mm, y: mm }).strict();

/** En publicerad linje: kartfilens mm, förenklad i webbläsaren. */
export const routeChoiceLineSchema = z.array(z.tuple([mm, mm])).min(2).max(2000);

export const routeChoicePublishedCourseSchema = z.object({
  courseId: uuid,
  variantCode: courseVariantCodeSchema.nullable(),
  legs: count,
  publishedAt: instant
}).strict();

/** Arbetsytans vägvalsläge: inställningar, publicerat och kontrollernas lägen i kartfilens mm. */
export const adminRouteChoiceSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  settings: routeChoiceSettingsSchema,
  /** null = ingen kartfil; analysen kräver kartfilen. */
  mapFile: z.object({
    sha256,
    scale: z.number().int().min(100).max(1_000_000),
    render: raceMapSourceRenderSchema,
    georeference: raceMapSourceGeoreferenceSchema.nullable(),
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    /** PAPER = banfilens kartlägen på kartfilen; GEO = lägena räknade ur banfilens WGS 84 med kartfilens georeferens; NONE = inga lägen. */
    placement: z.enum(["PAPER", "GEO", "NONE"]),
    /** Banfilens kartlägen passar inte kartfilen ("Banfilen verkar inte vara gjord på den här kartan"). */
    mismatch: z.boolean()
  }).strict().nullable(),
  controls: z.array(z.object({ code, at: paper.nullable() }).strict()).max(2000),
  /** `routeRunners` = löpare med publicerat resultat på banan och uppladdad GPS-rutt (för kalibreringen). */
  courses: z.array(z.object({ courseId: uuid, start: paper.nullable(), finish: paper.nullable(), routeRunners: count }).strict()).max(1000),
  published: z.array(routeChoicePublishedCourseSchema).max(5000),
  /** Kartfilen som de publicerade linjerna räknades på; skiljer den sig från dagens kartfil visas de inte publikt. */
  publishedMapSha256: sha256.nullable()
}).strict();
export type AdminRouteChoice = z.infer<typeof adminRouteChoiceSchema>;

export const routeChoiceSettingsRequestSchema = z.object({ formatVersion: z.literal(1), settings: routeChoiceSettingsSchema }).strict();

export const routeChoicePublishRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    formatVersion: z.literal(1), kind: z.literal("PUBLISH"), mapSha256: sha256, courseId: uuid, variantCode: courseVariantCodeSchema.nullable(),
    legs: z.array(z.object({ key: legKeySchema, points: routeChoiceLineSchema }).strict()).min(1).max(300)
  }).strict(),
  z.object({ formatVersion: z.literal(1), kind: z.literal("WITHDRAW"), courseId: uuid, variantCode: courseVariantCodeSchema.nullable() }).strict()
]);
export type RouteChoicePublishRequest = z.infer<typeof routeChoicePublishRequestSchema>;

/** Begripliga fel (HTTP 422): kartfilen saknas eller har bytts, eller sträckorna hör inte till banan. */
export const routeChoiceProblemSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(["NO_MAP_FILE", "MAP_FILE_CHANGED", "UNKNOWN_COURSE", "UNKNOWN_LEG"])
}).strict();
export type RouteChoiceProblem = z.infer<typeof routeChoiceProblemSchema>["error"];

/**
 * GPS-rutternas delar per sträcka för kalibreringen (bara admin): löpare med publicerat resultat på banan och uppladdad
 * rutt, utan namn. Punkterna är [ms från sträckans start, lat, lon] i tidsordning, klippta som i den publika sträcktidsanalysen.
 */
export const routeChoiceCalibrationRoutesSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  courseId: uuid,
  runners: z.array(z.object({
    variantCode: courseVariantCodeSchema.nullable(),
    /** Punkterna [ms från sträckans start, lat, lon]. */
    legs: z.array(z.object({ key: legKeySchema, milliseconds: z.number().int().positive().max(86_400_000),
      points: z.array(z.tuple([z.number().int().min(0).max(86_400_000), z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180)]))
        .min(2).max(100_000) }).strict())
      .max(300)
  }).strict()).max(5000)
}).strict();
export type RouteChoiceCalibrationRoutes = z.infer<typeof routeChoiceCalibrationRoutesSchema>;
