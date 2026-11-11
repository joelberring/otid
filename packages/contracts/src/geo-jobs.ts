import { z } from "zod";

/**
 * ADR-0219 K5 (ägaren 2026-11-08): geo-arbetarens jobb. Ett Karttapullautin-jobb gäller laserrutor från Lantmäteriet (hämtade
 * med kontots egna uppgifter genom servern) och några av Karttapullautins inställningar. Resultatet blir ett underlag (bilden)
 * och filer med kurvor, branter och formlinjer som kan läsas in som kandidater.
 */
export const GEO_JOB_MAX_TILES = 16;
/** Karttapullautins inställningar som får ändras (pullauta.ini), med rimliga gränser. */
export const PULLAUTIN_SETTINGS = {
  contour_interval: [1, 10], formline: [0, 2], formlinesteepness: [0, 2], smoothing: [0.2, 3], curviness: [0, 3], knolls: [0, 3],
  cliff1: [0.5, 5], cliff2: [0.5, 10], cliffsteepfactor: [0, 2], yellowheight: [0, 3], greenground: [0, 3], greenhigh: [0, 10],
  undergrowth: [0, 2],
  // Ägaren 2026-11-11 («tror inställningarna för gröna ytor blir fel»): hur mycket kronorna väger in i grönt, och en faktor
  // på Karttapullautins gränser för grönt (`greenshades`, skrivs av geo-arbetaren; större faktor ger mindre grönt).
  topweight: [0, 1], greenscale: [0.3, 3]
} as const satisfies Record<string, readonly [number, number]>;

const settingsSchema = z.record(z.string(), z.number().finite()).superRefine((value, context) => {
  for (const [key, number] of Object.entries(value)) {
    const range = (PULLAUTIN_SETTINGS as Record<string, readonly [number, number]>)[key];
    if (!range) context.addIssue({ code: "custom", message: `Okänd inställning ${key}` });
    else if (number < range[0] || number > range[1]) context.addIssue({ code: "custom", message: `${key} ska vara ${range[0]}–${range[1]}` });
  }
});

const tileSchema = z.object({
  id: z.string().min(1).max(200),
  href: z.string().url().max(2000),
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).nullable(),
  epsg: z.number().int().min(1).max(999999).nullable(),
  /** Skanningens datum ur sökningen (för hur gamla hyggena var när lasern flögs). */
  datetime: z.string().max(40).nullable().optional()
}).strict();

/**
 * Grundkartan G1 (ägaren 2026-11-10): laserdatan klipps till kartans område innan Karttapullautin körs. Rutan är i laserns
 * koordinater (SWEREF 99 TM, meter) och har redan marginalen runt området med; högst 12 km i sida.
 */
export const GEO_CLIP_MARGIN_M = 50;
const clipSchema = z.object({ minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite() }).strict()
  .refine(box => box.maxX - box.minX >= 20 && box.maxY - box.minY >= 20, "Klipprutan är för liten")
  .refine(box => box.maxX - box.minX <= 12_000 && box.maxY - box.minY <= 12_000, "Klipprutan är för stor");
export type GeoClip = z.infer<typeof clipSchema>;

/**
 * Grundkartan G8 (ägaren 2026-11-10): Lantmäteriets kommunvisa vektorprodukter som geo-arbetaren läser till kandidater:
 * Marktäcke (vatten, öppen mark, åker, sankmark) och Byggnad. `href` är zip-filen hos Lantmäteriet.
 */
export const GEO_EXTRA_KINDS = ["LAND_COVER", "BUILDINGS"] as const;
export type GeoExtraKind = typeof GEO_EXTRA_KINDS[number];
const extraSchema = z.object({ kind: z.enum(GEO_EXTRA_KINDS), id: z.string().min(1).max(200), href: z.string().url().max(2000) }).strict();
export interface GeoExtraItem { readonly kind: GeoExtraKind; readonly id: string; readonly href: string }

