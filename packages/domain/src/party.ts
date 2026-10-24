/**
 * Fest med bardisk (PLAN.md steg 40). Gästen stämplar själv på kontrollenheten med varans kod (t.ex. 31 = "Öl 40 kr")
 * och läser ut brickan vid bardisken. Köpen räknas fram ur brickornas stämplingar; inget annat skapar ett köp.
 *
 * Regler:
 * - Ett köp är en stämpling med en kod som är en vara och en tid efter festens start.
 * - Unikt per bricka + kod + stämplingstid: samma stämpling som läses ut flera gånger är ett köp.
 * - Samma kod flera gånger är flera köp, men en stämpling inom `doublePunchSeconds` (förval 5) från föregående
 *   stämpling på samma kod är en dubbelstämpling och räknas inte.
 * - Priset är varans pris när gästen stämplade (prishistoriken), så att en prisändring inte ändrar gamla köp.
 * - Incheckning: startstämpling efter festens start (källa "Start") eller bardiskens läge "Checka in" (källa "Bardisken").
 *   Clear- och checkstämpling räknas inte. Den tidigaste gäller.
 * - Utcheckning: målstämpling efter festens start (källa "Mål", tiden är målstämplingens) eller bardiskens läge
 *   "Checka ut" (källa "Bardisken", utläsningens tid). Den tidigaste gäller.
 * - Ett köp med stämplingstid efter utcheckningen räknas men märks "efter utcheckning".
 * - Ett ångrat köp står kvar i listan med orsak men räknas inte i summan.
 * - Belopp i öre som heltal.
 */

export interface PartyPunch {
  readonly code: number;
  readonly punchedAt: string;
}

export interface PartyReadout {
  readonly cardNumber: string;
  readonly readAt: string;
  readonly startPunchedAt?: string | undefined;
  readonly finishPunchedAt?: string | undefined;
  readonly punches: readonly PartyPunch[];
}

export interface PartyItemPrice {
  readonly priceOre: number;
  readonly validFrom: string;
}

export interface PartyItem {
  readonly id: string;
  readonly code: number;
  readonly name: string;
  /** Valfri grupp, t.ex. "Drink". */
  readonly group?: string | null | undefined;
  readonly hidden: boolean;
  /** Prishistoriken; minst ett pris. */
  readonly prices: readonly PartyItemPrice[];
}

export interface PartyGuest {
  readonly cardNumber: string;
  readonly name: string;
  readonly club?: string | undefined;
  /** Steg 41: gästen registrerade pinnen själv på fest-sidan. */
  readonly selfRegistered?: boolean | undefined;
  /** Steg 41: visningsnamn (smeknamn) som gästen valt; annars förnamn + efternamnets första bokstav. */
  readonly displayName?: string | undefined;
}

/** In- eller utcheckning i bardisken. */
export interface PartyDeskEvent {
  readonly cardNumber: string;
  readonly kind: "CHECK_IN" | "CHECK_OUT";
  readonly at: string;
}

export interface PartyVoid {
  readonly cardNumber: string;
  readonly code: number;
  readonly punchedAt: string;
  readonly reason: string;
  readonly voidedAt: string;
}

/** Var in- eller utcheckningen gjordes: startenhet, målenhet eller bardisken. */
export type PartyPresenceSource = "START" | "FINISH" | "DESK";

export interface PartyPresence {
  readonly at: string;
  readonly source: PartyPresenceSource;
}
export type PartyCheckout = PartyPresence;

export interface PartyPurchase {
  readonly cardNumber: string;
  readonly code: number;
  readonly itemId: string;
  readonly itemName: string;
  readonly priceOre: number;
  readonly punchedAt: string;
  /** Första utläsningen där köpet fanns. */
  readonly firstReadAt: string;
  readonly afterCheckout: boolean;
  readonly voided?: { readonly reason: string; readonly at: string } | undefined;
}

export interface PartyGuestSummary {
  readonly cardNumber: string;
  readonly name?: string | undefined;
  readonly club?: string | undefined;
  /** Köp som räknas (inte ångrade). */
  readonly purchaseCount: number;
  readonly totalOre: number;
  readonly checkIn?: PartyPresence | undefined;
  readonly checkout?: PartyPresence | undefined;
  /** Senaste utläsningens antal stämplingar och brickans plats, om brickan kan bli full. */
  readonly memory?: { readonly punches: number; readonly capacity: number } | undefined;
  readonly lastReadAt?: string | undefined;
  /** Steg 41: gästen registrerade pinnen själv på fest-sidan. */
  readonly selfRegistered?: boolean | undefined;
  /** Steg 41: visningsnamnet som gästen eller personalen valt (inte förvalet). */
  readonly displayName?: string | undefined;
}

