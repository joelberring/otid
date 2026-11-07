import { z } from "zod";
import { courseSettingParts as part } from "./course-setting";
import { courseSettingSketchSchema, mapMakerVerdictSchema } from "./course-setting-collaboration";
import { uuidSchema as uuid, sha256HexSchema } from "./ids";

/**
 * ADR-0214: länken till kartritaren. Banläggaren skapar den i Kartfel; kartritaren öppnar den utan konto och ser bara
 * kartan och kartfelen (läge, ritning, text och tråd), svarar och säger "Åtgärdat i kartan" eller "Inte åtgärdat".
 * Inga banor, kontroller, sträckor, nummer, bannamn, tävlingens tider, foton eller deltagare.
 */
const instant = z.iso.datetime();
const point = z.object({ x: part.mm, y: part.mm }).strict();
/** Nyckeln: 32 byte i base64url utan utfyllnad. */
export const mapLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const name = z.string().max(200).nullable();
const replyText = z.string().trim().min(1).max(2000);

/** Länkens läge för banläggaren. Nyckeln visas bara när länken skapas. */
export const mapLinkStatusSchema = z.enum(["ACTIVE", "EXPIRED"]);
export const mapLinkInfoSchema = z.object({
  status: mapLinkStatusSchema, createdAt: instant, expiresAt: instant.nullable(), showRaceName: z.boolean(), lastOpenedAt: instant.nullable()
}).strict();

export const mapLinkStateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  /** Tävlingsdagen och dagens datum i tävlingens tidszon (förslaget till sista dag räknas ur dem). */
  raceDate: z.iso.date(), today: z.iso.date(),
  /** Den senaste länken som inte är avstängd (gäller eller har gått ut), annars null. */
  link: mapLinkInfoSchema.nullable()
}).strict();
export type MapLinkState = z.infer<typeof mapLinkStateSchema>;

/** Ny länk (stänger den förra). `lastDay` = gäller till och med den dagen i tävlingens tidszon; null = tills den stängs av. */
export const mapLinkCreateRequestSchema = z.object({
  formatVersion: z.literal(1), lastDay: z.iso.date().nullable(), showRaceName: z.boolean()
}).strict();

/** Svaret när länken skapats: läget och nyckeln (den enda gången den lämnas ut). */
export const mapLinkCreatedSchema = mapLinkStateSchema.extend({ token: mapLinkTokenSchema }).strict();
export type MapLinkCreated = z.infer<typeof mapLinkCreatedSchema>;

/**
 * Ett svar i tråden som kartritaren ser. ADR-0214 beslut 4: ett svar med konto har bara rollen (`mapMaker`: kartritare med
 * konto, annars banläggaren), inget namn och ingen tid; kartritarens svar med länken har tiden och namnet hen skrev.
 */
export const mapLinkReplySchema = z.object({
  id: uuid, text: z.string().max(2000), createdAt: instant.nullable(),
  /** Namnet kartritaren skrev med länken; null = rollen ("Kartritaren" eller "Banläggaren"). */
  author: name,
  mapMaker: z.boolean(),
  verdict: mapMakerVerdictSchema.nullable(),
  /** ADR-0214 beslut 9: svaret redigerades (null = aldrig). */
  editedAt: instant.nullable()
}).strict();

/** Ett kartfel med länken: löpnummer, läge (punkt) eller ritning, text, status och tråd. Inget om vem som skrev det eller när. */
export const mapLinkErrorSchema = z.object({
  id: uuid, number: z.number().int().positive(), text: z.string().max(2000), status: z.enum(["OPEN", "DONE"]),
  point: point.nullable(), shapes: courseSettingSketchSchema.nullable(), editedAt: instant.nullable(),
  replies: z.array(mapLinkReplySchema).max(1000)
}).strict();
export type MapLinkError = z.infer<typeof mapLinkErrorSchema>;

export const mapLinkViewSchema = z.object({
  formatVersion: z.literal(1),
  /** Tävlingens namn bara när banläggaren valt "Visa tävlingens namn". */
  raceName: z.string().max(400).nullable(),
  /** Kartfilen som sidan ritar (null = tävlingen har ingen kartfil). */
  map: z.object({ sha256: sha256HexSchema, georeferenced: z.boolean() }).strict().nullable(),
  mapErrors: z.array(mapLinkErrorSchema).max(5000)
}).strict();
export type MapLinkView = z.infer<typeof mapLinkViewSchema>;

/** Kartritarens svar; `name` skrivs en gång i telefonen och sparas bara på svaren. */
export const mapLinkReplyRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, text: replyText, name: z.string().max(200).nullable()
}).strict();

/** "Åtgärdat i kartan" (kartfelet blir klart) eller "Inte åtgärdat" (det står öppet), med en valfri kommentar. */
export const mapLinkVerdictRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, verdict: mapMakerVerdictSchema, text: z.string().max(2000), name: z.string().max(200).nullable()
}).strict();

/** Felet för en ogiltig, avstängd, utgången eller okänd länk: alltid samma svar. */
export const mapLinkErrorResponseSchema = z.object({
  formatVersion: z.literal(1), error: z.enum(["LINK_INVALID", "NOT_FOUND", "INVALID_REQUEST", "FORBIDDEN", "RATE_LIMITED", "INTERNAL_ERROR"])
}).strict();
export type MapLinkErrorCode = z.infer<typeof mapLinkErrorResponseSchema>["error"];