export const geoJobCreateRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: z.string().uuid(),
  kind: z.literal("PULLAUTIN"),
  name: z.string().trim().min(1).max(80),
  tiles: z.array(tileSchema).min(1).max(GEO_JOB_MAX_TILES).optional(),
  settings: settingsSchema.default({}),
  clip: clipSchema.optional(),
  extras: z.array(extraSchema).max(6).optional(),
  /**
   * Branternas trösklar när fallet mäts i markrastret (G4, ägaren 2026-11-11: «mer/mindre branter»): minsta fall för en brant
   * och för en opasserbar brant, i meter över ±3 m. Förvalet är Kungshatt-kedjans (1,3 och 2,4).
   */
  cliffs: z.object({ minDrop: z.number().min(0.5).max(5), impassableDrop: z.number().min(1).max(10) }).strict()
    .refine(value => value.impassableDrop > value.minDrop, "En opasserbar brant ska vara högre än en brant").optional(),
  /** «Kör om med andra inställningar»: rutorna, klipprutan och Lantmäteriets produkter tas från det jobbet (G6). */
  rerunOf: z.string().uuid().optional(),
  /** K5c del 2: fuktigheten ur laserns markmodell (kanaltröskeln i hektar, höjd över fuktstråket för blött och fuktigt). */
  moisture: z.object({ channelHa: z.number().min(0.25).max(10), wetMeters: z.number().min(0.1).max(3), moistMeters: z.number().min(0.2).max(5) })
    .strict().refine(value => value.moistMeters >= value.wetMeters, "Fuktigt ska vara minst lika högt som blött").optional(),
  /** K5c del 3: vegetationen ur laserns returer (Karttapullautins grönt, gult och undervegetation) som ytor; minsta yta i m². */
  vegetation: z.object({ minAreaM2: z.number().int().min(50).max(5000) }).strict().optional()
}).strict().refine(value => !!value.tiles !== !!value.rerunOf, "Rutorna eller jobbet att köra om, inte båda");

export type GeoJobStatusView = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export interface GeoJobView {
  readonly jobId: string; readonly name: string; readonly kind: "PULLAUTIN" | "DWG"; readonly status: GeoJobStatusView;
  readonly tiles: number; readonly settings: Readonly<Record<string, number>>;
  /** Laserdatan klipptes till den här rutan (SWEREF 99 TM, med marginal); null = hela rutorna bearbetades. */
  readonly clip: GeoClip | null;
  /** Den senaste laserskanningen bland rutorna (ÅÅÅÅ-MM-DD), när sökningen gav ett datum. */
  readonly scannedAt: string | null;
  /** Branternas trösklar (null = förvalet), fuktigheten och vegetationen som jobbet räknade, så att det kan köras om likadant. */
  readonly cliffs: { readonly minDrop: number; readonly impassableDrop: number } | null;
  /** Vilka av Lantmäteriets vektorprodukter jobbet också läser (G8). */
  readonly extras: readonly GeoExtraKind[];
  readonly progress: { readonly step: string; readonly done: number; readonly total: number } | null;
  readonly error: string | null; readonly layerId: string | null;
  /** K5c del 2: fuktighetens underlag, när jobbet räknade fuktighet. */
  readonly moistureLayerId: string | null; readonly moisture: { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number } | null;
  /** K5c del 3: vegetationen som ytor, när jobbet räknade den. */
  readonly vegetation: { readonly minAreaM2: number } | null;
  readonly outputs: readonly { readonly name: string; readonly mediaType: string; readonly byteSize: number }[];
  readonly createdBy: { readonly accountId: string; readonly name: string | null }; readonly own: boolean;
  readonly createdAt: string; readonly finishedAt: string | null;
}
export interface GeoJobList { readonly formatVersion: 1; readonly jobs: readonly GeoJobView[]; readonly server: GeoServerView }
/** Geo-serverns läge som det syns för användaren (K5b): igång, startar, saknas eller kan inte startas och varför. */
export interface GeoServerView { readonly state: "READY" | "STARTING" | "OFF" | "UNAVAILABLE" | "BUDGET" | "NOT_CONFIGURED"; readonly detail: string | null }

/** Geo-arbetarens anrop (bara med geo-arbetarens nyckel). */
export const geoWorkerProgressSchema = z.object({
  step: z.string().min(1).max(60), done: z.number().int().min(0).max(1000), total: z.number().int().min(0).max(1000)
}).strict();
export const geoWorkerFinishSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DONE"), summary: z.record(z.string(), z.union([z.number(), z.string()])).optional() }).strict(),
  z.object({ status: z.literal("FAILED"), error: z.string().min(1).max(2000) }).strict()
]);
/**
 * Geo-arbetarens version (ägaren 2026-11-11: ett jobb kördes av en geo-server som fanns kvar med den gamla avbildningen). Arbetaren
 * skickar den i `x-otid-geo-version`; en äldre arbetare får inga jobb, och en server som O-Tid startat raderas. Höjs när
 * `scripts/geo-worker.ts` får något som jobben räknar med (samma tal står där; ett test håller dem lika).
 */
export const GEO_WORKER_VERSION = 10;

export const GEO_OUTPUT_NAME = /^[a-z0-9_.-]{1,60}$/;
/** K6b: DWG-ritningen som geo-arbetaren läser (indata, sparad som jobbets fil; resultatet heter ritning.geojson). */
export const GEO_DWG_INPUT = "indata.dwg";
export const GEO_DWG_MAX_BYTES = 75 * 1024 * 1024;
/** Största resultatfil (bilden kan bli stor när flera rutor slås ihop). */
export const GEO_OUTPUT_MAX_BYTES = 200 * 1024 * 1024;
