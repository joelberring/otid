import { and, asc, eq } from "drizzle-orm";
import {
  partyChangeRequestSchema, partyDeskEventRequestSchema, partyDeskEventResponseSchema, partyGuestRequestSchema, partyStateResponseSchema,
  publicPartyResponseSchema, type PartyDeskEventResponse, type PartyPackage, type PartyStateResponse, type PartyTheme,
  type PublicPartyResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { partyLedger, partyPublicStats } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import type { DbExecutor } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * Fest med bardisk (PLAN.md steg 40). Köpen räknas fram ur tävlingens avläsningar (`card_readout`) med domänens
 * `partyLedger`; tabellerna här har bara festens start, varorna med prishistorik, gästnamn, bardiskens in- och utcheckningar och
 * ångrade köp. Funktionären läser läget, sätter namn och checkar ut; admin ändrar varor, start och ångrar köp.
 */
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
const iso = (value: Date) => value.toISOString();

async function isParty(tx: DbExecutor, raceId: string): Promise<boolean> {
  const [race] = await tx.select({ type: schema.races.raceType }).from(schema.races).where(eq(schema.races.id, raceId));
  return race?.type === "PARTY";
}

async function loadItems(tx: DbExecutor, raceId: string): Promise<PartyPackage["items"]> {
  const items = await tx.select().from(schema.partyItems).where(eq(schema.partyItems.raceId, raceId))
    .orderBy(asc(schema.partyItems.controlCode));
  const prices = await tx.select().from(schema.partyItemPrices).where(eq(schema.partyItemPrices.raceId, raceId))
    .orderBy(asc(schema.partyItemPrices.validFrom), asc(schema.partyItemPrices.id));
  return items.map(item => {
    const own = prices.filter(row => row.itemId === item.id).map(row => ({ priceOre: row.priceOre, validFrom: iso(row.validFrom) }));
    return { id: item.id, code: item.controlCode, name: item.name, hidden: item.hidden, prices: own, priceOre: own.at(-1)?.priceOre ?? 0 };
  });
}

/** Utseendet: rubrik, färger och loggans adress (versionen är uppladdningens tid, så att en ny logga hämtas). */
async function loadTheme(tx: DbExecutor, raceId: string, setting: typeof schema.partySettings.$inferSelect | undefined): Promise<PartyTheme> {
  const [race] = await tx.select({ shortCode: schema.races.shortCode }).from(schema.races).where(eq(schema.races.id, raceId));
  const [logo] = await tx.select({ uploadedAt: schema.partyLogos.uploadedAt }).from(schema.partyLogos).where(eq(schema.partyLogos.raceId, raceId));
  return { title: setting?.themeTitle ?? null, primary: setting?.themePrimary ?? null, accent: setting?.themeAccent ?? null,
    logo: logo && race ? `/api/public/parties/${race.shortCode}/logo?v=${logo.uploadedAt.getTime()}` : null };
}

/** Festens start, varorna och utseendet för avläsningspaketet (bardisken utan nät). Undefined när tävlingen inte är en fest. */
export async function loadPartyPackage(tx: DbExecutor, raceId: string): Promise<PartyPackage | undefined> {
  if (!await isParty(tx, raceId)) return undefined;
  const [setting] = await tx.select().from(schema.partySettings).where(eq(schema.partySettings.raceId, raceId));
  return { startsAt: setting ? iso(setting.startsAt) : null, items: await loadItems(tx, raceId), theme: await loadTheme(tx, raceId, setting) };
}

/** Hela läget: varor, köp ur avläsningarna, gäster med summa och utcheckning. */
export async function loadPartyState(tx: DbExecutor, raceId: string, now: Date): Promise<PartyStateResponse> {
  const [race] = await tx.select({ timeZone: schema.events.timeZone, shortCode: schema.races.shortCode }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Loppet finns inte");
  const [setting] = await tx.select().from(schema.partySettings).where(eq(schema.partySettings.raceId, raceId));
  const items = await loadItems(tx, raceId);
  const startsAt = setting ? iso(setting.startsAt) : undefined;
  const readouts = await tx.select({ cardNumber: schema.cardReadouts.cardNumber, readAt: schema.cardReadouts.readAt,
    startPunchedAt: schema.cardReadouts.startPunchedAt, finishPunchedAt: schema.cardReadouts.finishPunchedAt, punches: schema.cardReadouts.punches })
    .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)).orderBy(asc(schema.cardReadouts.readAt));
  const deskEvents = await tx.select().from(schema.partyDeskEvents).where(eq(schema.partyDeskEvents.raceId, raceId));
  const voids = await tx.select().from(schema.partyPurchaseVoids).where(eq(schema.partyPurchaseVoids.raceId, raceId));
  const guests = await tx.select().from(schema.partyGuests).where(eq(schema.partyGuests.raceId, raceId));
  const ledger = partyLedger({ startsAt, items,
    readouts: readouts.map(row => ({ cardNumber: row.cardNumber, readAt: iso(row.readAt),
      ...(row.startPunchedAt ? { startPunchedAt: iso(row.startPunchedAt) } : {}),
      ...(row.finishPunchedAt ? { finishPunchedAt: iso(row.finishPunchedAt) } : {}),
      punches: row.punches.map(punch => ({ code: punch.code, punchedAt: new Date(punch.punchedAt).toISOString() })) })),
    deskEvents: deskEvents.map(row => ({ cardNumber: row.cardNumber, kind: row.kind, at: iso(row.happenedAt) })),
    voids: voids.map(row => ({ cardNumber: row.cardNumber, code: row.controlCode, punchedAt: iso(row.punchedAt), reason: row.reason,
      voidedAt: iso(row.createdAt) })),
    guests: guests.map(row => ({ cardNumber: row.cardNumber, name: row.name, ...(row.club ? { club: row.club } : {}) })) });
  return partyStateResponseSchema.parse({ formatVersion: 1, raceId, timeZone: race.timeZone, startsAt: startsAt ?? null, items,
    theme: await loadTheme(tx, raceId, setting),
    showPublicNames: setting?.showPublicNames ?? true, publicPath: `/fest/${race.shortCode}`, purchases: ledger.purchases, guests: ledger.guests,
    totalOre: ledger.totalOre, purchaseCount: ledger.purchaseCount, fetchedAt: iso(now) });
}

