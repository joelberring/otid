import { partyDisplayName, type PartyItem, type PartyLedger } from "./party";

/**
 * Den publika fest-sidan (PLAN.md steg 40): statistik över kvällen utan belopp och utan bricknummer. Namn finns bara
 * när festen visar namn publikt (förvalt på); belopp per person visas aldrig. Ren funktion; kontraktet ligger i
 * `contracts` och sidan i webben.
 */
export interface PartyPublicStats {
  readonly soldCount: number;
  readonly guestCount: number;
  readonly checkedInCount: number;
  readonly checkedOutCount: number;
  readonly firstPurchaseAt?: string | undefined;
  readonly lastPurchaseAt?: string | undefined;
  /** Varorna med antal och andel (0–1), mest sålda först. */
  readonly items: readonly { readonly name: string; readonly count: number; readonly share: number; readonly group?: string }[];
  /** Grupperna (t.ex. "Drink") med antal, flest först. */
  readonly groups?: readonly { readonly name: string; readonly count: number }[];
  /** Köp per kvart från kvällens första till senaste kvart; `peak` är index för den mest intensiva. */
  readonly quarters: readonly { readonly startsAt: string; readonly count: number }[];
  readonly peak?: number | undefined;
  /** Senaste köpen, nyast först. */
  readonly recent: readonly { readonly at: string; readonly itemName: string; readonly name?: string | undefined }[];
  /** Genomsnittlig tid mellan köp i sekunder (minst två köp). */
  readonly averageSecondsBetween?: number | undefined;
  /** Populäraste varan per timme. */
  readonly topPerHour: readonly { readonly hourStartsAt: string; readonly itemName: string; readonly count: number }[];
  readonly firstArrival?: { readonly at: string; readonly name?: string | undefined } | undefined;
  readonly firstFinish?: { readonly at: string; readonly name?: string | undefined } | undefined;
  /** Den som checkade ut sist ("Sista kvar"). */
  readonly lastOut?: { readonly at: string; readonly name?: string | undefined } | undefined;
  /** Kvällens gäster med antal köp, bara när namn visas. Aldrig belopp eller bricka. */
  readonly guests?: readonly { readonly name: string; readonly purchaseCount: number }[] | undefined;
  /** Steg 42: kvällens sträcktider, en rad per gäst med köp. */
  readonly splits: readonly PartySplitRow[];
}

/** En händelse i kvällens sträcktider; `sinceSeconds` är tiden sedan gästens förra händelse (saknas för den första). */
export interface PartySplitEvent {
  readonly at: string;
  readonly sinceSeconds?: number | undefined;
}

/**
 * Steg 42: en gästs kväll som en sträcktidsrad. Bara visningsnamnet och bara när festen visar namn; annars bara
 * `guestNumber` ("Gäst 3"), som är stabilt: gästerna numreras efter när de först syntes (utläsning eller incheckning).
 * Aldrig bricka, fullt namn eller belopp.
 */
export interface PartySplitRow {
  readonly guestNumber: number;
  readonly name?: string | undefined;
  readonly purchaseCount: number;
  /** Från incheckningen (eller första köpet) till utcheckningen (eller senaste köpet), i sekunder. */
  readonly totalSeconds: number;
  readonly checkIn?: PartySplitEvent | undefined;
  /** Köpen som räknas (inte ångrade), äldst först. */
  readonly purchases: readonly (PartySplitEvent & { readonly itemName: string; readonly group?: string | undefined })[];
  readonly checkout?: PartySplitEvent | undefined;
}

/**
 * Kvällens sträcktider: köpen som räknas i summeringen (festens start och dubbelstämpling i `partyLedger`, ångrade
 * köp bort), med in- och utcheckning. Sträcktiden räknas i tidsordning över gästens alla händelser. Sorterade på antal
 * köp, flest först, sedan det tidigaste första köpet.
 */
