import { sql } from "drizzle-orm";
import { boolean, check, customType, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { races } from "./core";

/**
 * Fest med bardisk (migration 0016, PLAN.md steg 40). Köpen står på brickorna (stämplingar på varornas koder) och räknas
 * fram ur avläsningarna; här finns festens start, varorna med prishistorik, gästernas namn, utcheckningar i bardisken
 * och ångrade köp. Belopp i öre.
 */
export const partySettings = pgTable("party_setting", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  /** Steg 46: utan sparad rad visas inga namn (domänens `partyShowsPublicNames`); appen skriver alltid värdet. */
  showPublicNames: boolean("show_public_names").notNull().default(true),
  /** Stämplingar på samma kod inom så många sekunder räknas som ett köp. */
  doublePunchSeconds: integer("double_punch_seconds").notNull().default(5),
  /** Utseendet: rubrik och färger (hex, gemener). NULL = neutralt förval. */
  themeTitle: text("theme_title"),
  themePrimary: text("theme_primary"),
  themeAccent: text("theme_accent"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const partyItems = pgTable("party_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  controlCode: integer("control_code").notNull(),
  name: text("name").notNull(),
  /** Valfri grupp, t.ex. "Drink" (migration 0017). */
  group: text("item_group"),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("party_item_code_uidx").on(table.raceId, table.controlCode),
  check("party_item_code_check", sql`${table.controlCode} BETWEEN 1 AND 999`),
  check("party_item_name_check", sql`char_length(${table.name}) BETWEEN 1 AND 80`)
]);

/** Priset från och med `validFrom`; append-only, så att en prisändring inte ändrar gamla köp. */
export const partyItemPrices = pgTable("party_item_price", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  itemId: uuid("item_id").notNull().references(() => partyItems.id),
  priceOre: integer("price_ore").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull()
}, (table) => [
  index("party_item_price_item_idx").on(table.itemId, table.validFrom),
  check("party_item_price_check", sql`${table.priceOre} BETWEEN 0 AND 10000000`)
]);

export const partyGuests = pgTable("party_guest", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  cardNumber: text("card_number").notNull(),
  name: text("name").notNull(),
  club: text("club"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  /** Steg 41 (migration 0018): gästen registrerade sin pinne själv på fest-sidan. NULL = personalen. */
  selfRegisteredAt: timestamp("self_registered_at", { withTimezone: true }),
  /** Steg 41: visningsnamn (smeknamn), det enda som visas publikt. NULL = förnamn + efternamnets första bokstav. */
  displayName: text("display_name")
}, (table) => [primaryKey({ columns: [table.raceId, table.cardNumber] })]);

/** In- och utcheckning i bardisken; idempotent på enhet + löpnummer. Start- och målstämpling räknas fram ur avläsningen. */
export const partyDeskEvents = pgTable("party_desk_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  cardNumber: text("card_number").notNull(),
  kind: text("kind").$type<"CHECK_IN" | "CHECK_OUT">().notNull(),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  deviceId: uuid("device_id").notNull(),
  localSequence: integer("local_sequence").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("party_desk_event_device_uidx").on(table.raceId, table.deviceId, table.localSequence, table.kind),
  check("party_desk_event_kind_check", sql`${table.kind} IN ('CHECK_IN', 'CHECK_OUT')`)
]);

/** Ett ångrat köp (bricka + kod + stämplingstid) med orsak. En ny rad; köpet står kvar på brickan. */
export const partyPurchaseVoids = pgTable("party_purchase_void", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  cardNumber: text("card_number").notNull(),
  controlCode: integer("control_code").notNull(),
  punchedAt: timestamp("punched_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("party_purchase_void_uidx").on(table.raceId, table.cardNumber, table.controlCode, table.punchedAt)]);

/**
 * Steg 44: "Ta bort incheckning" / "Ta bort utcheckning" för en gäst. In- eller utcheckningar för brickan till och med
 * `voidedAt` räknas inte (även startstämpling, målstämpling och självregistrering); senare räknas igen.
 */
export const partyPresenceVoids = pgTable("party_presence_void", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  requestId: uuid("request_id").notNull(),
  cardNumber: text("card_number").notNull(),
  kind: text("kind").$type<"CHECK_IN" | "CHECK_OUT">().notNull(),
  voidedAt: timestamp("voided_at", { withTimezone: true }).notNull(),
  actorAccountId: uuid("actor_account_id").notNull()
}, (table) => [
  uniqueIndex("party_presence_void_request_uidx").on(table.requestId),
  index("party_presence_void_race_idx").on(table.raceId, table.cardNumber),
  check("party_presence_void_kind_check", sql`${table.kind} IN ('CHECK_IN', 'CHECK_OUT')`)
]);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Festens logga (PNG eller JPEG, högst 1 MB), som kartbilderna. */
export const partyLogos = pgTable("party_logo", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  mediaType: text("media_type").$type<"image/png" | "image/jpeg">().notNull(),
  byteLength: integer("byte_length").notNull(),
  image: bytea("image").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull()
});
