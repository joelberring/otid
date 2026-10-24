import type { PartyPackage, PartyStateResponse } from "@o-tid/contracts";
import {
  partyCardCapacity, partyFinishCheckout, partyPurchaseKey, partyPurchasesOnCard, partyStartCheckIn, type PartyPurchase, type PartyReadout
} from "@o-tid/domain";
import type { QueuedReadout } from "./store";
import type { QueuedPartyAction } from "./party-store";

/**
 * Bardiskens beslut för en utläsning (PLAN.md steg 40). Gästerna sköter det själva i ett fönster:
 * - Automatiskt (förval): första utläsningen checkar in ("Välkommen"), senare visar nya köp sedan förra utläsningen
 *   ("Inga nya köp" utan), och en målstämpling efter festens start checkar ut.
 * - Personalens lägen: Checka in, Köp/verifiera och Checka ut (rättningar).
 * Allt räknas här i webbläsaren ur brickan, den lokala kön och serverns senaste läge, så att det fungerar utan nät.
 */
export type DeskMode = "AUTO" | "CHECK_IN" | "BUY" | "CHECK_OUT";

export interface DeskKnowledge {
  readonly party: PartyPackage;
  readonly server: PartyStateResponse | undefined;
  readonly readouts: readonly QueuedReadout[];
  readonly actions: readonly QueuedPartyAction[];
}

export type DeskOutcomeKind = "WELCOME" | "ALREADY_IN" | "PURCHASES" | "NO_NEW" | "CHECKED_OUT";

export interface DeskOutcome {
  readonly localSequence: number;
  readonly cardNumber: string;
  readonly kind: DeskOutcomeKind;
  /** Köp på brickan som inte var kända före den här utläsningen. */
  readonly newPurchases: readonly PartyPurchase[];
  readonly checkedInAt?: string | undefined;
  readonly checkedOutAt?: string | undefined;
  /** In- eller utcheckning som ska köas för den här utläsningen. */
  readonly enqueue?: "CHECK_IN" | "CHECK_OUT" | undefined;
}

export function partyReadout(item: QueuedReadout): PartyReadout {
  return { cardNumber: item.payload.cardNumber, readAt: item.stationReceivedAt, startPunchedAt: item.payload.startPunchedAt,
    finishPunchedAt: item.payload.finishPunchedAt, punches: item.payload.punches };
}

const live = (row: QueuedPartyAction) => row.status !== "rejected";

/** Incheckningen som var känd före utläsningen `before` (löpnummer), eller undefined. */
function checkInBefore(card: string, knowledge: DeskKnowledge, before: number): string | undefined {
  const server = knowledge.server?.guests.find(guest => guest.cardNumber === card)?.checkIn?.at;
  if (server) return server;
  const desk = knowledge.actions.find(row => live(row) && row.action.kind === "desk" && row.action.request.cardNumber === card &&
    row.action.request.kind === "CHECK_IN");
  if (desk?.action.kind === "desk") return desk.action.request.at;
  for (const item of knowledge.readouts) {
    if (item.payload.cardNumber !== card || item.localSequence >= before) continue;
    const start = partyStartCheckIn(partyReadout(item), knowledge.party.startsAt ?? undefined);
    if (start) return start;
  }
  return undefined;
}

/** Köpen på brickan som var kända före utläsningen: serverns och tidigare lokala utläsningar av samma bricka. */
function knownBefore(card: string, knowledge: DeskKnowledge, before: number): Set<string> {
  const keys = new Set((knowledge.server?.purchases ?? []).filter(row => row.cardNumber === card)
    .map(row => partyPurchaseKey(row.cardNumber, row.code, row.punchedAt)));
  for (const item of knowledge.readouts) {
    if (item.payload.cardNumber !== card || item.localSequence >= before) continue;
    for (const row of partyPurchasesOnCard(partyReadout(item), knowledge.party.items, knowledge.party.startsAt ?? undefined,
      knowledge.party.doublePunchSeconds)) {
      keys.add(partyPurchaseKey(row.cardNumber, row.code, row.punchedAt));
    }
  }
  return keys;
}

