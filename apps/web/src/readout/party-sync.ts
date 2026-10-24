import { partyDeskEventResponseSchema, partyStateResponseSchema, type PartyStateResponse } from "@o-tid/contracts";
import type { PartyActionStore } from "./party-store";
import type { SyncDependencies, SyncOutcome } from "./sync";

/**
 * Skickar bardiskens väntande in-/utcheckningar och gästnamn (PLAN.md steg 40), i den ordning de gjordes. En post ändrar
 * status först när servern svarat; vid nätfel ligger den kvar och skickas vid nästa försök. In- och utcheckning är
 * idempotent på enhet + löpnummer + slag; gästnamnet ersätter namnet på brickan.
 */
export async function syncPartyActions(store: PartyActionStore, raceId: string, deps: SyncDependencies): Promise<SyncOutcome> {
  let count = 0;
  for (const item of (await store.list(raceId)).filter(row => row.status === "pending")) {
    const csrf = deps.csrf();
    if (!csrf) return { kind: "unauthorized" };
    const path = item.action.kind === "desk" ? "party-desk-events" : "party-guests";
    let response: Response;
    try {
      response = await deps.fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/${path}`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(item.action.request)
      });
    } catch {
      return { kind: "offline" };
    }
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (response.status === 400 || response.status === 404 || response.status === 409) {
      await store.update({ ...item, status: "rejected", rejectedReason: String(response.status) });
      continue;
    }
    if (!response.ok) return { kind: "failed", status: response.status };
    if (item.action.kind === "desk") {
      const receipt = partyDeskEventResponseSchema.parse(await response.json());
      if (receipt.raceId !== raceId || receipt.deviceId !== item.action.request.deviceId ||
          receipt.localSequence !== item.action.request.localSequence) throw new Error("Kvittot gäller en annan utcheckning");
    }
    await store.update({ ...item, status: "stored" });
    count += 1;
  }
  return count > 0 ? { kind: "synced", count } : { kind: "idle" };
}

export type PartyStateOutcome =
  | { readonly kind: "ok"; readonly value: PartyStateResponse }
  | { readonly kind: "unauthorized" | "offline" }
  | { readonly kind: "failed"; readonly status: number };

/** Festens läge på servern (köp, gäster, in- och utcheckningar). Bardisken hämtar det var femte sekund. */
export async function fetchPartyState(raceId: string, fetcher: typeof fetch = fetch): Promise<PartyStateOutcome> {
  let response: Response;
  try {
    response = await fetcher(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/party`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    return { kind: "offline" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
  if (!response.ok) return { kind: "failed", status: response.status };
  const value = partyStateResponseSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("Festens läge gäller en annan tävling");
  return { kind: "ok", value };
}