export function partySplits(ledger: PartyLedger, options: { readonly showNames: boolean;
  readonly items?: readonly Pick<PartyItem, "id" | "group">[] }): PartySplitRow[] {
  const groupOf = new Map((options.items ?? []).flatMap(item => item.group ? [[item.id, item.group] as const] : []));
  const byCard = new Map<string, PartyLedger["purchases"][number][]>();
  for (const row of ledger.purchases) {
    if (row.voided) continue;
    byCard.set(row.cardNumber, [...byCard.get(row.cardNumber) ?? [], row]);
  }
  const ms = (value: string) => Date.parse(value);
  const guests = ledger.guests.filter(guest => byCard.has(guest.cardNumber)).map(guest => {
    const purchases = [...byCard.get(guest.cardNumber)!].sort((left, right) => ms(left.punchedAt) - ms(right.punchedAt) || left.code - right.code);
    // När gästen först syntes: första utläsningen med ett köp eller in-/utcheckningen. Ger ett stabilt "Gäst N".
    const seen = Math.min(...purchases.map(row => ms(row.firstReadAt)), ...[guest.checkIn, guest.checkout].flatMap(row => row ? [ms(row.at)] : []));
    return { guest, purchases, seen };
  });
  const numbers = new Map([...guests].sort((left, right) => left.seen - right.seen ||
    Number(left.guest.cardNumber) - Number(right.guest.cardNumber)).map((row, index) => [row.guest.cardNumber, index + 1]));

  const firsts = new Map<PartySplitRow, number>();
  const rows = guests.map(({ guest, purchases }): PartySplitRow => {
    type Raw = { kind: 0 | 1 | 2; at: string; index: number };
    const events: Raw[] = [...(guest.checkIn ? [{ kind: 0 as const, at: guest.checkIn.at, index: 0 }] : []),
      ...purchases.map((row, index) => ({ kind: 1 as const, at: row.punchedAt, index })),
      ...(guest.checkout ? [{ kind: 2 as const, at: guest.checkout.at, index: 0 }] : [])]
      .sort((left, right) => ms(left.at) - ms(right.at) || left.kind - right.kind || left.index - right.index);
    const since = new Map<Raw, number>();
    events.forEach((event, index) => {
      if (index > 0) since.set(event, Math.max(0, Math.round((ms(event.at) - ms(events[index - 1]!.at)) / 1_000)));
    });
    const event = (raw: Raw | undefined): PartySplitEvent | undefined => raw ? { at: raw.at,
      ...(since.has(raw) ? { sinceSeconds: since.get(raw)! } : {}) } : undefined;
    const start = Math.min(...events.filter(row => row.kind !== 2).map(row => ms(row.at)));
    const end = guest.checkout ? ms(guest.checkout.at) : ms(purchases.at(-1)!.punchedAt);
    const name = options.showNames ? partyDisplayName(guest) : undefined;
    const split: PartySplitRow = {
      guestNumber: numbers.get(guest.cardNumber)!, ...(name ? { name } : {}), purchaseCount: purchases.length,
      totalSeconds: Math.max(0, Math.round((end - start) / 1_000)),
      ...(guest.checkIn ? { checkIn: event(events.find(row => row.kind === 0)) } : {}),
      purchases: events.filter(row => row.kind === 1).map(raw => {
        const purchase = purchases[raw.index]!;
        const group = groupOf.get(purchase.itemId);
        return { ...event(raw)!, itemName: purchase.itemName, ...(group ? { group } : {}) };
      }),
      ...(guest.checkout ? { checkout: event(events.find(row => row.kind === 2)) } : {})
    };
    firsts.set(split, ms(purchases[0]!.punchedAt));
    return split;
  });
  return rows.sort((left, right) => right.purchaseCount - left.purchaseCount || firsts.get(left)! - firsts.get(right)! ||
    left.guestNumber - right.guestNumber);
}

const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;
const RECENT = 12;

const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