export const PARTY_DISPLAY_NAME_MAX = 40;

/** Förvalt visningsnamn: förnamnet och efternamnets första bokstav ("Oskar Karlsson" → "Oskar K"). */
export function partyDefaultDisplayName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]!.slice(0, PARTY_DISPLAY_NAME_MAX - 2);
  const last = words.length > 1 ? Array.from(words.at(-1)!)[0] : undefined;
  return last ? `${first} ${last.toLocaleUpperCase("sv")}` : first;
}

/** Namnet som visas publikt och i bardiskens kioskskärm: visningsnamnet, annars förvalet. Fullt namn visas aldrig där. */
export function partyDisplayName(guest: { readonly name?: string | undefined; readonly displayName?: string | undefined }): string | undefined {
  if (guest.displayName) return guest.displayName;
  return guest.name ? partyDefaultDisplayName(guest.name) || undefined : undefined;
}

export interface PartyLedger {
  /** Alla köp, äldst först (ångrade med). */
  readonly purchases: readonly PartyPurchase[];
  /** Gästerna: alla med köp, utcheckning eller namn. Sorterade på namn, sedan bricka. */
  readonly guests: readonly PartyGuestSummary[];
  readonly totalOre: number;
  readonly purchaseCount: number;
}

export interface PartyLedgerInput {
  readonly startsAt: string | undefined;
  readonly items: readonly PartyItem[];
  readonly readouts: readonly PartyReadout[];
  readonly deskEvents?: readonly PartyDeskEvent[];
  readonly voids?: readonly PartyVoid[];
  readonly guests?: readonly PartyGuest[];
  /** Dubbelstämpling inom (sekunder); förval 5. */
  readonly doublePunchSeconds?: number;
}

export const PARTY_DOUBLE_PUNCH_SECONDS = 5;

const ms = (value: string) => Date.parse(value);

/** Nyckeln som gör ett köp unikt: bricka, kod och stämplingstid (millisekunder, så att tidsformatet inte spelar roll). */
export function partyPurchaseKey(cardNumber: string, code: number, punchedAt: string): string {
  return `${cardNumber}:${code}:${ms(punchedAt)}`;
}

/** Varans pris när gästen stämplade: det senaste priset som gällde då, annars det första. */
export function partyPriceAt(item: Pick<PartyItem, "prices">, punchedAt: string): number {
  const sorted = [...item.prices].sort((left, right) => ms(left.validFrom) - ms(right.validFrom));
  const at = ms(punchedAt);
  let price = sorted[0]?.priceOre ?? 0;
  for (const row of sorted) if (ms(row.validFrom) <= at) price = row.priceOre;
  return price;
}

/**
 * Brickans plats för stämplingar, för varningen om att den kan bli full: SI5 och SI8 har 30, SI9 har 50. Övriga brickor
 * (SI6, SI10, SI11, SIAC, pCard) har gott om plats för en kväll. Bricktypen avgörs av numret när den inte är känd.
 */
export function partyCardCapacity(cardNumber: string, cardType?: string): number | undefined {
  if (cardType === "SI5" || cardType === "SI8") return 30;
  if (cardType === "SI9") return 50;
  if (cardType !== undefined) return undefined;
  const number = Number(cardNumber);
  if (number >= 1 && number < 500_000) return 30;
  if (number >= 1_000_000 && number < 2_000_000) return 50;
  if (number >= 2_000_000 && number < 3_000_000) return 30;
  return undefined;
}

/** Så nära full att gästen bör få veta det: högst fem platser kvar. */
export function partyMemoryWarning(memory: PartyGuestSummary["memory"]): boolean {
  return memory !== undefined && memory.capacity - memory.punches <= 5;
}

