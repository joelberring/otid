import { z } from "zod";

/**
 * ADR-0219 K5 (ägaren 2026-11-08): geo-arbetarens jobb. Ett Karttapullautin-jobb gäller laserrutor från Lantmäteriet (hämtade
 * med kontots egna uppgifter genom servern) och några av Karttapullautins inställningar. Resultatet blir ett underlag (bilden)
 * och filer med kurvor, branter och formlinjer som kan läsas in som kandidater.
 */
export const GEO_JOB_MAX_TILES = 16;
/** Karttapullautins inställningar som får ändras (pullauta.ini), med rimliga gränser. */
export const PULLAUTIN_SETTINGS = {
  contour_interval: [1, 10], formline: [0, 2], formlinesteepness: [0, 2], smoothing: [0, 2], curviness: [0, 3], knolls: [0, 3],
  cliff1: [0.5, 5], cliff2: [0.5, 10], cliffsteepfactor: [0, 2], yellowheight: [0, 3], greenground: [0, 3], greenhigh: [0, 10],
  undergrowth: [0, 2]
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
  epsg: z.number().int().min(1).max(999999).nullable()
}).strict();

export const geoJobCreateRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: z.string().uuid(),
  kind: z.literal("PULLAUTIN"),
  name: z.string().trim().min(1).max(80),
  tiles: z.array(tileSchema).min(1).max(GEO_JOB_MAX_TILES),
  settings: settingsSchema.default({})
}).strict();

export type GeoJobStatusView = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export interface GeoJobView {
  readonly jobId: string; readonly name: string; readonly kind: "PULLAUTIN"; readonly status: GeoJobStatusView;
  readonly tiles: number; readonly settings: Readonly<Record<string, number>>;
  readonly progress: { readonly step: string; readonly done: number; readonly total: number } | null;
  readonly error: string | null; readonly layerId: string | null;
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
export const GEO_OUTPUT_NAME = /^[a-z0-9_.-]{1,60}$/;
/** Största resultatfil (bilden kan bli stor när flera rutor slås ihop). */
export const GEO_OUTPUT_MAX_BYTES = 200 * 1024 * 1024;