export function decideReadout(item: QueuedReadout, mode: DeskMode, knowledge: DeskKnowledge): DeskOutcome {
  const card = item.payload.cardNumber;
  const readout = partyReadout(item);
  const startsAt = knowledge.party.startsAt ?? undefined;
  const known = knownBefore(card, knowledge, item.localSequence);
  const newPurchases = partyPurchasesOnCard(readout, knowledge.party.items, startsAt, knowledge.party.doublePunchSeconds)
    .filter(row => !known.has(partyPurchaseKey(row.cardNumber, row.code, row.punchedAt)));
  const base = { localSequence: item.localSequence, cardNumber: card, newPurchases };
  const earlier = checkInBefore(card, knowledge, item.localSequence);
  const startHere = partyStartCheckIn(readout, startsAt);
  const finish = partyFinishCheckout(readout, startsAt);
  if (mode === "CHECK_OUT") return { ...base, kind: "CHECKED_OUT", checkedOutAt: finish ?? item.stationReceivedAt, enqueue: "CHECK_OUT" };
  if (mode === "BUY") return { ...base, kind: newPurchases.length > 0 ? "PURCHASES" : "NO_NEW" };
  if (mode === "CHECK_IN") {
    if (earlier) return { ...base, kind: "ALREADY_IN", checkedInAt: earlier };
    return { ...base, kind: "WELCOME", checkedInAt: startHere ?? item.stationReceivedAt, ...(startHere ? {} : { enqueue: "CHECK_IN" as const }) };
  }
  if (finish) return { ...base, kind: "CHECKED_OUT", checkedOutAt: finish };
  if (!earlier) {
    return { ...base, kind: "WELCOME", checkedInAt: startHere ?? item.stationReceivedAt, ...(startHere ? {} : { enqueue: "CHECK_IN" as const }) };
  }
  return { ...base, kind: newPurchases.length > 0 ? "PURCHASES" : "NO_NEW", checkedInAt: earlier };
}

export interface CardEvening {
  /** Alla köp på brickan i kväll, äldst först (ångrade med, märkta). */
  readonly purchases: readonly PartyPurchase[];
  readonly totalOre: number;
  readonly checkedOutAt?: string | undefined;
}

/** Kvällen för en bricka: serverns köp och alla lokala utläsningar, utan dubbletter. Ångrade räknas inte i summan. */
export function cardEvening(card: string, knowledge: DeskKnowledge): CardEvening {
  const startsAt = knowledge.party.startsAt ?? undefined;
  const rows = new Map<string, PartyPurchase>();
  for (const row of knowledge.server?.purchases ?? []) if (row.cardNumber === card) rows.set(partyPurchaseKey(row.cardNumber, row.code, row.punchedAt), row);
  for (const item of knowledge.readouts) {
    if (item.payload.cardNumber !== card) continue;
    for (const row of partyPurchasesOnCard(partyReadout(item), knowledge.party.items, startsAt, knowledge.party.doublePunchSeconds)) {
      const key = partyPurchaseKey(row.cardNumber, row.code, row.punchedAt);
      if (!rows.has(key)) rows.set(key, row);
    }
  }
  const purchases = [...rows.values()].sort((left, right) => Date.parse(left.punchedAt) - Date.parse(right.punchedAt));
  return { purchases, totalOre: purchases.filter(row => !row.voided).reduce((sum, row) => sum + row.priceOre, 0) };
}

/** Gästens namn: senast sparade här (även köat), annars serverns. */
export function guestName(card: string, knowledge: Pick<DeskKnowledge, "server" | "actions">): string | undefined {
  const local = knowledge.actions.filter(row => live(row) && row.action.kind === "guest" && row.action.request.cardNumber === card).at(-1);
  if (local?.action.kind === "guest") return local.action.request.name;
  return knowledge.server?.guests.find(guest => guest.cardNumber === card)?.name;
}

/** Brickan har högst fem platser kvar för stämplingar (SI5 och SI8: 30, SI9: 50). */
export function cardNearlyFull(item: QueuedReadout): { punches: number; capacity: number } | undefined {
  const capacity = partyCardCapacity(item.payload.cardNumber, item.payload.cardType);
  if (capacity === undefined || capacity - item.payload.punches.length > 5) return undefined;
  return { punches: item.payload.punches.length, capacity };
}