export type PartyStateResult = Failure | { status: "ok"; response: PartyStateResponse };

/** Läget för arbetsytan och bardisken (funktionär räcker). */
export async function readPartyAsAdmin(db: Database, input: RaceSessionProof, now = new Date()): Promise<PartyStateResult> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    if (!await isParty(tx, auth.principal.raceId)) return { status: "not-found" };
    return { status: "ok", response: await loadPartyState(tx, auth.principal.raceId, now) };
  }, { isolationLevel: "repeatable read" });
}

/**
 * Admins ändringar med auditpost. Ny vara: koden får inte redan vara en vara. Ändrat pris läggs till i prishistoriken
 * från nu, så gamla köp behåller sitt pris. Ångra: en ny rad med orsak; samma köp ångrat igen ger samma läge.
 */
export async function changePartyAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()):
  Promise<PartyStateResult> {
  const parsed = partyChangeRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  const { change, requestId } = parsed.data;
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    if (!await isParty(tx, raceId)) return { status: "not-found" };
    const audit = (entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown>) =>
      tx.insert(schema.auditEvents).values({ raceId, entityType: "party", entityId, requestId, actorKind: "USER_ACCOUNT",
        actorId: auth.principal.accountId, action, before, after, createdAt: now });
    if (change.kind === "settings") {
      const [before] = await tx.select().from(schema.partySettings).where(eq(schema.partySettings.raceId, raceId));
      await tx.insert(schema.partySettings).values({ raceId, startsAt: new Date(change.startsAt), showPublicNames: change.showPublicNames,
        updatedAt: now }).onConflictDoUpdate({ target: schema.partySettings.raceId,
        set: { startsAt: new Date(change.startsAt), showPublicNames: change.showPublicNames, updatedAt: now } });
      await audit(raceId, "PARTY_SETTINGS_CHANGED", before ? { startsAt: iso(before.startsAt), showPublicNames: before.showPublicNames } : null,
        { startsAt: new Date(change.startsAt).toISOString(), showPublicNames: change.showPublicNames });
    } else if (change.kind === "theme") {
      const [before] = await tx.select().from(schema.partySettings).where(eq(schema.partySettings.raceId, raceId));
      if (!before) return { status: "conflict" };
      await tx.update(schema.partySettings).set({ themeTitle: change.title, themePrimary: change.primary, themeAccent: change.accent, updatedAt: now })
        .where(eq(schema.partySettings.raceId, raceId));
      await audit(raceId, "PARTY_THEME_CHANGED", { title: before.themeTitle, primary: before.themePrimary, accent: before.themeAccent },
        { title: change.title, primary: change.primary, accent: change.accent });
    } else if (change.kind === "item-add") {
      const [taken] = await tx.select({ id: schema.partyItems.id }).from(schema.partyItems)
        .where(and(eq(schema.partyItems.raceId, raceId), eq(schema.partyItems.controlCode, change.code)));
      if (taken) return { status: "conflict" };
      const [item] = await tx.insert(schema.partyItems).values({ raceId, controlCode: change.code, name: change.name, hidden: false,
        createdAt: now, updatedAt: now }).returning({ id: schema.partyItems.id });
      // Det första priset gäller från början, så att stämplingar innan varan lades in också får ett pris.
      await tx.insert(schema.partyItemPrices).values({ raceId, itemId: item!.id, priceOre: change.priceOre, validFrom: new Date(0) });
      await audit(item!.id, "PARTY_ITEM_ADDED", null, { code: change.code, name: change.name, priceOre: change.priceOre });
    } else if (change.kind === "item-change") {
      const [item] = await tx.select().from(schema.partyItems)
        .where(and(eq(schema.partyItems.raceId, raceId), eq(schema.partyItems.id, change.itemId)));
      if (!item) return { status: "not-found" };
      const prices = await tx.select().from(schema.partyItemPrices).where(eq(schema.partyItemPrices.itemId, item.id))
        .orderBy(asc(schema.partyItemPrices.validFrom), asc(schema.partyItemPrices.id));
      const priceBefore = prices.at(-1)?.priceOre;
      await tx.update(schema.partyItems).set({ name: change.name, hidden: change.hidden, updatedAt: now }).where(eq(schema.partyItems.id, item.id));
      if (priceBefore !== change.priceOre) {
        await tx.insert(schema.partyItemPrices).values({ raceId, itemId: item.id, priceOre: change.priceOre, validFrom: now });
      }
      await audit(item.id, "PARTY_ITEM_CHANGED", { name: item.name, hidden: item.hidden, priceOre: priceBefore ?? null },
        { name: change.name, hidden: change.hidden, priceOre: change.priceOre });
    } else {
      const inserted = await tx.insert(schema.partyPurchaseVoids).values({ raceId, cardNumber: change.cardNumber, controlCode: change.code,
        punchedAt: new Date(change.punchedAt), reason: change.reason, actorAccountId: auth.principal.accountId, createdAt: now })
        .onConflictDoNothing().returning({ id: schema.partyPurchaseVoids.id });
      if (inserted[0]) {
        await audit(inserted[0].id, "PARTY_PURCHASE_VOIDED", null, { cardNumber: change.cardNumber, code: change.code,
          punchedAt: new Date(change.punchedAt).toISOString(), reason: change.reason });
      }
    }
    return { status: "ok", response: await loadPartyState(tx, raceId, now) };
  });
}