export function partyPublicStats(ledger: PartyLedger, options: { readonly showNames: boolean;
  readonly items?: readonly Pick<PartyItem, "id" | "group">[] }): PartyPublicStats {
  const groupOf = new Map((options.items ?? []).flatMap(item => item.group ? [[item.id, item.group] as const] : []));
  // Steg 41: bara visningsnamnet (smeknamnet eller förnamn + efternamnets första bokstav), aldrig fullt namn.
  const names = new Map(ledger.guests.map(guest => [guest.cardNumber, partyDisplayName(guest)]));
  const nameOf = (card: string) => options.showNames ? names.get(card) : undefined;
  const sold = ledger.purchases.filter(row => !row.voided);
  const times = sold.map(row => Date.parse(row.punchedAt)).sort((left, right) => left - right);

  const byItem = new Map<string, number>();
  const itemGroup = new Map<string, string>();
  const byGroup = new Map<string, number>();
  for (const row of sold) {
    byItem.set(row.itemName, (byItem.get(row.itemName) ?? 0) + 1);
    const group = groupOf.get(row.itemId);
    if (group) { itemGroup.set(row.itemName, group); byGroup.set(group, (byGroup.get(group) ?? 0) + 1); }
  }
  const groups = [...byGroup.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count);
  const items = [...byItem.entries()].map(([name, count]) => ({ name, count, share: sold.length ? count / sold.length : 0,
    ...(itemGroup.has(name) ? { group: itemGroup.get(name)! } : {}) }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "sv"));

  const quarters: { startsAt: string; count: number }[] = [];
  let peak: number | undefined;
  if (times.length > 0) {
    const first = floorTo(times[0]!, QUARTER_MS);
    const last = floorTo(times.at(-1)!, QUARTER_MS);
    for (let at = first; at <= last; at += QUARTER_MS) quarters.push({ startsAt: new Date(at).toISOString(), count: 0 });
    for (const time of times) quarters[(floorTo(time, QUARTER_MS) - first) / QUARTER_MS]!.count += 1;
    peak = quarters.reduce((best, row, index) => row.count > quarters[best]!.count ? index : best, 0);
  }

  const hours = new Map<number, Map<string, number>>();
  for (const row of sold) {
    const hour = floorTo(Date.parse(row.punchedAt), HOUR_MS);
    const counts = hours.get(hour) ?? new Map<string, number>();
    counts.set(row.itemName, (counts.get(row.itemName) ?? 0) + 1);
    hours.set(hour, counts);
  }
  const topPerHour = [...hours.entries()].sort(([left], [right]) => left - right).map(([hour, counts]) => {
    const [itemName, count] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "sv"))[0]!;
    return { hourStartsAt: new Date(hour).toISOString(), itemName, count };
  });

  const earliest = <T extends { at: string }>(rows: T[]) => rows.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0];
  const arrivals = ledger.guests.flatMap(guest => guest.checkIn ? [{ at: guest.checkIn.at, card: guest.cardNumber }] : []);
  const finishes = ledger.guests.flatMap(guest => guest.checkout?.source === "FINISH" ? [{ at: guest.checkout.at, card: guest.cardNumber }] : []);
  const outs = ledger.guests.flatMap(guest => guest.checkout ? [{ at: guest.checkout.at, card: guest.cardNumber }] : []);
  const person = (row: { at: string; card: string } | undefined) => row ? { at: row.at, ...(nameOf(row.card) ? { name: nameOf(row.card) } : {}) } : undefined;
  const lastOut = outs.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];

  return {
    soldCount: sold.length,
    guestCount: ledger.guests.filter(guest => guest.purchaseCount > 0 || guest.checkIn || guest.checkout).length,
    checkedInCount: ledger.guests.filter(guest => guest.checkIn).length,
    checkedOutCount: ledger.guests.filter(guest => guest.checkout).length,
    ...(times.length > 0 ? { firstPurchaseAt: new Date(times[0]!).toISOString(), lastPurchaseAt: new Date(times.at(-1)!).toISOString() } : {}),
    items, ...(groups.length > 0 ? { groups } : {}), quarters, ...(peak !== undefined ? { peak } : {}),
    recent: [...sold].reverse().slice(0, RECENT).map(row => ({ at: row.punchedAt, itemName: row.itemName,
      ...(nameOf(row.cardNumber) ? { name: nameOf(row.cardNumber) } : {}) })),
    ...(times.length > 1 ? { averageSecondsBetween: Math.round((times.at(-1)! - times[0]!) / (times.length - 1) / 1_000) } : {}),
    topPerHour,
    ...(arrivals.length ? { firstArrival: person(earliest(arrivals)) } : {}),
    ...(finishes.length ? { firstFinish: person(earliest(finishes)) } : {}),
    ...(lastOut ? { lastOut: person(lastOut) } : {}),
    ...(options.showNames ? { guests: ledger.guests.flatMap(guest => {
      const name = partyDisplayName(guest);
      return name ? [{ name, purchaseCount: guest.purchaseCount }] : [];
    })
      .sort((left, right) => right.purchaseCount - left.purchaseCount || left.name.localeCompare(right.name, "sv")) } : {}),
    splits: partySplits(ledger, options)
  };
}
