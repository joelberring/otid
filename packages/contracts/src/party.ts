import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Fest med bardisk (PLAN.md steg 40). Köpen räknas fram ur avläsningarnas stämplingar (domänens `partyLedger`); här
 * finns kontrakten för festens läge (arbetsytan och bardisken), admins ändringar, gästnamn och bardiskens in- och utcheckning.
 * Belopp i öre som heltal.
 */
const instant = z.iso.datetime({ offset: true });
const cardNumber = z.string().regex(/^[1-9][0-9]{0,8}$/);
const ore = z.number().int().min(0).max(10_000_000);
const total = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(1_000_000);
export const partyControlCodeSchema = z.number().int().min(1).max(999);
const itemName = z.string().trim().min(1).max(80);
const guestName = z.string().trim().min(1).max(160);
const club = z.string().trim().min(1).max(160);

const itemGroup = z.string().trim().min(1).max(40);
/** Steg 41: visningsnamn (smeknamn), det enda som visas publikt för en gäst. */
export const partyDisplayNameSchema = z.string().trim().min(1).max(40);

export const partyItemSchema = z.object({
  id: uuid, code: partyControlCodeSchema, name: itemName, group: itemGroup.nullable().optional(), hidden: z.boolean(),
  /** Nuvarande pris. */
  priceOre: ore,
  /** Prishistoriken, äldst först; ett köp kostar priset som gällde när gästen stämplade. */
  prices: z.array(z.object({ priceOre: ore, validFrom: instant }).strict()).min(1).max(200)
}).strict();

const hex = z.string().regex(/^#[0-9a-f]{6}$/);

/** Utseendet på den publika fest-sidan och bardisken. Null = neutralt förval. */
export const partyThemeSchema = z.object({
  title: z.string().trim().min(1).max(60).nullable(),
  primary: hex.nullable(),
  accent: hex.nullable(),
  /** Adressen till loggan, när den finns. */
  logo: z.string().regex(/^\/api\/public\/parties\/[0-9a-f-]{36}\/logo\?v=\d+$/).nullable()
}).strict();

/** Det bardisken behöver utan nät; följer med avläsningspaketet för en fest. Ingår inte i paketversionen. */
export const partyPackageSchema = z.object({
  startsAt: instant.nullable(),
  items: z.array(partyItemSchema).max(100),
  /** Dubbelstämpling inom (sekunder): stämplingar på samma kod så tätt räknas som ett köp. */
  doublePunchSeconds: z.number().int().min(0).max(600).optional(),
  theme: partyThemeSchema.optional()
}).strict();

const presence = z.object({ at: instant, source: z.enum(["START", "FINISH", "DESK"]) }).strict();

export const partyPurchaseSchema = z.object({
  cardNumber, code: partyControlCodeSchema, itemId: uuid, itemName, priceOre: ore, punchedAt: instant, firstReadAt: instant,
  afterCheckout: z.boolean(), voided: z.object({ reason: z.string().min(1).max(300), at: instant }).strict().optional()
}).strict();

export const partyGuestSummarySchema = z.object({
  cardNumber, name: guestName.optional(), club: club.optional(), purchaseCount: count, totalOre: total,
  checkIn: presence.optional(),
  checkout: presence.optional(),
  memory: z.object({ punches: z.number().int().min(0).max(1_000), capacity: z.number().int().min(1).max(1_000) }).strict().optional(),
  lastReadAt: instant.optional(),
  /** Steg 41: gästen registrerade pinnen själv på fest-sidan. */
  selfRegistered: z.boolean().optional(),
  /** Steg 41: visningsnamnet som valts (saknas = förnamn + efternamnets första bokstav). */
  displayName: partyDisplayNameSchema.optional()
}).strict();

export const partyStateResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, timeZone: z.string().min(1).max(128),
  ...partyPackageSchema.shape,
  showPublicNames: z.boolean(),
  /** Den publika fest-sidan (syns när tävlingen är publicerad). */
  publicPath: z.string().regex(/^\/fest\/[2-9a-hjkmnp-z]{6}$/),
  purchases: z.array(partyPurchaseSchema).max(100_000),
  guests: z.array(partyGuestSummarySchema).max(10_000),
  totalOre: total, purchaseCount: count,
  fetchedAt: instant
}).strict();