export type PartyGuestResult = Failure | { status: "ok" };

/** Gästens namn på en bricka (funktionär räcker: bardisken vid okänd bricka). Samma bricka igen ersätter namnet. */
export async function setPartyGuestAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()):
  Promise<PartyGuestResult> {
  const parsed = partyGuestRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  const guest = parsed.data;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    if (!await isParty(tx, raceId)) return { status: "not-found" };
    const [before] = await tx.select().from(schema.partyGuests)
      .where(and(eq(schema.partyGuests.raceId, raceId), eq(schema.partyGuests.cardNumber, guest.cardNumber)));
    if (before && before.name === guest.name && before.club === guest.club) return { status: "ok" };
    await tx.insert(schema.partyGuests).values({ raceId, cardNumber: guest.cardNumber, name: guest.name, club: guest.club, updatedAt: now })
      .onConflictDoUpdate({ target: [schema.partyGuests.raceId, schema.partyGuests.cardNumber],
        set: { name: guest.name, club: guest.club, updatedAt: now } });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "party", entityId: raceId, actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, action: "PARTY_GUEST_NAMED",
      before: before ? { cardNumber: before.cardNumber, name: before.name, club: before.club } : null,
      after: { cardNumber: guest.cardNumber, name: guest.name, club: guest.club }, createdAt: now });
    return { status: "ok" };
  });
}

export type PartyDeskEventResult = Failure | { status: "ok"; response: PartyDeskEventResponse };

