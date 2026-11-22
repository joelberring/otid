import { z } from "zod";
import { UUID_SOURCE as canonicalUuidPattern } from "./ids";

/**
 * PLAN.md steg M4 (ADR-0229 tillägg M4): recept för återskapbart underlag. Ett recept står i registret (`map_content.recipe`)
 * och säger hur innehållet skapas igen: källan, rutan eller området, datumet och parametrarna. Laserkörningarnas resultat får
 * sitt recept av servern (jobbets begäran); hämtade bilder får det från webbläsaren, som hämtar om dem på samma sätt.
 */
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const finite = z.number().finite();
const wgs84Box = z.object({ south: finite, west: finite, north: finite, east: finite }).strict();
/** Kartans mm (y uppåt), som `prepareRemoteLayer` tar. */
const mapBounds = z.object({ minX: finite, minY: finite, maxX: finite, maxY: finite }).strict();

/** Bilder som servern hämtar åt webbläsaren (anropet görs om med samma kropp) och ortofoton från Lantmäteriet. */
export const LAYER_RECIPE_SOURCES = ["LM_ORTHO", "SLU_MOISTURE", "SKS_FOREST", "WMS"] as const;
export type LayerRecipeSource = typeof LAYER_RECIPE_SOURCES[number];

export const layerRecipeSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("LM_ORTHO"), href: z.string().url().max(1000), area: mapBounds,
    collection: z.string().max(200).nullable(), datetime: z.string().max(40).nullable() }).strict(),
  z.object({ source: z.literal("SLU_MOISTURE"), request: z.object({ formatVersion: z.literal(1), box: wgs84Box }).strict() }).strict(),
  z.object({ source: z.literal("SKS_FOREST"), request: z.object({ formatVersion: z.literal(1), box: wgs84Box,
    product: z.string().regex(/^[A-Z_]{1,40}$/) }).strict() }).strict(),
  z.object({ source: z.literal("WMS"), request: z.object({ formatVersion: z.literal(1), url: z.string().url().max(500), layer: z.string().min(1).max(300),
    metersPerPixel: finite.positive(), box: wgs84Box, tile: z.number().int().min(0).max(1000), mapEpsg: z.number().int().min(1).max(999_999).optional() })
    .strict() }).strict()
]);
export type LayerRecipe = z.infer<typeof layerRecipeSchema>;

/** Adressen under projektets `sources/` som bilden hämtas från igen (ortofotot läses i webbläsaren genom `asset`). */
export const LAYER_RECIPE_PATHS: Readonly<Record<Exclude<LayerRecipeSource, "LM_ORTHO">, string>> = {
  SLU_MOISTURE: "markfuktighet", SKS_FOREST: "skogsstyrelsen", WMS: "wms/image"
};

/** Laserkörningens recept: körningen (dess begäran är hela receptet), filen, rutorna, klipprutan och skanningens datum. */
export interface LaserRecipe {
  readonly source: "LASER"; readonly jobId: string; readonly output: string; readonly tiles: number;
  readonly clip: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
  readonly scannedAt: string | null; readonly settings: Readonly<Record<string, number>>;
}
/** Receptet som det står i registret: källans eget och när innehållet skapades. */
export type StoredRecipe = (LayerRecipe | LaserRecipe) & { readonly createdAt?: string };

/** Det som saknas i ett projekt och kan återskapas (PLAN.md steg M4). */
export const regenerableMissingSchema = z.object({
  formatVersion: z.literal(1),
  /** Laserkörningar vars resultat tagits bort ur förrådet; «Kör om» räknas inte mot laserkvoten. */
  laserRuns: z.array(z.object({ jobId: uuid, name: z.string().max(200), files: z.number().int().min(0), bytes: z.number().int().min(0) }).strict()).max(50),
  /** Underlag vars bild tagits bort; hämtas om med receptet i webbläsaren (de från en laserkörning följer körningen). */
  layers: z.array(z.object({ layerId: uuid, name: z.string().max(200), source: z.enum([...LAYER_RECIPE_SOURCES, "LASER"]), jobId: uuid.nullable(),
    bytes: z.number().int().min(0) }).strict()).max(100),
  /** Kontots återskapbara passerar gränsen fast allt som får tas bort är borta (skyddet räcker inte): de tyngsta projekten. */
  overLimitProjects: z.array(z.string().max(200)).max(2)
}).strict();
export type RegenerableMissing = z.infer<typeof regenerableMissingSchema>;

/** Kontosidan: gränsen för återskapbart och vad som tas bort härnäst (äldst använt först). */
export const accountRegenerableSchema = z.object({
  usedBytes: z.number().int().min(0),
  limitBytes: z.number().int().min(0),
  /** Det som är skyddat just nu (projekt öppnat de senaste 3 dygnen, projektets senaste klara laserkörning). */
  protectedBytes: z.number().int().min(0),
  /** Tas bort ur förrådet efter så många dagar orört; null = av. */
  idleDays: z.number().int().min(1).nullable(),
  next: z.array(z.object({ projectName: z.string().max(200).nullable(), label: z.string().max(200), source: z.string().max(20),
    bytes: z.number().int().min(0), lastUsedAt: z.iso.datetime({ offset: true }) }).strict()).max(10),
  /** Tagna bort och kan återskapas. */
  goneBytes: z.number().int().min(0),
  overLimitProjects: z.array(z.string().max(200)).max(2)
}).strict();
export type AccountRegenerable = z.infer<typeof accountRegenerableSchema>;