/** Admins ändringar: festens start, visa namn publikt, ny vara, ändrad vara (namn, pris, dold) och ångrat köp. */
export const partyChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  change: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("settings"), startsAt: instant, showPublicNames: z.boolean(),
      doublePunchSeconds: z.number().int().min(0).max(600) }).strict(),
    z.object({ kind: z.literal("theme"), title: z.string().trim().min(1).max(60).nullable(), primary: hex.nullable(), accent: hex.nullable() }).strict(),
    z.object({ kind: z.literal("item-add"), code: partyControlCodeSchema, name: itemName, priceOre: ore, group: itemGroup.nullable().optional() }).strict(),
    z.object({ kind: z.literal("item-change"), itemId: uuid, name: itemName, priceOre: ore, hidden: z.boolean(),
      group: itemGroup.nullable().optional() }).strict(),
    z.object({ kind: z.literal("void"), cardNumber, code: partyControlCodeSchema, punchedAt: instant,
      reason: z.string().trim().min(1).max(300) }).strict(),
    /** Steg 41: koppla bort pinnen från gästens namn (t.ex. en felaktig självregistrering). Köpen ligger kvar på brickan. */
    z.object({ kind: z.literal("guest-remove"), cardNumber }).strict()
  ])
}).strict();

/** Gästens namn på en bricka (bardisken vid okänd bricka eller arbetsytan). Samma bricka igen ersätter namnet. */
export const partyGuestRequestSchema = z.object({
  formatVersion: z.literal(1), cardNumber, name: guestName, club: club.nullable(),
  /** Steg 41: visningsnamn. Saknas = oförändrat; null = förvalet (förnamn + efternamnets första bokstav). */
  displayName: partyDisplayNameSchema.nullable().optional()
}).strict();

/** Bardiskens in- eller utcheckning, köad i webbläsaren. Idempotent på enhet + löpnummer (avläsningen den gjordes vid) + slag. */
export const partyDeskEventRequestSchema = z.object({
  formatVersion: z.literal(1), deviceId: uuid, localSequence: z.number().int().positive().max(2_147_483_647), cardNumber,
  kind: z.enum(["CHECK_IN", "CHECK_OUT"]), at: instant
}).strict();

export const partyDeskEventResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, deviceId: uuid, localSequence: z.number().int().positive(),
  kind: z.enum(["CHECK_IN", "CHECK_OUT"]), status: z.enum(["stored", "duplicate"])
}).strict();

export type PartyItemContract = z.infer<typeof partyItemSchema>;
export type PartyPackage = z.infer<typeof partyPackageSchema>;
export type PartyStateResponse = z.infer<typeof partyStateResponseSchema>;
export type PartyChangeRequest = z.infer<typeof partyChangeRequestSchema>;
export type PartyGuestRequest = z.infer<typeof partyGuestRequestSchema>;
export type PartyDeskEventRequest = z.infer<typeof partyDeskEventRequestSchema>;
export type PartyDeskEventResponse = z.infer<typeof partyDeskEventResponseSchema>;

/**
 * Den publika fest-sidan (PLAN.md steg 40): strikt kontrakt utan bricknummer, belopp och interna id:n. Namn bara när
 * festen visar namn publikt; belopp per person finns aldrig här.
 */
/** Steg 41: bara visningsnamnet (högst 40 tecken), aldrig fullt namn. */
const publicName = z.string().min(1).max(40);
const moment = z.object({ at: instant, name: publicName.optional() }).strict();


export const publicPartyResponseSchema = z.object({
  formatVersion: z.literal(1),
  eventName: z.string().min(1).max(160),
  timeZone: z.string().min(1).max(128),
  showNames: z.boolean(),
  theme: partyThemeSchema,
  soldCount: count, guestCount: count, checkedInCount: count, checkedOutCount: count,
  firstPurchaseAt: instant.optional(), lastPurchaseAt: instant.optional(),
  items: z.array(z.object({ name: itemName, count, share: z.number().min(0).max(1), group: itemGroup.optional() }).strict()).max(100),
  /** Grupper med antal, t.ex. "Drink": drinkar totalt. */
  groups: z.array(z.object({ name: itemGroup, count }).strict()).max(100).optional(),
  quarters: z.array(z.object({ startsAt: instant, count }).strict()).max(500),
  peak: z.number().int().min(0).max(499).optional(),
  recent: z.array(z.object({ at: instant, itemName, name: publicName.optional() }).strict()).max(20),
  averageSecondsBetween: z.number().int().min(0).max(10_000_000).optional(),
  topPerHour: z.array(z.object({ hourStartsAt: instant, itemName, count }).strict()).max(200),
  firstArrival: moment.optional(), firstFinish: moment.optional(), lastOut: moment.optional(),
  guests: z.array(z.object({ name: publicName, purchaseCount: count }).strict()).max(10_000).optional(),
  fetchedAt: instant
}).strict().superRefine((value, context) => {
  const named = value.recent.some(row => row.name) || [value.firstArrival, value.firstFinish, value.lastOut].some(row => row?.name) || value.guests;
  if (!value.showNames && named) context.addIssue({ code: "custom", message: "Namn får bara visas när festen visar namn" });
});

export type PartyTheme = z.infer<typeof partyThemeSchema>;
export type PublicPartyResponse = z.infer<typeof publicPartyResponseSchema>;