/** Bardiskens in- eller utcheckning (köad i webbläsaren). Samma enhet + löpnummer + slag igen ger samma kvitto, inte en ny rad. */
export async function registerPartyDeskEventAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()):
  Promise<PartyDeskEventResult> {
  const parsed = partyDeskEventRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  const request = parsed.data;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    if (!await isParty(tx, raceId)) return { status: "not-found" };
    const inserted = await tx.insert(schema.partyDeskEvents).values({ raceId, cardNumber: request.cardNumber, kind: request.kind,
      happenedAt: new Date(request.at), deviceId: request.deviceId, localSequence: request.localSequence,
      actorAccountId: auth.principal.accountId, createdAt: now }).onConflictDoNothing().returning({ id: schema.partyDeskEvents.id });
    if (!inserted[0]) {
      const [prior] = await tx.select().from(schema.partyDeskEvents).where(and(eq(schema.partyDeskEvents.raceId, raceId),
        eq(schema.partyDeskEvents.deviceId, request.deviceId), eq(schema.partyDeskEvents.localSequence, request.localSequence),
        eq(schema.partyDeskEvents.kind, request.kind)));
      if (!prior || prior.cardNumber !== request.cardNumber) return { status: "conflict" };
    } else {
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "party_desk_event", entityId: inserted[0].id, actorKind: "USER_ACCOUNT",
        actorId: auth.principal.accountId, action: request.kind === "CHECK_IN" ? "PARTY_CHECKED_IN_AT_DESK" : "PARTY_CHECKED_OUT_AT_DESK",
        before: null, after: { cardNumber: request.cardNumber, at: new Date(request.at).toISOString() }, createdAt: now });
    }
    return { status: "ok", response: partyDeskEventResponseSchema.parse({ formatVersion: 1, raceId, deviceId: request.deviceId,
      localSequence: request.localSequence, kind: request.kind, status: inserted[0] ? "stored" : "duplicate" }) };
  });
}

/**
 * Den publika fest-sidan (PLAN.md steg 40): statistik utan belopp och bricknummer, namn bara när festen visar namn.
 * Grinden (publicerad tävling) ligger i webbens `publicRaceResponse`. Undefined när tävlingen inte är en fest.
 */
export async function readPublicParty(db: Database, raceId: string, now = new Date()): Promise<PublicPartyResponse | undefined> {
  return db.transaction(async tx => {
    if (!await isParty(tx, raceId)) return undefined;
    const state = await loadPartyState(tx, raceId, now);
    const [event] = await tx.select({ name: schema.events.name }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
    const stats = partyPublicStats({ purchases: state.purchases, guests: state.guests, totalOre: state.totalOre, purchaseCount: state.purchaseCount },
      { showNames: state.showPublicNames });
    return publicPartyResponseSchema.parse({ formatVersion: 1, eventName: event!.name, timeZone: state.timeZone, showNames: state.showPublicNames,
      theme: state.theme, ...stats, fetchedAt: iso(now) });
  }, { isolationLevel: "repeatable read" });
}

/** Festens logga för den publika sidan och bardisken. */
export async function readPartyLogo(db: Database, raceId: string): Promise<{ mediaType: string; image: Buffer } | undefined> {
  const [logo] = await db.select({ mediaType: schema.partyLogos.mediaType, image: schema.partyLogos.image }).from(schema.partyLogos)
    .where(eq(schema.partyLogos.raceId, raceId));
  return logo;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LOGO_MAX_BYTES = 1_048_576;

/** Bildtypen ur filens första byte (PNG eller JPEG), aldrig ur filnamnet eller webbläsarens uppgift. */
export function partyLogoMediaType(bytes: Uint8Array): "image/png" | "image/jpeg" | undefined {
  if (PNG.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
}

/** Sparar eller tar bort festens logga (admin). PNG eller JPEG, högst 1 MB; typen avgörs av innehållet. */
export async function savePartyLogoAsAdmin(db: Database, input: RaceSessionProof & { image: Uint8Array | null }, now = new Date()):
  Promise<Failure | { status: "ok" }> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  const mediaType = input.image ? partyLogoMediaType(input.image) : undefined;
  if (input.image && (!mediaType || input.image.byteLength === 0 || input.image.byteLength > LOGO_MAX_BYTES)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    if (!await isParty(tx, raceId)) return { status: "not-found" };
    if (input.image && mediaType) {
      const image = Buffer.from(input.image);
      await tx.insert(schema.partyLogos).values({ raceId, mediaType, byteLength: image.byteLength, image, uploadedAt: now })
        .onConflictDoUpdate({ target: schema.partyLogos.raceId, set: { mediaType, byteLength: image.byteLength, image, uploadedAt: now } });
    } else {
      await tx.delete(schema.partyLogos).where(eq(schema.partyLogos.raceId, raceId));
    }
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "party", entityId: raceId, actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, action: input.image ? "PARTY_LOGO_SAVED" : "PARTY_LOGO_REMOVED", before: null,
      after: input.image ? { mediaType, byteLength: input.image.byteLength } : {}, createdAt: now });
    return { status: "ok" };
  });
}