/** Köpen på en enda utläsning (bardiskens besked), utan dubbletter, äldst först. */
export function partyPurchasesOnCard(readout: PartyReadout, items: readonly PartyItem[], startsAt: string | undefined,
  doublePunchSeconds = PARTY_DOUBLE_PUNCH_SECONDS): PartyPurchase[] {
  if (startsAt === undefined) return [];
  const byCode = new Map(items.map(item => [item.code, item]));
  const start = ms(startsAt);
  const previous = new Map<number, number>();
  const rows: PartyPurchase[] = [];
  const punches = [...readout.punches].sort((left, right) => ms(left.punchedAt) - ms(right.punchedAt));
  for (const punch of punches) {
    const item = byCode.get(punch.code);
    const at = ms(punch.punchedAt);
    if (!item || !(at >= start)) continue;
    // Samma stämpling igen eller en dubbelstämpling: inom gränsen från föregående stämpling på samma kod.
    const before = previous.get(punch.code);
    previous.set(punch.code, at);
    if (before !== undefined && at - before <= doublePunchSeconds * 1_000) continue;
    rows.push({ cardNumber: readout.cardNumber, code: punch.code, itemId: item.id, itemName: item.name,
      priceOre: partyPriceAt(item, punch.punchedAt), punchedAt: punch.punchedAt, firstReadAt: readout.readAt, afterCheckout: false });
  }
  return rows.sort((left, right) => ms(left.punchedAt) - ms(right.punchedAt) || left.code - right.code);
}

/** Målstämplingen som utcheckning: bara efter festens start. */
export function partyFinishCheckout(readout: Pick<PartyReadout, "finishPunchedAt">, startsAt: string | undefined): string | undefined {
  if (startsAt === undefined || readout.finishPunchedAt === undefined) return undefined;
  return ms(readout.finishPunchedAt) >= ms(startsAt) ? readout.finishPunchedAt : undefined;
}

/** Startstämplingen som incheckning: bara efter festens start. */
export function partyStartCheckIn(readout: Pick<PartyReadout, "startPunchedAt">, startsAt: string | undefined): string | undefined {
  if (startsAt === undefined || readout.startPunchedAt === undefined) return undefined;
  return ms(readout.startPunchedAt) >= ms(startsAt) ? readout.startPunchedAt : undefined;
}

function earliest(left: PartyPresence | undefined, right: PartyPresence): PartyPresence {
  return !left || ms(right.at) < ms(left.at) ? right : left;
}

/** Hela kvällen: köpen ur alla utläsningar, utcheckningar, ångrade köp och summor per gäst. */
export function partyLedger(input: PartyLedgerInput): PartyLedger {
  const checkouts = new Map<string, PartyPresence>();
  const checkIns = new Map<string, PartyPresence>();
  for (const row of input.deskEvents ?? []) {
    const target = row.kind === "CHECK_IN" ? checkIns : checkouts;
    target.set(row.cardNumber, earliest(target.get(row.cardNumber), { at: row.at, source: "DESK" }));
  }
  const readouts = [...input.readouts].sort((left, right) => ms(left.readAt) - ms(right.readAt));
  const purchases = new Map<string, PartyPurchase>();
  const lastRead = new Map<string, PartyReadout>();
  for (const readout of readouts) {
    lastRead.set(readout.cardNumber, readout);
    const finish = partyFinishCheckout(readout, input.startsAt);
    if (finish) checkouts.set(readout.cardNumber, earliest(checkouts.get(readout.cardNumber), { at: finish, source: "FINISH" }));
    const arrived = partyStartCheckIn(readout, input.startsAt);
    if (arrived) checkIns.set(readout.cardNumber, earliest(checkIns.get(readout.cardNumber), { at: arrived, source: "START" }));
    for (const purchase of partyPurchasesOnCard(readout, input.items, input.startsAt, input.doublePunchSeconds)) {
      const key = partyPurchaseKey(purchase.cardNumber, purchase.code, purchase.punchedAt);
      if (!purchases.has(key)) purchases.set(key, purchase);
    }
  }
  const voids = new Map((input.voids ?? []).map(row => [partyPurchaseKey(row.cardNumber, row.code, row.punchedAt), row]));
  const rows = [...purchases.entries()].map(([key, purchase]): PartyPurchase => {
    const checkout = checkouts.get(purchase.cardNumber);
    const voided = voids.get(key);
    return { ...purchase, afterCheckout: checkout !== undefined && ms(purchase.punchedAt) > ms(checkout.at),
      ...(voided ? { voided: { reason: voided.reason, at: voided.voidedAt } } : {}) };
  }).sort((left, right) => ms(left.punchedAt) - ms(right.punchedAt) || left.cardNumber.localeCompare(right.cardNumber) ||
    left.code - right.code);

  const names = new Map((input.guests ?? []).map(guest => [guest.cardNumber, guest]));
  const cards = new Set([...rows.map(row => row.cardNumber), ...checkIns.keys(), ...checkouts.keys(), ...names.keys()]);
  const guests = [...cards].map((cardNumber): PartyGuestSummary => {
    const counted = rows.filter(row => row.cardNumber === cardNumber && !row.voided);
    const guest = names.get(cardNumber);
    const last = lastRead.get(cardNumber);
    const capacity = partyCardCapacity(cardNumber);
    return { cardNumber, ...(guest ? { name: guest.name, ...(guest.club ? { club: guest.club } : {}) } : {}),
      purchaseCount: counted.length, totalOre: counted.reduce((sum, row) => sum + row.priceOre, 0),
      ...(checkIns.has(cardNumber) ? { checkIn: checkIns.get(cardNumber) } : {}),
      ...(checkouts.has(cardNumber) ? { checkout: checkouts.get(cardNumber) } : {}),
      ...(last && capacity !== undefined ? { memory: { punches: last.punches.length, capacity } } : {}),
      ...(last ? { lastReadAt: last.readAt } : {}), ...(guest?.selfRegistered ? { selfRegistered: true } : {}),
      ...(guest?.displayName ? { displayName: guest.displayName } : {}) };
  }).sort((left, right) => (left.name ?? "￿").localeCompare(right.name ?? "￿", "sv") ||
    Number(left.cardNumber) - Number(right.cardNumber));
  const counted = rows.filter(row => !row.voided);
  return { purchases: rows, guests, totalOre: counted.reduce((sum, row) => sum + row.priceOre, 0), purchaseCount: counted.length };
}

