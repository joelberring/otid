/**
 * Användartest 2026-11-12: kvittot på självregistreringen minns i webbläsaren, per tävling, så att löparen ser att hen är
 * anmäld när sidan laddas om. Inget skickas till servern för detta; blockerad lagring ger bara inget minne.
 */
export type StoredReceipt = { name: string; className: string; cardNumber: string };

const MAX_RECEIPTS = 10;
export const receiptKey = (raceId: string) => `otid-sjalvreg:${raceId}`;

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => typeof window === "undefined" ? undefined : window.localStorage;

const valid = (row: unknown): row is StoredReceipt => !!row && typeof row === "object" &&
  typeof (row as StoredReceipt).name === "string" && typeof (row as StoredReceipt).cardNumber === "string" &&
  typeof (row as StoredReceipt).className === "string";

/** Kvittona för tävlingen i den här webbläsaren, äldst först. */
export function readReceipts(raceId: string, store: Store | undefined = browserStore()): StoredReceipt[] {
  try {
    const value = JSON.parse(store?.getItem(receiptKey(raceId)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(valid).slice(-MAX_RECEIPTS) : [];
  } catch { return []; }
}

/** Lägger till ett kvitto; samma bricka ersätter det tidigare. Ger listan som nu gäller. */
export function rememberReceipt(raceId: string, receipt: StoredReceipt, store: Store | undefined = browserStore()): StoredReceipt[] {
  const next = [...readReceipts(raceId, store).filter(row => row.cardNumber !== receipt.cardNumber), receipt].slice(-MAX_RECEIPTS);
  try { store?.setItem(receiptKey(raceId), JSON.stringify(next)); } catch { /* Utan lagring minns webbläsaren inget; anmälan är ändå gjord. */ }
  return next;
}
