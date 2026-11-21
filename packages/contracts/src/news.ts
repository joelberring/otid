import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * ADR-0230: nyhetsflödet «Nytt i O-Tid». Allmänna nyheter (superadmin) och klubbens nyheter (klubbens ledare, administratörer
 * och ägare). Bilden skalas ned i webbläsaren (högst `NEWS_IMAGE_MAX_SIDE` px, helst WebP) och skickas i base64.
 */
export const NEWS_IMAGE_MAX_BYTES = 300 * 1024;
export const NEWS_IMAGE_MAX_SIDE = 2000;
/** JSON-anropet med bilden i base64 får vara högst så här stort. */
export const NEWS_REQUEST_MAX_BYTES = Math.ceil(NEWS_IMAGE_MAX_BYTES / 3) * 4 + 16 * 1024;
export const NEWS_IMAGE_MEDIA_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

const newsImageSchema = z.object({
  mediaType: z.enum(NEWS_IMAGE_MEDIA_TYPES),
  base64: z.string().min(8).max(Math.ceil(NEWS_IMAGE_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().min(1).max(NEWS_IMAGE_MAX_SIDE),
  height: z.number().int().min(1).max(NEWS_IMAGE_MAX_SIDE)
}).strict();

/** Ny nyhet (idempotent på `requestId`) eller ändrad (`image`: utelämnad = behåll, null = ta bort, ett objekt = byt). */
export const newsSaveRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuidSchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(400),
  /** Tom = ingen länk. Formen prövas med `normalizedNewsLink` i domänen. */
  link: z.string().trim().max(500),
  image: newsImageSchema.nullable().optional(),
  hidden: z.boolean().optional()
}).strict();
export type NewsSaveRequest = z.infer<typeof newsSaveRequestSchema>;

export const newsItemSchema = z.object({
  newsId: uuidSchema,
  /** null = allmän nyhet. */
  clubId: uuidSchema.nullable(),
  clubName: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  /** Bildens adress med version (`?v=`), eller null. */
  imageUrl: z.string().nullable(),
  imageWidth: z.number().int().nullable(),
  imageHeight: z.number().int().nullable(),
  publishedAt: z.string(),
  hidden: z.boolean(),
  updatedAt: z.string()
}).strict();
export type NewsItem = z.infer<typeof newsItemSchema>;

/** Den som skriver: alla nyheter i området (allmänna för superadmin, klubbens för klubben), också dolda. */
export const newsListSchema = z.object({
  formatVersion: z.literal(1),
  canWrite: z.boolean(),
  items: z.array(newsItemSchema)
}).strict();
export type NewsList = z.infer<typeof newsListSchema>;

export const newsSaveResponseSchema = z.object({ formatVersion: z.literal(1), item: newsItemSchema }).strict();