/** Kronor med två decimaler och decimalkomma ("40,00"), som svenska Excel läser som tal. */
export function formatPartyKronor(ore: number): string {
  const sign = ore < 0 ? "-" : "";
  const value = Math.abs(ore);
  return `${sign}${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")}`;
}

/** Datum och klockslag i festens tidszon ("2026-10-24 21:14:05"). */
export function formatPartyTime(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

const BOM = "﻿";

/** Ett fält i CSV: citeras när det innehåller avgränsare, citattecken eller radbrytning. Formler oskadliggörs. */
function field(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function csv(rows: readonly (readonly (string | number)[])[]): string {
  return BOM + rows.map(row => row.map(field).join(";")).join("\r\n") + "\r\n";
}

export const PARTY_SOURCE_SV: Record<PartyPresenceSource, string> = { START: "Start", FINISH: "Mål", DESK: "Bardisken" };

/**
 * En rad per gäst: namn, klubb, bricka, antal köp, summa kr, incheckad och utcheckad (tid) och hur. UTF-8 med BOM och
 * semikolon, så att svenska Excel läser åäö och kolumnerna.
 */
export function partySummaryCsv(ledger: PartyLedger, timeZone: string): string {
  const time = (value: PartyPresence | undefined) => value ? formatPartyTime(value.at, timeZone) : "";
  return csv([["Namn", "Visningsnamn", "Klubb", "Bricka", "Antal köp", "Summa kr", "Incheckad", "Utcheckad", "Utcheckad via"],
    ...ledger.guests.map(guest => [guest.name ?? "", partyDisplayName(guest) ?? "", guest.club ?? "", guest.cardNumber, guest.purchaseCount,
      formatPartyKronor(guest.totalOre), time(guest.checkIn), time(guest.checkout),
      guest.checkout ? PARTY_SOURCE_SV[guest.checkout.source] : ""])]);
}

/** Alla köp, äldst först, med ångrade och köp efter utcheckning markerade. */
export function partyPurchasesCsv(ledger: PartyLedger, timeZone: string): string {
  const names = new Map(ledger.guests.map(guest => [guest.cardNumber, guest]));
  return csv([["Tid", "Bricka", "Namn", "Visningsnamn", "Klubb", "Vara", "Kod", "Pris kr", "Efter utcheckning", "Ångrad", "Orsak"],
    ...ledger.purchases.map(row => [formatPartyTime(row.punchedAt, timeZone), row.cardNumber, names.get(row.cardNumber)?.name ?? "",
      partyDisplayName(names.get(row.cardNumber) ?? {}) ?? "", names.get(row.cardNumber)?.club ?? "", row.itemName, row.code, formatPartyKronor(row.priceOre), row.afterCheckout ? "ja" : "",
      row.voided ? "ja" : "", row.voided?.reason ?? ""])]);
}
