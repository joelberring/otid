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

export const partyItemSchema = z.object({
  id: uuid, code: partyControlCodeSchema, name: itemName, hidden: z.boolean(),
  /** Nuvarande pris. */
  priceOre: ore,
  /** Prishistoriken, äldst först; ett köp kostar priset som gällde när gästen stämplade. */
  prices: z.array(z.object({ priceOre: ore, validFrom: instant }).strict()).min(1).max(200)
}).strict();

/** Det bardisken behöver utan nät; följer med avläsningspaketet för en fest. Ingår inte i paketversionen. */
export const partyPackageSchema = z.object({
  startsAt: instant.nullable(),
  items: z.array(partyItemSchema).max(100)
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
  lastReadAt: instant.optional()
}).strict();

export const partyStateResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, timeZone: z.string().min(1).max(128),
  ...partyPackageSchema.shape,
  showPublicNames: z.boolean(),
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
    z.object({ kind: z.literal("settings"), startsAt: instant, showPublicNames: z.boolean() }).strict(),
    z.object({ kind: z.literal("item-add"), code: partyControlCodeSchema, name: itemName, priceOre: ore }).strict(),
    z.object({ kind: z.literal("item-change"), itemId: uuid, name: itemName, priceOre: ore, hidden: z.boolean() }).strict(),
    z.object({ kind: z.literal("void"), cardNumber, code: partyControlCodeSchema, punchedAt: instant,
      reason: z.string().trim().min(1).max(300) }).strict()
  ])
}).strict();

/** Gästens namn på en bricka (bardisken vid okänd bricka eller arbetsytan). Samma bricka igen ersätter namnet. */
export const partyGuestRequestSchema = z.object({
  formatVersion: z.literal(1), cardNumber, name: guestName, club: club.nullable()
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
